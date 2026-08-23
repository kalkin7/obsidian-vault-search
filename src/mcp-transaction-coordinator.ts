import type { App } from "obsidian";
import {
  deleteMcpHttpUrl,
  deleteMcpSecret,
  deleteServerSecrets,
  getMcpHttpUrl,
  getMcpSecret,
  setMcpHttpUrl,
  setMcpSecret,
} from "./mcp-secrets";
import { cloneSettings } from "./settings";
import { toSafeOrigin } from "./mcp-server-form";
import type { McpServerSettings, VaultSearchSettings } from "./types";
import type { StagedSecrets } from "./mcp-server-modal";

export interface McpTransactionOwner {
  app: App;
  draftSettings: VaultSearchSettings;
  settings: VaultSearchSettings;
  backend: {
    status: { state: string };
    sendMcpSecrets(options?: { strict?: boolean }): Promise<void>;
  };
  applyDraftSettings(options?: { unlocked?: boolean }): Promise<void>;
  applyDraftSettingsUnlocked?(): Promise<void>;
  saveSettings(): Promise<void>;
  restoreDraftInPlace?(settings: VaultSearchSettings): void;
  restoreMcpServersInPlace?(servers: McpServerSettings[]): void;
  cancelPendingDraftApply?(): void;
  withTransactionLock?<T>(action: () => Promise<T>): Promise<T>;
  settingTab?: { display(): void };
}

export interface SanitizationContext {
  redactValues?: Array<string | null | undefined>;
}

export function sanitizeSecretMessage(
  message: string,
  context?: SanitizationContext | Array<string | null | undefined>,
): string {
  if (!message) return "";

  let sanitized = message;

  // 1. Replace full URLs with safe origins (stripping path, query, userinfo, hash)
  sanitized = sanitized.replace(/https?:\/\/[^\s"'`<>]+/g, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      const port = parsed.port ? `:${parsed.port}` : "";
      return `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
      return "[redacted-url]";
    }
  });

  // 2. Extract explicit secret candidate values (non-URLs and credentials/queries from URLs)
  const candidates: string[] = [];
  const addCandidate = (val: unknown) => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.password && parsed.password.length >= 4) {
            candidates.push(parsed.password);
          }
          if (parsed.username && parsed.username.length >= 4) {
            candidates.push(parsed.username);
          }
          for (const paramVal of parsed.searchParams.values()) {
            if (paramVal && paramVal.length >= 4) {
              candidates.push(paramVal);
            }
          }
        } catch {
          // ignore
        }
      } else if (trimmed.length >= 4) {
        candidates.push(trimmed);
      }
    }
  };

  if (Array.isArray(context)) {
    for (const v of context) addCandidate(v);
  } else if (context?.redactValues) {
    for (const v of context.redactValues) addCandidate(v);
  }

  // Sort descending by length so longer specific secrets are replaced first
  candidates.sort((a, b) => b.length - a.length);

  for (const cand of candidates) {
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sanitized = sanitized.replace(new RegExp(escaped, "g"), "[redacted-secret]");
  }

  return sanitized;
}

export function restoreDraftInPlace(
  target: VaultSearchSettings,
  source: VaultSearchSettings,
): void {
  for (const key of Object.keys(target) as Array<keyof VaultSearchSettings>) {
    if (!(key in source)) {
      delete (target as any)[key];
    }
  }
  Object.assign(target, cloneSettings(source));
}

function restoreSingleEnvSecretWithVerification(
  app: App,
  serverId: string,
  name: string,
  val: string | null,
): void {
  try {
    if (val === null || val === "") {
      try {
        deleteMcpSecret(app, serverId, name);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 삭제에 실패했습니다.`,
        );
      }
      let readBack: string | null = null;
      try {
        readBack = getMcpSecret(app, serverId, name);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 삭제 검증에 실패했습니다.`,
        );
      }
      if (readBack !== null) {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 삭제 검증에 실패했습니다.`,
        );
      }
    } else {
      try {
        setMcpSecret(app, serverId, name, val);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 저장에 실패했습니다.`,
        );
      }
      let readBack: string | null = null;
      try {
        readBack = getMcpSecret(app, serverId, name);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 검증에 실패했습니다.`,
        );
      }
      if (readBack !== val) {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백 검증에 실패했습니다.`,
        );
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("MCP_SECRET_RESTORE_FAILED:")
    ) {
      throw err;
    }
    throw new Error(
      `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 환경 변수(${name}) 보안 저장소 롤백에 실패했습니다.`,
    );
  }
}

function restoreSingleHttpUrlWithVerification(
  app: App,
  serverId: string,
  httpUrl: string | null,
): void {
  try {
    if (httpUrl === null || httpUrl === "") {
      try {
        deleteMcpHttpUrl(app, serverId);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 삭제에 실패했습니다.`,
        );
      }
      let readBack: string | null = null;
      try {
        readBack = getMcpHttpUrl(app, serverId);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 삭제 검증에 실패했습니다.`,
        );
      }
      if (readBack !== null) {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 삭제 검증에 실패했습니다.`,
        );
      }
    } else {
      try {
        setMcpHttpUrl(app, serverId, httpUrl);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 저장에 실패했습니다.`,
        );
      }
      let readBack: string | null = null;
      try {
        readBack = getMcpHttpUrl(app, serverId);
      } catch {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 검증에 실패했습니다.`,
        );
      }
      if (readBack !== httpUrl) {
        throw new Error(
          `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백 검증에 실패했습니다.`,
        );
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("MCP_SECRET_RESTORE_FAILED:")
    ) {
      throw err;
    }
    throw new Error(
      `MCP_SECRET_RESTORE_FAILED: 서버(${serverId}) 원격 URL 보안 저장소 롤백에 실패했습니다.`,
    );
  }
}

export function cloneMcpServers(
  servers: McpServerSettings[],
): McpServerSettings[] {
  return (servers || []).map((server) => ({
    ...server,
    args: [...(server.args || [])],
    envNames: [...(server.envNames || [])],
    toolPolicies: { ...(server.toolPolicies || {}) },
  }));
}

export class McpTransactionCoordinator {
  constructor(private readonly owner: McpTransactionOwner) {}

  private setDraftMcpServers(servers: McpServerSettings[]): void {
    if (typeof this.owner.restoreMcpServersInPlace === "function") {
      this.owner.restoreMcpServersInPlace(servers);
    } else {
      this.owner.draftSettings.mcpServers = servers;
    }
  }

  private restoreDraftMcpServers(
    servers: McpServerSettings[],
    fullBackup: VaultSearchSettings,
  ): void {
    if (typeof this.owner.restoreMcpServersInPlace === "function") {
      this.owner.restoreMcpServersInPlace(servers);
    } else if (typeof this.owner.restoreDraftInPlace === "function") {
      const merged = cloneSettings(this.owner.draftSettings);
      merged.mcpServers = cloneMcpServers(servers);
      this.owner.restoreDraftInPlace(merged);
    } else {
      this.owner.draftSettings.mcpServers = cloneMcpServers(servers);
    }
  }

  private async applyStructuralSettings(): Promise<void> {
    if (typeof this.owner.applyDraftSettingsUnlocked === "function") {
      await this.owner.applyDraftSettingsUnlocked();
    } else {
      await this.owner.applyDraftSettings({ unlocked: true });
    }
  }

  /** Save an MCP server's structural settings and staged secrets in an atomic
   *  transaction. If secret storage write, settings application (including
   *  sidecar restart), or live secret handoff fails, all storage and running
   *  state is rolled back to the pre-transaction snapshot. */
  async saveServer(
    savedWorking: McpServerSettings,
    staged: StagedSecrets,
  ): Promise<void> {
    if (typeof this.owner.withTransactionLock === "function") {
      return this.owner.withTransactionLock(() =>
        this.saveServerInternal(savedWorking, staged),
      );
    }
    return this.saveServerInternal(savedWorking, staged);
  }

  private async saveServerInternal(
    savedWorking: McpServerSettings,
    staged: StagedSecrets,
  ): Promise<void> {
    this.owner.cancelPendingDraftApply?.();

    // 1. Snapshot previous state for atomic rollback within safe boundary
    let previousMcpServers: McpServerSettings[];
    let previousDraft: VaultSearchSettings;
    let secretSnapshot: {
      env: Record<string, string | null>;
      httpUrl: string | null;
    };
    let redactionCandidates: string[] = [];
    let allEnvKeys = new Set<string>();
    const isNewServer = !(this.owner.draftSettings.mcpServers || []).some(
      (s) => s.id === savedWorking.id,
    );

    try {
      previousMcpServers = cloneMcpServers(
        this.owner.draftSettings.mcpServers || [],
      );
      previousDraft = cloneSettings(this.owner.draftSettings);
      secretSnapshot = {
        env: {},
        httpUrl: getMcpHttpUrl(this.owner.app, savedWorking.id),
      };
      const previousServer = previousMcpServers.find(
        (s) => s.id === savedWorking.id,
      );
      allEnvKeys = new Set([
        ...(previousServer?.envNames || []),
        ...savedWorking.envNames,
        ...Object.keys(staged.envValues),
        ...staged.removedEnvNames,
      ]);
      for (const envName of allEnvKeys) {
        secretSnapshot.env[envName] = getMcpSecret(
          this.owner.app,
          savedWorking.id,
          envName,
        );
      }

      redactionCandidates = [
        staged.httpUrl,
        secretSnapshot.httpUrl,
        ...Object.values(staged.envValues),
        ...Object.values(secretSnapshot.env),
      ].filter((v): v is string => Boolean(v));
    } catch {
      throw new Error(
        `MCP_SECRET_SNAPSHOT_FAILED: 서버(${savedWorking.id}) 보안 저장소 스냅샷 읽기에 실패했습니다.`,
      );
    }

    let structuralApplySucceeded = false;

    try {
      // 2. Commit staged secrets with read-back verification and cross-transport cleanup
      try {
        if (savedWorking.transport === "stdio") {
          try {
            deleteMcpHttpUrl(this.owner.app, savedWorking.id);
          } catch {
            throw new Error(
              `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제에 실패했습니다.`,
            );
          }
          let verifiedUrl: string | null = null;
          try {
            verifiedUrl = getMcpHttpUrl(this.owner.app, savedWorking.id);
          } catch {
            throw new Error(
              `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
            );
          }
          if (verifiedUrl !== null) {
            throw new Error(
              `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
            );
          }
          for (const [name, val] of Object.entries(staged.envValues)) {
            try {
              setMcpSecret(this.owner.app, savedWorking.id, name, val);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 저장에 실패했습니다.`,
              );
            }
            let readBack: string | null = null;
            try {
              readBack = getMcpSecret(this.owner.app, savedWorking.id, name);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 검증에 실패했습니다.`,
              );
            }
            if (readBack !== val) {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 검증에 실패했습니다.`,
              );
            }
          }
          for (const name of staged.removedEnvNames) {
            try {
              deleteMcpSecret(this.owner.app, savedWorking.id, name);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제에 실패했습니다.`,
              );
            }
            let readBack: string | null = null;
            try {
              readBack = getMcpSecret(this.owner.app, savedWorking.id, name);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제 검증에 실패했습니다.`,
              );
            }
            if (readBack !== null) {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제 검증에 실패했습니다.`,
              );
            }
          }
        } else {
          // HTTP transport: purge any stale env secrets for this server
          for (const name of allEnvKeys) {
            try {
              deleteMcpSecret(this.owner.app, savedWorking.id, name);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제에 실패했습니다.`,
              );
            }
            let readBack: string | null = null;
            try {
              readBack = getMcpSecret(this.owner.app, savedWorking.id, name);
            } catch {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제 검증에 실패했습니다.`,
              );
            }
            if (readBack !== null) {
              throw new Error(
                `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 환경 변수(${name}) 보안 저장소 삭제 검증에 실패했습니다.`,
              );
            }
          }
          if (staged.httpUrl !== undefined) {
            if (staged.httpUrl === null || staged.httpUrl === "") {
              try {
                deleteMcpHttpUrl(this.owner.app, savedWorking.id);
              } catch {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제에 실패했습니다.`,
                );
              }
              let verified: string | null = null;
              try {
                verified = getMcpHttpUrl(this.owner.app, savedWorking.id);
              } catch {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
                );
              }
              if (verified !== null) {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
                );
              }
            } else {
              try {
                setMcpHttpUrl(this.owner.app, savedWorking.id, staged.httpUrl);
              } catch {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 저장에 실패했습니다.`,
                );
              }
              let readBack: string | null = null;
              try {
                readBack = getMcpHttpUrl(this.owner.app, savedWorking.id);
              } catch {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 검증에 실패했습니다.`,
                );
              }
              if (readBack !== staged.httpUrl) {
                throw new Error(
                  `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 원격 URL 보안 저장소 검증에 실패했습니다.`,
                );
              }
            }
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("MCP_SECRET_COMMIT_FAILED:")
        ) {
          throw err;
        }
        throw new Error(
          `MCP_SECRET_COMMIT_FAILED: 서버(${savedWorking.id}) 보안 저장소 반영에 실패했습니다.`,
        );
      }

      // 3. Update ONLY draftSettings.mcpServers in-place
      const servers = [...(this.owner.draftSettings.mcpServers || [])];
      const index = servers.findIndex(
        (server) => server.id === savedWorking.id,
      );
      if (index >= 0) servers[index] = savedWorking;
      else servers.push(savedWorking);
      this.setDraftMcpServers(servers);

      // 4. Pass through structural apply boundary
      await this.applyStructuralSettings();
      structuralApplySucceeded = true;

      // 5. Strict secret handoff to live sidecar
      if (this.owner.backend.status.state !== "stopped") {
        await this.owner.backend.sendMcpSecrets({ strict: true });
      }
    } catch (origError) {
      // 6. Full atomic rollback with isolated phases
      const rollbackErrors: string[] = [];
      let secretRestoreFailed = false;

      this.owner.cancelPendingDraftApply?.();

      // Phase 1: Independent secret restoration with read-back verification
      for (const [name, val] of Object.entries(secretSnapshot.env)) {
        try {
          restoreSingleEnvSecretWithVerification(
            this.owner.app,
            savedWorking.id,
            name,
            val,
          );
        } catch (err) {
          secretRestoreFailed = true;
          rollbackErrors.push(
            sanitizeSecretMessage(
              err instanceof Error ? err.message : String(err),
              redactionCandidates,
            ),
          );
        }
      }

      try {
        restoreSingleHttpUrlWithVerification(
          this.owner.app,
          savedWorking.id,
          secretSnapshot.httpUrl,
        );
      } catch (err) {
        secretRestoreFailed = true;
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 2: In-place restore old draft MCP slice
      const restoredServers = cloneMcpServers(previousMcpServers);
      if (secretRestoreFailed) {
        const idx = restoredServers.findIndex((s) => s.id === savedWorking.id);
        if (idx >= 0) {
          restoredServers[idx] = { ...restoredServers[idx], enabled: false };
        } else {
          const recoveryServer: McpServerSettings = {
            id: savedWorking.id,
            name: savedWorking.name || savedWorking.id,
            transport: savedWorking.transport,
            command: savedWorking.command || "",
            args: savedWorking.args ? [...savedWorking.args] : [],
            cwd: savedWorking.cwd || "vault",
            url: savedWorking.url ? toSafeOrigin(savedWorking.url) : "",
            envNames: savedWorking.envNames ? [...savedWorking.envNames] : [],
            toolPolicies: savedWorking.toolPolicies
              ? { ...savedWorking.toolPolicies }
              : {},
            enabled: false,
          };
          restoredServers.push(recoveryServer);
        }
        rollbackErrors.push(`MCP_SERVER_RECOVERY_DISABLED: ${savedWorking.id}`);
      }
      try {
        this.restoreDraftMcpServers(restoredServers, previousDraft);
      } catch (err) {
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 3: Structural apply rollback / recovery
      let structuralRollbackSucceeded = false;
      try {
        await this.applyStructuralSettings();
        structuralRollbackSucceeded = true;
      } catch (err) {
        structuralRollbackSucceeded = false;
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 4: Strict handoff of restored secrets to live backend
      if (
        structuralRollbackSucceeded &&
        this.owner.backend.status.state !== "stopped"
      ) {
        try {
          await this.owner.backend.sendMcpSecrets({ strict: true });
        } catch (err) {
          rollbackErrors.push(
            sanitizeSecretMessage(
              err instanceof Error ? err.message : String(err),
              redactionCandidates,
            ),
          );
        }
      }

      const origMessage = sanitizeSecretMessage(
        origError instanceof Error ? origError.message : String(origError),
        redactionCandidates,
      );
      if (rollbackErrors.length > 0) {
        const rollbackMessage = rollbackErrors.join("; ");
        throw new Error(
          `MCP_TRANSACTION_FAILED: ${origMessage}; MCP_ROLLBACK_FAILED: ${rollbackMessage}`,
        );
      }
      throw new Error(origMessage);
    }

    try {
      this.owner.settingTab?.display();
    } catch {
      // UI render failures after successful transaction commit must not rollback
    }
  }

  /** Delete an MCP server in an atomic transaction: purges its secrets,
   *  updates draft settings, re-applies settings to rebuild/restart the sidecar,
   *  and verifies the removal. */
  async deleteServer(serverId: string): Promise<void> {
    if (typeof this.owner.withTransactionLock === "function") {
      return this.owner.withTransactionLock(() =>
        this.deleteServerInternal(serverId),
      );
    }
    return this.deleteServerInternal(serverId);
  }

  private async deleteServerInternal(serverId: string): Promise<void> {
    this.owner.cancelPendingDraftApply?.();

    let previousMcpServers: McpServerSettings[];
    let previousDraft: VaultSearchSettings;
    let server: McpServerSettings | undefined;
    let secretSnapshot: {
      env: Record<string, string | null>;
      httpUrl: string | null;
    };
    let redactionCandidates: string[] = [];

    try {
      previousMcpServers = cloneMcpServers(
        this.owner.draftSettings.mcpServers || [],
      );
      previousDraft = cloneSettings(this.owner.draftSettings);
      server = previousMcpServers.find((entry) => entry.id === serverId);
      if (!server) return;

      secretSnapshot = {
        env: {},
        httpUrl: getMcpHttpUrl(this.owner.app, server.id),
      };
      for (const envName of server.envNames || []) {
        secretSnapshot.env[envName] = getMcpSecret(
          this.owner.app,
          server.id,
          envName,
        );
      }

      redactionCandidates = [
        secretSnapshot.httpUrl,
        ...Object.values(secretSnapshot.env),
      ].filter((v): v is string => Boolean(v));
    } catch {
      throw new Error(
        `MCP_SECRET_SNAPSHOT_FAILED: 서버(${serverId}) 보안 저장소 스냅샷 읽기에 실패했습니다.`,
      );
    }

    let structuralApplySucceeded = false;

    try {
      // 1. Purge secrets from secretStorage
      try {
        try {
          deleteServerSecrets(this.owner.app, server);
        } catch {
          throw new Error(
            `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 보안 저장소 삭제에 실패했습니다.`,
          );
        }

        // Verify secrets deleted
        let readBackUrl: string | null = null;
        try {
          readBackUrl = getMcpHttpUrl(this.owner.app, server.id);
        } catch {
          throw new Error(
            `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
          );
        }
        if (readBackUrl !== null) {
          throw new Error(
            `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 원격 URL 보안 저장소 삭제 검증에 실패했습니다.`,
          );
        }
        for (const envName of server.envNames || []) {
          let readBackEnv: string | null = null;
          try {
            readBackEnv = getMcpSecret(this.owner.app, server.id, envName);
          } catch {
            throw new Error(
              `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 환경 변수(${envName}) 보안 저장소 삭제 검증에 실패했습니다.`,
            );
          }
          if (readBackEnv !== null) {
            throw new Error(
              `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 환경 변수(${envName}) 보안 저장소 삭제 검증에 실패했습니다.`,
            );
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("MCP_SECRET_DELETE_FAILED:")
        ) {
          throw err;
        }
        throw new Error(
          `MCP_SECRET_DELETE_FAILED: 서버(${server.id}) 보안 저장소 삭제에 실패했습니다.`,
        );
      }

      // 2. Remove from draftSettings in-place
      this.setDraftMcpServers(
        (this.owner.draftSettings.mcpServers || []).filter(
          (entry) => entry.id !== serverId,
        ),
      );

      // 3. Re-apply settings (sidecar restarts and updates service-config.json)
      await this.applyStructuralSettings();
      structuralApplySucceeded = true;

      // 4. Update secrets snapshot on live sidecar
      if (this.owner.backend.status.state !== "stopped") {
        await this.owner.backend.sendMcpSecrets({ strict: true });
      }
    } catch (origError) {
      const rollbackErrors: string[] = [];
      let secretRestoreFailed = false;

      this.owner.cancelPendingDraftApply?.();

      // Phase 1: Independent secret restoration
      for (const [name, val] of Object.entries(secretSnapshot.env)) {
        try {
          restoreSingleEnvSecretWithVerification(
            this.owner.app,
            server.id,
            name,
            val,
          );
        } catch (err) {
          secretRestoreFailed = true;
          rollbackErrors.push(
            sanitizeSecretMessage(
              err instanceof Error ? err.message : String(err),
              redactionCandidates,
            ),
          );
        }
      }

      try {
        restoreSingleHttpUrlWithVerification(
          this.owner.app,
          server.id,
          secretSnapshot.httpUrl,
        );
      } catch (err) {
        secretRestoreFailed = true;
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 2: In-place restore old draft MCP slice
      const restoredServers = cloneMcpServers(previousMcpServers);
      if (secretRestoreFailed) {
        const idx = restoredServers.findIndex((s) => s.id === server.id);
        if (idx >= 0) {
          restoredServers[idx] = { ...restoredServers[idx], enabled: false };
        }
        rollbackErrors.push(`MCP_SERVER_RECOVERY_DISABLED: ${server.id}`);
      }
      try {
        this.restoreDraftMcpServers(restoredServers, previousDraft);
      } catch (err) {
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 3: Re-apply old draft
      let structuralRollbackSucceeded = false;
      try {
        await this.applyStructuralSettings();
        structuralRollbackSucceeded = true;
      } catch (err) {
        structuralRollbackSucceeded = false;
        rollbackErrors.push(
          sanitizeSecretMessage(
            err instanceof Error ? err.message : String(err),
            redactionCandidates,
          ),
        );
      }

      // Phase 4: Strict handoff restored secrets
      if (
        structuralRollbackSucceeded &&
        this.owner.backend.status.state !== "stopped"
      ) {
        try {
          await this.owner.backend.sendMcpSecrets({ strict: true });
        } catch (err) {
          rollbackErrors.push(
            sanitizeSecretMessage(
              err instanceof Error ? err.message : String(err),
              redactionCandidates,
            ),
          );
        }
      }

      const origMessage = sanitizeSecretMessage(
        origError instanceof Error ? origError.message : String(origError),
        redactionCandidates,
      );
      if (rollbackErrors.length > 0) {
        const rollbackMessage = rollbackErrors.join("; ");
        throw new Error(
          `MCP_TRANSACTION_FAILED: ${origMessage}; MCP_ROLLBACK_FAILED: ${rollbackMessage}`,
        );
      }
      throw new Error(origMessage);
    }

    try {
      this.owner.settingTab?.display();
    } catch {
      // UI render failures after successful transaction commit must not rollback
    }
  }
}

