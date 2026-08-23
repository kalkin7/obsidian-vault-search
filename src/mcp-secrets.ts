import { createHash } from "crypto";
import type { App, SecretStorage } from "obsidian";
import type { McpServerSettings } from "./types";
import {
  MAX_MCP_URL_CHARS,
  MCP_SECRET_NAME_MAX,
  MCP_SECRET_PAYLOAD_LIMIT_BYTES,
  MCP_SECRET_VALUE_MAX,
} from "./constants";
import { toSafeOrigin } from "./mcp-server-form";

type SecretCapableApp = App & { secretStorage?: SecretStorage };

function storage(app: App): SecretStorage | undefined {
  return (app as SecretCapableApp).secretStorage;
}

export function hasMcpSecretStorage(app: App): boolean {
  return Boolean(storage(app));
}

/** Stable per-(server, env) secret id. The env NAME is hashed so ids never
 *  carry user-chosen strings verbatim, while staying deterministic across
 *  restarts for the same server UUID + name. */
export function mcpSecretId(serverId: string, envName: string): string {
  const digest = createHash("sha256").update(envName, "utf8").digest("hex");
  return `vault-search-mcp-env-${serverId}-${digest.slice(0, 12)}`;
}

export function getMcpSecret(
  app: App,
  serverId: string,
  envName: string,
): string | null {
  try {
    const value = storage(app)?.getSecret(mcpSecretId(serverId, envName));
    return value === null || value === undefined || value === "" ? null : value;
  } catch {
    throw new Error(`MCP_SECRET_READ_FAILED:${serverId}:${envName}`);
  }
}

export function setMcpSecret(
  app: App,
  serverId: string,
  envName: string,
  value: string,
): void {
  const secretStorage = storage(app);
  if (!secretStorage) {
    throw new Error(
      "이 버전의 Obsidian은 보안 키 저장소를 지원하지 않습니다. Obsidian 1.11.4 이상이 필요합니다.",
    );
  }
  try {
    secretStorage.setSecret(mcpSecretId(serverId, envName), value);
  } catch {
    throw new Error(`MCP_SECRET_WRITE_FAILED:${serverId}:${envName}`);
  }
}

export function deleteMcpSecret(
  app: App,
  serverId: string,
  envName: string,
): void {
  const s = storage(app);
  if (!s) return;
  try {
    const store = s as unknown as { deleteSecret?: (k: string) => void };
    if (typeof store.deleteSecret === "function") {
      store.deleteSecret(mcpSecretId(serverId, envName));
      return;
    }
    s.setSecret(mcpSecretId(serverId, envName), "");
  } catch {
    throw new Error(`MCP_SECRET_DELETE_FAILED:${serverId}:${envName}`);
  }
}

/** Stable per-server secret id for remote HTTP connection URLs. */
export function mcpHttpUrlSecretId(serverId: string): string {
  return `vault-search-mcp-http-url-${serverId}`;
}

export function getMcpHttpUrl(app: App, serverId: string): string | null {
  try {
    const value = storage(app)?.getSecret(mcpHttpUrlSecretId(serverId));
    return value === null || value === undefined || value === "" ? null : value;
  } catch {
    throw new Error(`MCP_SECRET_READ_FAILED:${serverId}:http_url`);
  }
}

export function setMcpHttpUrl(
  app: App,
  serverId: string,
  url: string,
): void {
  const secretStorage = storage(app);
  if (!secretStorage) {
    throw new Error(
      "이 버전의 Obsidian은 보안 키 저장소를 지원하지 않습니다. Obsidian 1.11.4 이상이 필요합니다.",
    );
  }
  try {
    secretStorage.setSecret(mcpHttpUrlSecretId(serverId), url);
  } catch {
    throw new Error(`MCP_SECRET_WRITE_FAILED:${serverId}:http_url`);
  }
}

export function deleteMcpHttpUrl(app: App, serverId: string): void {
  const s = storage(app);
  if (!s) return;
  try {
    const store = s as unknown as { deleteSecret?: (k: string) => void };
    if (typeof store.deleteSecret === "function") {
      store.deleteSecret(mcpHttpUrlSecretId(serverId));
      return;
    }
    s.setSecret(mcpHttpUrlSecretId(serverId), "");
  } catch {
    throw new Error(`MCP_SECRET_DELETE_FAILED:${serverId}:http_url`);
  }
}

export function hasMcpHttpUrl(
  app: App,
  serverId: string,
  expectedServerUrl?: string,
): boolean {
  try {
    const val = storage(app)?.getSecret(mcpHttpUrlSecretId(serverId));
    if (!val || typeof val !== "string") return false;
    if (!isValidMigrationUrl(val)) return false;
    if (expectedServerUrl !== undefined && expectedServerUrl !== "") {
      const expectedOrigin = toSafeOrigin(expectedServerUrl);
      const storedOrigin = toSafeOrigin(val);
      if (!expectedOrigin || !storedOrigin || expectedOrigin !== storedOrigin) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function hasMcpEnvSecret(
  app: App,
  serverId: string,
  envName: string,
): boolean {
  try {
    const val = storage(app)?.getSecret(mcpSecretId(serverId, envName));
    return val !== null && val !== undefined && val !== "";
  } catch {
    return false;
  }
}

/** Remove every secret belonging to a server (settings delete flow). The
 *  caller must pass the exact server being removed plus its env names. */
export function deleteServerSecrets(
  app: App,
  server: Pick<McpServerSettings, "id" | "envNames">,
): void {
  for (const name of server.envNames || []) {
    deleteMcpSecret(app, server.id, name);
  }
  deleteMcpHttpUrl(app, server.id);
}

export interface McpSecretPayloadResult {
  payload: {
    servers: Record<string, Record<string, string>>;
    http_urls: Record<string, string>;
  };
  /** Summary — safe to log/display. */
  summary: {
    servers: Record<string, string[]>;
    http_urls: Record<string, boolean>;
  };
  skipped: Array<{ serverId: string; envName?: string; reason: string }>;
}

/** Build the one-shot `set_mcp_secrets` handoff for every enabled server.
 *  Values come exclusively from secret storage; nothing here is persisted or
 *  logged. Every enabled server gets an entry — even an empty map, so the
 *  backend's wholesale replace performs deletions. Oversized payloads are
 *  trimmed with explicit skip reasons so a single bad entry cannot block the
 *  rest. */
export function buildMcpSecretPayload(
  app: App,
  servers: McpServerSettings[],
  options?: { strict?: boolean },
): McpSecretPayloadResult {
  const payloadServers: Record<string, Record<string, string>> = {};
  const payloadHttpUrls: Record<string, string> = {};
  const summaryServers: Record<string, string[]> = {};
  const summaryHttpUrls: Record<string, boolean> = {};
  const skipped: McpSecretPayloadResult["skipped"] = [];

  for (const server of servers) {
    if (!server.enabled) continue;
    if (server.transport === "http") {
      let url: string | null = null;
      try {
        url = getMcpHttpUrl(app, server.id);
      } catch {
        if (options?.strict) {
          throw new Error(`MCP_SECRET_PAYLOAD_READ_FAILED:${server.id}`);
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        skipped.push({ serverId: server.id, reason: "storage-read-error" });
        continue;
      }
      if (url === null || url === "") {
        const tempPayload = {
          servers: { ...payloadServers },
          http_urls: { ...payloadHttpUrls, [server.id]: "" },
        };
        if (
          Buffer.byteLength(JSON.stringify(tempPayload), "utf8") >
          MCP_SECRET_PAYLOAD_LIMIT_BYTES
        ) {
          if (options?.strict) {
            throw new Error(`MCP_SECRET_PAYLOAD_BUDGET_EXCEEDED:${server.id}`);
          }
          summaryHttpUrls[server.id] = false;
          skipped.push({
            serverId: server.id,
            reason: "payload-budget-exceeded",
          });
          continue;
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        continue;
      }
      if (url.length > MAX_MCP_URL_CHARS) {
        if (options?.strict) {
          throw new Error(`MCP_SECRET_PAYLOAD_URL_TOO_LARGE:${server.id}`);
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        skipped.push({ serverId: server.id, reason: "url-too-large" });
        continue;
      }
      if (!isValidMigrationUrl(url)) {
        if (options?.strict) {
          throw new Error(`MCP_SECRET_PAYLOAD_INVALID_URL:${server.id}`);
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        skipped.push({ serverId: server.id, reason: "invalid-url" });
        continue;
      }
      const serverOrigin = toSafeOrigin(server.url || "");
      const storedOrigin = toSafeOrigin(url);
      if (!serverOrigin || !storedOrigin || serverOrigin !== storedOrigin) {
        if (options?.strict) {
          throw new Error(`MCP_SECRET_PAYLOAD_ORIGIN_MISMATCH:${server.id}`);
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        skipped.push({ serverId: server.id, reason: "origin-mismatch" });
        continue;
      }
      const tempPayload = {
        servers: { ...payloadServers },
        http_urls: { ...payloadHttpUrls, [server.id]: url },
      };
      if (
        Buffer.byteLength(JSON.stringify(tempPayload), "utf8") >
        MCP_SECRET_PAYLOAD_LIMIT_BYTES
      ) {
        if (options?.strict) {
          throw new Error(`MCP_SECRET_PAYLOAD_BUDGET_EXCEEDED:${server.id}`);
        }
        payloadHttpUrls[server.id] = "";
        summaryHttpUrls[server.id] = false;
        skipped.push({
          serverId: server.id,
          reason: "payload-budget-exceeded",
        });
        continue;
      }
      payloadHttpUrls[server.id] = url;
      summaryHttpUrls[server.id] = true;
    } else {
      const values: Record<string, string> = {};
      for (const envName of server.envNames || []) {
        if (!envName || envName.length > MCP_SECRET_NAME_MAX) {
          skipped.push({ serverId: server.id, envName, reason: "invalid-name" });
          continue;
        }
        let value: string | null = null;
        try {
          value = getMcpSecret(app, server.id, envName);
        } catch {
          if (options?.strict) {
            throw new Error(
              `MCP_SECRET_PAYLOAD_READ_FAILED: 서버(${server.id}) 환경 변수(${envName}) 비밀 조회 실패`,
            );
          }
          skipped.push({
            serverId: server.id,
            envName,
            reason: "storage-read-error",
          });
          continue;
        }
        if (value === null || value === "") continue;
        if (value.length > MCP_SECRET_VALUE_MAX) {
          skipped.push({
            serverId: server.id,
            envName,
            reason: "value-too-large",
          });
          continue;
        }
        const tempValues = { ...values, [envName]: value };
        const tempPayload = {
          servers: { ...payloadServers, [server.id]: tempValues },
          http_urls: { ...payloadHttpUrls },
        };
        if (
          Buffer.byteLength(JSON.stringify(tempPayload), "utf8") >
          MCP_SECRET_PAYLOAD_LIMIT_BYTES
        ) {
          if (options?.strict) {
            throw new Error(`MCP_SECRET_PAYLOAD_BUDGET_EXCEEDED:${server.id}`);
          }
          skipped.push({
            serverId: server.id,
            envName,
            reason: "payload-budget-exceeded",
          });
          continue;
        }
        values[envName] = value;
      }
      payloadServers[server.id] = values;
      summaryServers[server.id] = Object.keys(values).sort();
    }
  }
  return {
    payload: { servers: payloadServers, http_urls: payloadHttpUrls },
    summary: { servers: summaryServers, http_urls: summaryHttpUrls },
    skipped,
  };
}

export interface McpMigrationFailedServer {
  id: string;
  name: string;
}

export interface McpMigrationResult {
  migratedCount: number;
  failedServers: McpMigrationFailedServer[];
  changed: boolean;
}

function isValidMigrationUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.length > MAX_MCP_URL_CHARS) return false;
  for (let i = 0; i < rawUrl.length; i++) {
    const code = rawUrl.charCodeAt(i);
    if (code <= 32 || code === 127) return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!parsed.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

/** Migrate legacy plaintext URLs (v0.1.59~0.1.63) into Obsidian secretStorage.
 *  Settings are scrubbed to safe origins ONLY after secret storage write and read-back succeed.
 *  Once marked migrated, missing secrets never re-seed from safe origins. */
export function migrateMcpHttpUrls(
  app: App,
  settings: { mcpServers: McpServerSettings[]; mcpHttpUrlsMigrated?: boolean },
): McpMigrationResult {
  if (settings.mcpHttpUrlsMigrated === true) {
    return { migratedCount: 0, failedServers: [], changed: false };
  }

  let migratedCount = 0;
  let changed = false;
  const failedServers: McpMigrationFailedServer[] = [];

  for (const server of settings.mcpServers || []) {
    if (server.transport !== "http") continue;
    const rawUrl = server.url || "";
    if (!rawUrl) continue;

    if (!isValidMigrationUrl(rawUrl)) {
      server.enabled = false;
      failedServers.push({ id: server.id, name: server.name || server.id });
      changed = true;
      continue;
    }

    const safeOrigin = toSafeOrigin(rawUrl);
    if (!safeOrigin) {
      server.enabled = false;
      failedServers.push({ id: server.id, name: server.name || server.id });
      changed = true;
      continue;
    }

    let storedUrl: string | null = null;
    try {
      storedUrl = getMcpHttpUrl(app, server.id);
    } catch {
      server.enabled = false;
      failedServers.push({ id: server.id, name: server.name || server.id });
      changed = true;
      continue;
    }

    if (!storedUrl) {
      // SecretStorage is empty: migrate rawUrl
      try {
        setMcpHttpUrl(app, server.id, rawUrl);
        const verified = getMcpHttpUrl(app, server.id);
        if (verified === rawUrl) {
          server.url = safeOrigin;
          migratedCount++;
          changed = true;
        } else {
          throw new Error("Secret storage verification failed");
        }
      } catch {
        server.enabled = false;
        try {
          deleteMcpHttpUrl(app, server.id);
        } catch {
          /* ignore */
        }
        failedServers.push({ id: server.id, name: server.name || server.id });
        changed = true;
      }
    } else {
      // SecretStorage already has a storedUrl
      const storedOrigin = toSafeOrigin(storedUrl);
      if (rawUrl === safeOrigin) {
        // rawUrl is already a safe origin: validate storedUrl and origin match!
        if (!isValidMigrationUrl(storedUrl) || !storedOrigin || storedOrigin !== safeOrigin) {
          server.enabled = false;
          try {
            deleteMcpHttpUrl(app, server.id);
            const verifiedDeleted = getMcpHttpUrl(app, server.id);
            if (verifiedDeleted !== null) {
              console.warn(
                `[vault-search] Stale MCP secret deletion not confirmed for server ${server.id} (MCP_SECRET_DELETE_UNCONFIRMED)`,
              );
            }
          } catch {
            console.warn(
              `[vault-search] Stale MCP secret deletion error for server ${server.id} (MCP_SECRET_DELETE_FAILED)`,
            );
          }
          failedServers.push({ id: server.id, name: server.name || server.id });
          changed = true;
          continue;
        }
        // Valid stored full URL: preserve it, do NOT overwrite with safe origin!
        if (server.url !== safeOrigin) {
          server.url = safeOrigin;
          changed = true;
        }
        migratedCount++;
      } else if (storedUrl === rawUrl) {
        // storedUrl matches legacy raw URL: scrub persisted URL to safe origin
        server.url = safeOrigin;
        migratedCount++;
        changed = true;
      } else {
        // rawUrl has path/query/userinfo and differs from storedUrl:
        // Write rawUrl to SecretStorage and read-back before scrubbing
        try {
          setMcpHttpUrl(app, server.id, rawUrl);
          const verified = getMcpHttpUrl(app, server.id);
          if (verified === rawUrl) {
            server.url = safeOrigin;
            migratedCount++;
            changed = true;
          } else {
            throw new Error("Secret storage verification failed");
          }
        } catch {
          server.enabled = false;
          failedServers.push({ id: server.id, name: server.name || server.id });
          changed = true;
        }
      }
    }
  }

  if (failedServers.length === 0) {
    settings.mcpHttpUrlsMigrated = true;
    changed = true;
  }

  return { migratedCount, failedServers, changed };
}
