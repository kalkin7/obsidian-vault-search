import { createHash } from "crypto";
import type { App, SecretStorage } from "obsidian";
import type { McpServerSettings } from "./types";
import {
  MCP_SECRET_NAME_MAX,
  MCP_SECRET_PAYLOAD_LIMIT_BYTES,
  MCP_SECRET_VALUE_MAX,
} from "./constants";

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
  const value = storage(app)?.getSecret(mcpSecretId(serverId, envName));
  return value === null || value === undefined ? null : value;
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
  secretStorage.setSecret(mcpSecretId(serverId, envName), value);
}

export function deleteMcpSecret(
  app: App,
  serverId: string,
  envName: string,
): void {
  storage(app)?.setSecret(mcpSecretId(serverId, envName), "");
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
}

export interface McpSecretPayloadResult {
  payload: { servers: Record<string, Record<string, string>> };
  /** Servers included and their env names — safe to log/display. */
  summary: Record<string, string[]>;
  skipped: Array<{ serverId: string; envName: string; reason: string }>;
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
): McpSecretPayloadResult {
  const payloadServers: Record<string, Record<string, string>> = {};
  const summary: Record<string, string[]> = {};
  const skipped: McpSecretPayloadResult["skipped"] = [];
  let totalBytes = 0;
  for (const server of servers) {
    if (!server.enabled) continue;
    const values: Record<string, string> = {};
    for (const envName of server.envNames || []) {
      if (!envName || envName.length > MCP_SECRET_NAME_MAX) {
        skipped.push({ serverId: server.id, envName, reason: "invalid-name" });
        continue;
      }
      const value = getMcpSecret(app, server.id, envName);
      if (value === null || value === "") continue;
      const size = Buffer.byteLength(envName) + Buffer.byteLength(value);
      if (value.length > MCP_SECRET_VALUE_MAX) {
        skipped.push({ serverId: server.id, envName, reason: "value-too-large" });
        continue;
      }
      if (totalBytes + size > MCP_SECRET_PAYLOAD_LIMIT_BYTES) {
        skipped.push({
          serverId: server.id,
          envName,
          reason: "payload-budget-exceeded",
        });
        continue;
      }
      totalBytes += size;
      values[envName] = value;
    }
    payloadServers[server.id] = values;
    summary[server.id] = Object.keys(values).sort();
  }
  return { payload: { servers: payloadServers }, summary, skipped };
}
