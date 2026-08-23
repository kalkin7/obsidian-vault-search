import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  McpTransactionCoordinator,
  cloneMcpServers,
  sanitizeSecretMessage,
  type McpTransactionOwner,
} from "../../src/mcp-transaction-coordinator";
import {
  buildMcpSecretPayload,
  getMcpHttpUrl,
  getMcpSecret,
  mcpSecretId,
  setMcpHttpUrl,
  setMcpSecret,
} from "../../src/mcp-secrets";
import { DEFAULT_SETTINGS } from "../../src/constants";
import { cloneSettings, settingsImpact } from "../../src/settings";
import type { McpServerSettings, VaultSearchSettings } from "../../src/types";

function createMockApp(): App {
  const secretStore = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: (key: string) => secretStore.get(key) ?? null,
      setSecret: (key: string, value: string) => {
        secretStore.set(key, value);
      },
      deleteSecret: (key: string) => {
        secretStore.delete(key);
      },
      listSecrets: () => Array.from(secretStore.keys()),
    },
  } as unknown as App;
}

interface MockSeamOwner extends McpTransactionOwner {
  dataJson: VaultSearchSettings;
  serviceConfigJson: VaultSearchSettings;
  sidecarGeneration: number;
  sidecarConfig: VaultSearchSettings;
  sidecarSecrets: any;
  draftDirty: boolean;
  draftApplyTimer: any;
  events: string[];
  getMaxConcurrency(): number;
  triggerPendingDebounce(): Promise<void>;
  scheduleDraftApply(): void;
  applyDraftSettingsUnlocked(): Promise<void>;
  setAnswerModel(provider: string, model: string): Promise<void>;
  setAnswerReasoningEffort(effort: string): Promise<void>;
  toggleFavoriteModel(provider: string, model: string): Promise<void>;
  setProviderModels(provider: string, models: string[]): Promise<void>;
}

function createMockOwner(options?: {
  app?: App;
  applyError?: Error | null;
  failApplyTimes?: number;
  handoffError?: Error | null;
  failHandoffTimes?: number;
  handoffResults?: Array<Error | null>;
  backendRunning?: boolean;
  initialSettings?: Partial<VaultSearchSettings>;
  onApply?: (callNumber: number) => Promise<void> | void;
  onHandoff?: (callNumber: number) => Promise<void> | void;
  debounceMs?: number;
}): {
  owner: MockSeamOwner;
  app: App;
  applyDraftSettingsCalls: number;
  sendMcpSecretsCalls: number;
  events: string[];
} {
  const app = options?.app || createMockApp();
  let applyCalls = 0;
  let handoffCalls = 0;
  let failHandoffCount =
    options?.failHandoffTimes !== undefined
      ? options.failHandoffTimes
      : options?.handoffError
        ? 1
        : 0;
  const handoffQueue = options?.handoffResults
    ? [...options.handoffResults]
    : null;

  let failApplyCount =
    options?.failApplyTimes !== undefined
      ? options.failApplyTimes
      : options?.applyError
        ? 1
        : 0;

  const baseSettings: VaultSearchSettings = {
    ...DEFAULT_SETTINGS,
    mcpServers: [],
    ...(options?.initialSettings || {}),
  };

  const draftTarget = cloneSettings(baseSettings);
  let draftDirty = false;
  let draftApplyTimer: any = null;

  const dataJson = cloneSettings(baseSettings);
  const serviceConfigJson = cloneSettings(baseSettings);
  let sidecarGeneration = options?.backendRunning === false ? 0 : 1;
  const sidecarConfig = cloneSettings(baseSettings);
  let sidecarSecrets: any = null;

  let settingsQueue: Promise<void> = Promise.resolve();
  let concurrentCount = 0;
  let maxConcurrency = 0;
  const events: string[] = [];

  async function enqueueSettingsLock<T>(action: () => Promise<T>): Promise<T> {
    const prevQueue = settingsQueue;
    let releaseLock!: () => void;
    settingsQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prevQueue.catch(() => undefined);
    concurrentCount++;
    if (concurrentCount > maxConcurrency) maxConcurrency = concurrentCount;
    try {
      return await action();
    } finally {
      concurrentCount--;
      releaseLock();
    }
  }

  const syncDraftTo = (settings: VaultSearchSettings) => {
    for (const key of Object.keys(draftTarget) as Array<
      keyof VaultSearchSettings
    >) {
      if (!(key in settings)) {
        delete (draftTarget as any)[key];
      }
    }
    Object.assign(draftTarget, cloneSettings(settings));
  };

  const owner: MockSeamOwner = {
    app,
    draftSettings: null as any,
    settings: cloneSettings(baseSettings),
    dataJson,
    serviceConfigJson,
    sidecarGeneration,
    sidecarConfig,
    sidecarSecrets,
    events,
    getMaxConcurrency: () => maxConcurrency,
    get draftDirty() {
      return draftDirty;
    },
    set draftDirty(val: boolean) {
      draftDirty = val;
    },
    get draftApplyTimer() {
      return draftApplyTimer;
    },
    set draftApplyTimer(val: any) {
      draftApplyTimer = val;
    },
    backend: {
      status: {
        state: options?.backendRunning === false ? "stopped" : "ready",
      },
      sendMcpSecrets: vi.fn(async (opts?: { strict?: boolean }) => {
        handoffCalls++;
        events.push(`handoff-start:${handoffCalls}`);
        if (options?.onHandoff) await options.onHandoff(handoffCalls);
        if (handoffQueue && handoffQueue.length > 0) {
          const err = handoffQueue.shift();
          if (err) throw err;
        } else if (failHandoffCount > 0) {
          failHandoffCount--;
          throw options?.handoffError || new Error("Mock handoff failed");
        }
        const payload = buildMcpSecretPayload(
          app,
          owner.settings.mcpServers || [],
          opts,
        );
        owner.sidecarSecrets = payload.payload;
        events.push(`handoff-end:${handoffCalls}`);
      }),
    },
    cancelPendingDraftApply() {
      if (draftApplyTimer !== null) {
        clearTimeout(draftApplyTimer);
        draftApplyTimer = null;
      }
    },
    restoreDraftInPlace(source: VaultSearchSettings) {
      owner.cancelPendingDraftApply?.();
      syncDraftTo(source);
    },
    restoreMcpServersInPlace(servers: McpServerSettings[]) {
      draftTarget.mcpServers = cloneMcpServers(servers);
    },
    async withTransactionLock<T>(action: () => Promise<T>): Promise<T> {
      owner.cancelPendingDraftApply();
      events.push("lock-wait-start");
      return enqueueSettingsLock(async () => {
        owner.cancelPendingDraftApply();
        events.push("lock-acquired");
        try {
          return await action();
        } finally {
          events.push("lock-released");
          if (draftDirty) {
            owner.scheduleDraftApply();
          }
        }
      });
    },
    async saveSettings(): Promise<void> {
      owner.dataJson = cloneSettings(owner.settings);
      owner.serviceConfigJson = cloneSettings(owner.settings);
    },
    scheduleDraftApply() {
      if (draftApplyTimer !== null) clearTimeout(draftApplyTimer);
      draftApplyTimer = setTimeout(() => {
        draftApplyTimer = null;
        void owner.applyDraftSettings();
      }, options?.debounceMs ?? 700);
    },
    applyDraftSettings: vi.fn(async (opts?: { unlocked?: boolean }) => {
      if (opts?.unlocked) {
        return owner.applyDraftSettingsUnlocked();
      }
      return enqueueSettingsLock(async () => {
        owner.cancelPendingDraftApply();
        await owner.applyDraftSettingsUnlocked();
        if (draftDirty) {
          owner.scheduleDraftApply();
        }
      });
    }),
    applyDraftSettingsUnlocked: vi.fn(async () => {
      applyCalls++;
      events.push(`apply-start:${applyCalls}`);
      if (options?.onApply) await options.onApply(applyCalls);
      draftDirty = false;
      const previous = cloneSettings(owner.settings);
      const next = cloneSettings(owner.draftSettings);
      const impact = settingsImpact(previous, next);
      if (impact === "none") {
        events.push(`apply-none:${applyCalls}`);
        return;
      }

      if (failApplyCount > 0) {
        failApplyCount--;
        owner.settings = cloneSettings(previous);
        await owner.saveSettings();
        if (owner.backend.status.state !== "stopped") {
          owner.sidecarGeneration++;
          owner.sidecarConfig = cloneSettings(previous);
        }
        events.push(`apply-error:${applyCalls}`);
        throw options?.applyError || new Error("Apply failed");
      }

      if (impact === "restart" || impact === "all" || impact === "vectors") {
        owner.sidecarGeneration++;
        owner.settings = cloneSettings(next);
        await owner.saveSettings();
        owner.sidecarConfig = cloneSettings(next);
      } else {
        owner.settings = cloneSettings(next);
        await owner.saveSettings();
      }
      if (!draftDirty) {
        syncDraftTo(owner.settings);
      }
      events.push(`apply-end:${applyCalls}`);
    }),
    async triggerPendingDebounce() {
      if (draftApplyTimer !== null) {
        clearTimeout(draftApplyTimer);
        draftApplyTimer = null;
        await owner.applyDraftSettings();
      }
    },
    async setAnswerModel(provider: any, model: string) {
      return enqueueSettingsLock(async () => {
        owner.settings.answerProvider = provider;
        owner.settings.answerModel = model;
        owner.draftSettings.answerProvider = provider;
        owner.draftSettings.answerModel = model;
        await owner.saveSettings();
      });
    },
    async setAnswerReasoningEffort(effort: any) {
      return enqueueSettingsLock(async () => {
        owner.settings.answerReasoningEffort = effort;
        owner.draftSettings.answerReasoningEffort = effort;
        await owner.saveSettings();
      });
    },
    async toggleFavoriteModel(provider: any, model: string) {
      return enqueueSettingsLock(async () => {
        const favorites = (owner.settings.favoriteAnswerModels || []).map(
          (f) => ({ ...f }),
        );
        const idx = favorites.findIndex(
          (f) => f.provider === provider && f.model === model,
        );
        if (idx >= 0) favorites.splice(idx, 1);
        else favorites.push({ provider, model });
        owner.settings.favoriteAnswerModels = favorites;
        owner.draftSettings.favoriteAnswerModels = favorites.map((f) => ({
          ...f,
        }));
        await owner.saveSettings();
      });
    },
    async setProviderModels(provider: any, models: string[]) {
      return enqueueSettingsLock(async () => {
        owner.settings.fetchedProviderModels = {
          ...owner.settings.fetchedProviderModels,
          [provider]: models,
        };
        owner.draftSettings.fetchedProviderModels = {
          ...owner.draftSettings.fetchedProviderModels,
          [provider]: models,
        };
        await owner.saveSettings();
      });
    },
    settingTab: { display: vi.fn() },
  };

  owner.draftSettings = new Proxy(draftTarget, {
    set: (target, property, value) => {
      const applied = Reflect.set(target, property, value);
      if (applied) {
        draftDirty = true;
        owner.scheduleDraftApply();
      }
      return applied;
    },
  });

  return {
    owner,
    app,
    events,
    get applyDraftSettingsCalls() {
      return applyCalls;
    },
    get sendMcpSecretsCalls() {
      return handoffCalls;
    },
  };
}

describe("McpTransactionCoordinator", () => {
  it("saves a new server through applyDraftSettings without modifying settings directly beforehand", async () => {
    const { owner, app } = createMockOwner();
    const coordinator = new McpTransactionCoordinator(owner);

    const newServer: McpServerSettings = {
      id: "srv-new-1",
      name: "New HTTP",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };

    await coordinator.saveServer(newServer, {
      envValues: {},
      removedEnvNames: [],
      httpUrl: "https://mcp.example.com/mcp?token=xyz",
    });

    // 1. Secret committed and verified in secretStorage
    expect(getMcpHttpUrl(app, "srv-new-1")).toBe(
      "https://mcp.example.com/mcp?token=xyz",
    );

    // 2. Draft and settings updated through applyDraftSettings
    expect(owner.draftSettings.mcpServers).toHaveLength(1);
    expect(owner.draftSettings.mcpServers[0].id).toBe("srv-new-1");
    expect(owner.settings.mcpServers).toHaveLength(1);
    expect(owner.settings.mcpServers[0].url).toBe("https://mcp.example.com");

    // 3. Sidecar restarted and configs persisted
    expect(owner.sidecarGeneration).toBe(2);
    expect(owner.dataJson.mcpServers[0].id).toBe("srv-new-1");
    expect(owner.serviceConfigJson.mcpServers[0].id).toBe("srv-new-1");
    expect(owner.sidecarSecrets.http_urls["srv-new-1"]).toBe(
      "https://mcp.example.com/mcp?token=xyz",
    );
  });

  it("rolls back secrets, draft, and settings when applyDraftSettings fails", async () => {
    const applyError = new Error("Sidecar restart failed");
    const { owner, app } = createMockOwner({ applyError });
    const coordinator = new McpTransactionCoordinator(owner);

    const newServer: McpServerSettings = {
      id: "srv-fail-1",
      name: "Fail Server",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };

    await expect(
      coordinator.saveServer(newServer, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com/mcp?token=xyz",
      }),
    ).rejects.toThrow("Sidecar restart failed");

    // Secret storage rolled back (deleted)
    expect(getMcpHttpUrl(app, "srv-fail-1")).toBeNull();

    // Draft and settings remained empty
    expect(owner.draftSettings.mcpServers).toHaveLength(0);
    expect(owner.settings.mcpServers).toHaveLength(0);
    expect(owner.dataJson.mcpServers).toHaveLength(0);
    expect(owner.serviceConfigJson.mcpServers).toHaveLength(0);
  });

  it("rolls back secrets and settings when strict secret handoff fails", async () => {
    const handoffError = new Error("Backend rejected secret payload");
    const { owner, app } = createMockOwner({ handoffError });
    const coordinator = new McpTransactionCoordinator(owner);

    const newServer: McpServerSettings = {
      id: "srv-handoff-fail",
      name: "Handoff Fail",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };

    await expect(
      coordinator.saveServer(newServer, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com/mcp?token=xyz",
      }),
    ).rejects.toThrow("Backend rejected secret payload");

    // Secret rolled back
    expect(getMcpHttpUrl(app, "srv-handoff-fail")).toBeNull();
    // Settings restored to empty
    expect(owner.draftSettings.mcpServers).toHaveLength(0);
    expect(owner.settings.mcpServers).toHaveLength(0);
    expect(owner.dataJson.mcpServers).toHaveLength(0);
  });

  it("handles same-origin secret URL rotation without structural restart and pushes new secret", async () => {
    const existing: McpServerSettings = {
      id: "srv-rotate",
      name: "Rotated Server",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };
    const { owner, app } = createMockOwner({
      initialSettings: { mcpServers: [existing] },
    });
    setMcpHttpUrl(
      app,
      "srv-rotate",
      "https://mcp.example.com/mcp?token=old_token",
    );
    const initialGeneration = owner.sidecarGeneration;
    const coordinator = new McpTransactionCoordinator(owner);

    // Rotate token (safe origin https://mcp.example.com remains identical)
    await coordinator.saveServer(existing, {
      envValues: {},
      removedEnvNames: [],
      httpUrl: "https://mcp.example.com/mcp?token=new_fresh_token",
    });

    expect(getMcpHttpUrl(app, "srv-rotate")).toBe(
      "https://mcp.example.com/mcp?token=new_fresh_token",
    );
    // Structural impact is none so sidecar was not restarted
    expect(owner.sidecarGeneration).toBe(initialGeneration);
    expect(owner.sidecarSecrets.http_urls["srv-rotate"]).toBe(
      "https://mcp.example.com/mcp?token=new_fresh_token",
    );
  });

  it("deletes a server, purges its secrets, applies draft settings, and verifies deletion", async () => {
    const server: McpServerSettings = {
      id: "srv-to-del",
      name: "To Delete",
      transport: "stdio",
      command: "node",
      args: ["srv.js"],
      cwd: "vault",
      url: "",
      envNames: ["API_KEY"],
      toolPolicies: {},
      enabled: true,
    };
    const { owner, app } = createMockOwner({
      initialSettings: { mcpServers: [server] },
    });
    setMcpSecret(app, "srv-to-del", "API_KEY", "canary_key_123");
    const coordinator = new McpTransactionCoordinator(owner);

    await coordinator.deleteServer("srv-to-del");

    // 1. Secrets purged from storage
    expect(getMcpSecret(app, "srv-to-del", "API_KEY")).toBeNull();

    // 2. Removed from draft and settings and configs
    expect(owner.draftSettings.mcpServers).toHaveLength(0);
    expect(owner.settings.mcpServers).toHaveLength(0);
    expect(owner.dataJson.mcpServers).toHaveLength(0);
    expect(owner.serviceConfigJson.mcpServers).toHaveLength(0);

    // 3. Settings re-applied and secret snapshot updated
    expect(owner.sidecarGeneration).toBe(2);
    expect(owner.sidecarSecrets.servers["srv-to-del"]).toBeUndefined();
  });

  it("rolls back deletion if applyDraftSettings fails during delete", async () => {
    const server: McpServerSettings = {
      id: "srv-del-fail",
      name: "Del Fail",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };
    const applyError = new Error("Failed to restart after delete");
    const { owner, app } = createMockOwner({
      applyError,
      initialSettings: { mcpServers: [server] },
    });
    setMcpHttpUrl(app, "srv-del-fail", "https://mcp.example.com/mcp?token=xyz");
    const coordinator = new McpTransactionCoordinator(owner);

    await expect(coordinator.deleteServer("srv-del-fail")).rejects.toThrow(
      "Failed to restart after delete",
    );

    // Secret restored
    expect(getMcpHttpUrl(app, "srv-del-fail")).toBe(
      "https://mcp.example.com/mcp?token=xyz",
    );

    // Draft and settings server restored
    expect(owner.draftSettings.mcpServers).toHaveLength(1);
    expect(owner.settings.mcpServers).toHaveLength(1);
  });

  it("purges stale env secrets when a server is switched from stdio to http", async () => {
    const stdioServer: McpServerSettings = {
      id: "srv-switch-1",
      name: "Switch Server",
      transport: "stdio",
      command: "node",
      args: [],
      cwd: "vault",
      url: "",
      envNames: ["OLD_KEY"],
      toolPolicies: {},
      enabled: true,
    };
    const { owner, app } = createMockOwner({
      initialSettings: { mcpServers: [stdioServer] },
    });
    setMcpSecret(app, "srv-switch-1", "OLD_KEY", "old_env_secret");
    const coordinator = new McpTransactionCoordinator(owner);

    // Switch to HTTP
    const httpSwitched: McpServerSettings = {
      ...stdioServer,
      transport: "http",
      command: "",
      url: "https://mcp.example.com",
      envNames: [],
    };
    await coordinator.saveServer(httpSwitched, {
      envValues: {},
      removedEnvNames: [],
      httpUrl: "https://mcp.example.com/mcp?token=new_tok",
    });

    // Env secret was purged from storage, new HTTP URL was committed
    expect(getMcpSecret(app, "srv-switch-1", "OLD_KEY")).toBeNull();
    expect(getMcpHttpUrl(app, "srv-switch-1")).toBe(
      "https://mcp.example.com/mcp?token=new_tok",
    );
    expect(owner.sidecarSecrets.servers["srv-switch-1"]).toBeUndefined();
    expect(owner.sidecarSecrets.http_urls["srv-switch-1"]).toBe(
      "https://mcp.example.com/mcp?token=new_tok",
    );
  });

  it("purges stale HTTP URL when a server is switched from http to stdio", async () => {
    const httpServer: McpServerSettings = {
      id: "srv-switch-2",
      name: "Switch Server 2",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };
    const { owner, app } = createMockOwner({
      initialSettings: { mcpServers: [httpServer] },
    });
    setMcpHttpUrl(
      app,
      "srv-switch-2",
      "https://mcp.example.com/mcp?token=old_url_tok",
    );
    const coordinator = new McpTransactionCoordinator(owner);

    // Switch to stdio
    const stdioSwitched: McpServerSettings = {
      ...httpServer,
      transport: "stdio",
      command: "python",
      url: "",
      envNames: ["NEW_KEY"],
    };
    await coordinator.saveServer(stdioSwitched, {
      envValues: { NEW_KEY: "fresh_env_secret" },
      removedEnvNames: [],
      httpUrl: undefined,
    });

    // HTTP URL was purged from storage, new env secret was committed
    expect(getMcpHttpUrl(app, "srv-switch-2")).toBeNull();
    expect(getMcpSecret(app, "srv-switch-2", "NEW_KEY")).toBe(
      "fresh_env_secret",
    );
    expect(owner.sidecarSecrets.http_urls["srv-switch-2"]).toBeUndefined();
    expect(owner.sidecarSecrets.servers["srv-switch-2"]["NEW_KEY"]).toBe(
      "fresh_env_secret",
    );
  });

  // --------------------------------------------------------------------------
  // Cross-transport failure rollback tests (Requirement 2)
  // --------------------------------------------------------------------------

  it("rolls back cross-transport switch from stdio to HTTP on handoff failure", async () => {
    const stdioServer: McpServerSettings = {
      id: "srv-stdio-to-http-fail",
      name: "Stdio to HTTP Fail",
      transport: "stdio",
      command: "python",
      args: ["server.py"],
      cwd: "vault",
      url: "",
      envNames: ["STDIO_SECRET_KEY"],
      toolPolicies: {},
      enabled: true,
    };
    const handoffError = new Error(
      "Handoff failed: connection to https://mcp.example.com/mcp?token=raw_canary_tok was refused",
    );
    const { owner, app } = createMockOwner({
      handoffError,
      initialSettings: { mcpServers: [stdioServer] },
    });
    setMcpSecret(
      app,
      "srv-stdio-to-http-fail",
      "STDIO_SECRET_KEY",
      "canary_env_value_123",
    );
    const coordinator = new McpTransactionCoordinator(owner);

    const httpTarget: McpServerSettings = {
      ...stdioServer,
      transport: "http",
      command: "",
      args: [],
      url: "https://mcp.example.com",
      envNames: [],
    };

    // Execute saveServer switching stdio -> http
    await expect(
      coordinator.saveServer(httpTarget, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com/mcp?token=raw_canary_tok",
      }),
    ).rejects.toThrow();

    // 1. SecretStorage restored: env secret restored, HTTP URL absent
    expect(
      getMcpSecret(app, "srv-stdio-to-http-fail", "STDIO_SECRET_KEY"),
    ).toBe("canary_env_value_123");
    expect(getMcpHttpUrl(app, "srv-stdio-to-http-fail")).toBeNull();

    // 2. Settings & draft rolled back to stdio
    expect(owner.settings.mcpServers[0].transport).toBe("stdio");
    expect(owner.settings.mcpServers[0].command).toBe("python");
    expect(owner.draftSettings.mcpServers[0].transport).toBe("stdio");

    // 3. Persisted configs rolled back
    expect(owner.dataJson.mcpServers[0].transport).toBe("stdio");
    expect(owner.serviceConfigJson.mcpServers[0].transport).toBe("stdio");

    // 4. Sidecar restarted back to stdio generation
    expect(owner.sidecarGeneration).toBe(3);
    expect(owner.sidecarConfig.mcpServers[0].transport).toBe("stdio");
  });

  it("rolls back cross-transport switch from HTTP to stdio on handoff failure", async () => {
    const httpServer: McpServerSettings = {
      id: "srv-http-to-stdio-fail",
      name: "HTTP to Stdio Fail",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };
    const handoffError = new Error(
      "Handoff failed: child process failed to start",
    );
    const { owner, app } = createMockOwner({
      handoffError,
      initialSettings: { mcpServers: [httpServer] },
    });
    setMcpHttpUrl(
      app,
      "srv-http-to-stdio-fail",
      "https://mcp.example.com/mcp?token=initial_http_secret",
    );
    const coordinator = new McpTransactionCoordinator(owner);

    const stdioTarget: McpServerSettings = {
      ...httpServer,
      transport: "stdio",
      command: "python",
      args: ["run.py"],
      url: "",
      envNames: ["FRESH_ENV_KEY"],
    };

    // Execute saveServer switching http -> stdio
    await expect(
      coordinator.saveServer(stdioTarget, {
        envValues: { FRESH_ENV_KEY: "fresh_secret_value" },
        removedEnvNames: [],
        httpUrl: undefined,
      }),
    ).rejects.toThrow("Handoff failed");

    // 1. SecretStorage restored: HTTP URL restored, fresh env secret absent
    expect(getMcpHttpUrl(app, "srv-http-to-stdio-fail")).toBe(
      "https://mcp.example.com/mcp?token=initial_http_secret",
    );
    expect(
      getMcpSecret(app, "srv-http-to-stdio-fail", "FRESH_ENV_KEY"),
    ).toBeNull();

    // 2. Settings & draft rolled back to http
    expect(owner.settings.mcpServers[0].transport).toBe("http");
    expect(owner.draftSettings.mcpServers[0].transport).toBe("http");

    // 3. Persisted configs rolled back
    expect(owner.dataJson.mcpServers[0].transport).toBe("http");
    expect(owner.serviceConfigJson.mcpServers[0].transport).toBe("http");

    // 4. Sidecar rolled back
    expect(owner.sidecarGeneration).toBe(3);
    expect(owner.sidecarConfig.mcpServers[0].transport).toBe("http");
  });

  it("rolls back deletion when structural apply succeeds but strict handoff fails", async () => {
    const server: McpServerSettings = {
      id: "srv-del-handoff-fail",
      name: "Delete Handoff Fail",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };
    const handoffError = new Error("Strict handoff failed after delete");
    const { owner, app } = createMockOwner({
      handoffError,
      initialSettings: { mcpServers: [server] },
    });
    setMcpHttpUrl(
      app,
      "srv-del-handoff-fail",
      "https://mcp.example.com/mcp?token=xyz123",
    );
    const coordinator = new McpTransactionCoordinator(owner);

    await expect(
      coordinator.deleteServer("srv-del-handoff-fail"),
    ).rejects.toThrow("Strict handoff failed after delete");

    // 1. Server restored in draft, settings, dataJson, and serviceConfigJson
    expect(owner.draftSettings.mcpServers).toHaveLength(1);
    expect(owner.draftSettings.mcpServers[0].id).toBe("srv-del-handoff-fail");
    expect(owner.settings.mcpServers).toHaveLength(1);
    expect(owner.dataJson.mcpServers).toHaveLength(1);
    expect(owner.serviceConfigJson.mcpServers).toHaveLength(1);

    // 2. Secret restored in storage
    expect(getMcpHttpUrl(app, "srv-del-handoff-fail")).toBe(
      "https://mcp.example.com/mcp?token=xyz123",
    );

    // 3. Sidecar rolled back to previous server generation
    expect(owner.sidecarGeneration).toBe(3);
  });

  it("re-hands off restored secrets to previous runtime when applyDraftSettings itself fails", async () => {
    const existing: McpServerSettings = {
      id: "srv-apply-fail-rehand",
      name: "Existing Stdio",
      transport: "stdio",
      command: "python",
      args: [],
      cwd: "vault",
      url: "",
      envNames: ["INITIAL_KEY"],
      toolPolicies: {},
      enabled: true,
    };
    const applyError = new Error("applyDraftSettings internal error");
    const { owner, app } = createMockOwner({
      applyError,
      initialSettings: { mcpServers: [existing] },
    });
    setMcpSecret(
      app,
      "srv-apply-fail-rehand",
      "INITIAL_KEY",
      "initial_key_value",
    );
    const coordinator = new McpTransactionCoordinator(owner);

    const changedServer: McpServerSettings = {
      ...existing,
      command: "node",
    };

    await expect(
      coordinator.saveServer(changedServer, {
        envValues: { INITIAL_KEY: "attempted_new_val" },
        removedEnvNames: [],
      }),
    ).rejects.toThrow("applyDraftSettings internal error");

    // Restored secret was re-handed off to the running previous runtime
    expect(
      getMcpSecret(app, "srv-apply-fail-rehand", "INITIAL_KEY"),
    ).toBe("initial_key_value");
    expect(owner.backend.sendMcpSecrets).toHaveBeenCalled();
    expect(
      owner.sidecarSecrets.servers["srv-apply-fail-rehand"]["INITIAL_KEY"],
    ).toBe("initial_key_value");
  });

  it("combines original error and rollback error into safe coded diagnostic without secret leakage", async () => {
    const rawCanaryToken = "CANARY_SECRET_TOKEN_999";
    const store = new Map<string, string>();
    let inRollback = false;
    const storage = {
      getSecret: (id: string) => {
        if (inRollback) {
          throw new Error(`Corrupted read for https://mcp.example.com?token=${rawCanaryToken}`);
        }
        return store.get(id) ?? null;
      },
      setSecret: (id: string, value: string) => {
        store.set(id, value);
      },
      deleteSecret: (id: string) => {
        store.delete(id);
      },
    };
    const app = { secretStorage: storage } as unknown as App;
    const applyError = new Error(
      `Structural apply failed for https://mcp.example.com/stream?token=${rawCanaryToken}`,
    );
    const { owner } = createMockOwner({
      app,
      applyError,
      failApplyTimes: 1,
      onApply: () => {
        inRollback = true;
      },
    });
    const coordinator = new McpTransactionCoordinator(owner);

    const server: McpServerSettings = {
      id: "srv-comb-err",
      name: "Diag Test",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };

    let thrownError: Error | null = null;
    try {
      await coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: `https://mcp.example.com/stream?token=${rawCanaryToken}`,
      });
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("MCP_TRANSACTION_FAILED");
    expect(thrownError!.message).toContain("MCP_ROLLBACK_FAILED");
    // Full URL query and secret tokens are sanitized out
    expect(thrownError!.message).not.toContain(rawCanaryToken);
    expect(thrownError!.message).not.toContain("?token=");
    expect(thrownError!.message).toContain("https://mcp.example.com");
  });

  it("ensures stable Proxy continues to schedule debounced apply for regular settings edits after rollback", async () => {
    const applyError = new Error("Failed apply");
    const { owner } = createMockOwner({ applyError });
    const coordinator = new McpTransactionCoordinator(owner);

    const server: McpServerSettings = {
      id: "srv-proxy-test",
      name: "Proxy Test",
      transport: "http",
      command: "",
      args: [],
      cwd: "vault",
      url: "https://mcp.example.com",
      envNames: [],
      toolPolicies: {},
      enabled: true,
    };

    // Failed transaction
    await expect(
      coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com?token=xyz",
      }),
    ).rejects.toThrow();

    // Now user changes a regular setting on owner.draftSettings
    expect(owner.draftDirty).toBe(false);
    expect(owner.draftApplyTimer).toBeNull();

    // Mutate proxy
    owner.draftSettings.answerModel = "deepseek-reasoner";
    expect(owner.draftDirty).toBe(true);
    expect(owner.draftApplyTimer).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // 1. Rollback phase isolation tests
  // --------------------------------------------------------------------------
  describe("Rollback phase isolation", () => {
    it("rolls back remaining secrets, draft, and sidecar even if one SecretStorage restore fails", async () => {
      const existing: McpServerSettings = {
        id: "srv-iso-1",
        name: "Isolation Test Server",
        transport: "stdio",
        command: "python",
        args: ["server.py"],
        cwd: "vault",
        url: "",
        envNames: ["ENV_KEY_OK", "ENV_KEY_THROW"],
        toolPolicies: {},
        enabled: true,
      };
      const store = new Map<string, string>();
      let throwOnEnvKey = false;
      const throwKeyId = mcpSecretId("srv-iso-1", "ENV_KEY_THROW");
      const app = {
        secretStorage: {
          getSecret: (k: string) => store.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            if (throwOnEnvKey && k === throwKeyId) {
              throw new Error(
                "SecretStorage hardware lock failure on ENV_KEY_THROW",
              );
            }
            store.set(k, v);
          },
          deleteSecret: (k: string) => {
            store.delete(k);
          },
          listSecrets: () => Array.from(store.keys()),
        },
      } as unknown as App;

      setMcpSecret(app, "srv-iso-1", "ENV_KEY_OK", "safe_canary_ok");
      setMcpSecret(app, "srv-iso-1", "ENV_KEY_THROW", "safe_canary_throw");

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [existing] },
        failHandoffTimes: 1,
        handoffError: new Error("Handoff trigger rollback"),
        onHandoff: () => {
          throwOnEnvKey = true;
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      const target: McpServerSettings = {
        ...existing,
        command: "node",
      };
      let error: Error | null = null;
      try {
        await coordinator.saveServer(target, {
          envValues: {
            ENV_KEY_OK: "new_ok_val",
            ENV_KEY_THROW: "new_throw_val",
          },
          removedEnvNames: [],
        });
      } catch (err) {
        error = err as Error;
      }

      expect(error).not.toBeNull();
      expect(error!.message).toContain("MCP_TRANSACTION_FAILED");
      expect(error!.message).toContain("MCP_ROLLBACK_FAILED");
      expect(error!.message).toContain(
        "MCP_SERVER_RECOVERY_DISABLED: srv-iso-1",
      );

      // 1. ENV_KEY_OK was restored despite ENV_KEY_THROW failing
      expect(getMcpSecret(app, "srv-iso-1", "ENV_KEY_OK")).toBe(
        "safe_canary_ok",
      );

      // 2. Draft and settings are still restored (with failed server marked disabled)
      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
      expect(owner.settings.mcpServers[0].enabled).toBe(false);

      // 3. Structural configs are restored
      expect(owner.dataJson.mcpServers[0].enabled).toBe(false);
      expect(owner.serviceConfigJson.mcpServers[0].enabled).toBe(false);

      // 4. Sidecar was restored
      expect(owner.sidecarGeneration).toBe(3);
    });

    it("rolls back delete transaction phases independently even if SecretStorage restore fails on one key", async () => {
      const existing: McpServerSettings = {
        id: "srv-del-iso",
        name: "Delete Isolation Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["KEY_DEL_OK", "KEY_DEL_FAIL"],
        toolPolicies: {},
        enabled: true,
      };
      const store = new Map<string, string>();
      let inRollback = false;
      const throwKeyId = mcpSecretId("srv-del-iso", "KEY_DEL_FAIL");
      const app = {
        secretStorage: {
          getSecret: (k: string) => store.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            if (inRollback && k === throwKeyId) {
              throw new Error("Corrupted storage during delete rollback");
            }
            store.set(k, v);
          },
          deleteSecret: (k: string) => {
            store.delete(k);
          },
          listSecrets: () => Array.from(store.keys()),
        },
      } as unknown as App;

      setMcpSecret(app, "srv-del-iso", "KEY_DEL_OK", "canary_ok");
      setMcpSecret(app, "srv-del-iso", "KEY_DEL_FAIL", "canary_fail");

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [existing] },
        failHandoffTimes: 1,
        handoffError: new Error("Delete handoff trigger rollback"),
        onHandoff: () => {
          inRollback = true;
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let error: Error | null = null;
      try {
        await coordinator.deleteServer("srv-del-iso");
      } catch (err) {
        error = err as Error;
      }

      expect(error).not.toBeNull();
      expect(error!.message).toContain("MCP_TRANSACTION_FAILED");
      expect(error!.message).toContain("MCP_ROLLBACK_FAILED");
      expect(error!.message).toContain(
        "MCP_SERVER_RECOVERY_DISABLED: srv-del-iso",
      );

      // KEY_DEL_OK was restored
      expect(getMcpSecret(app, "srv-del-iso", "KEY_DEL_OK")).toBe("canary_ok");

      // Server restored in draft and disabled
      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mutual exclusion and serialization boundary tests
  // --------------------------------------------------------------------------
  describe("Mutual exclusion and serialization boundary", () => {
    it("MCP save waits for pending in-flight general apply and subsequently applies mid-flight edits", async () => {
      let resolveFirstApply!: () => void;
      const firstApplyBarrier = new Promise<void>((res) => {
        resolveFirstApply = res;
      });

      let applyCount = 0;
      const { owner, events } = createMockOwner({
        debounceMs: 50,
        onApply: async () => {
          applyCount++;
          if (applyCount === 1) {
            await firstApplyBarrier;
          }
        },
      });

      const coordinator = new McpTransactionCoordinator(owner);

      // 1. Start a general apply
      owner.draftSettings.answerModel = "model-v1";
      const firstApplyPromise = owner.applyDraftSettings();

      // Microtick to enter apply
      await new Promise((r) => setTimeout(r, 10));

      // 2. While general apply is paused in barrier, user edits another setting and starts MCP save
      owner.draftSettings.answerModel = "model-v2";

      const newServer: McpServerSettings = {
        id: "srv-concurrent-1",
        name: "Concurrent Srv",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };
      const savePromise = coordinator.saveServer(newServer, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com/stream?token=abc",
      });

      // 3. Resolve the first apply barrier
      resolveFirstApply();
      await firstApplyPromise;
      await savePromise;

      // Wait for trailing debounced apply
      await new Promise((r) => setTimeout(r, 100));

      // 4. Verify results:
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-concurrent-1");
      expect(owner.settings.answerModel).toBe("model-v2");
      expect(owner.getMaxConcurrency()).toBe(1);
      expect(events).toContain("apply-start:1");
      expect(events).toContain("apply-end:1");
    });

    it("debounce timer expiring while MCP transaction is active queues behind transaction and executes sequentially", async () => {
      let resolveSaveHandoff!: () => void;
      const saveHandoffBarrier = new Promise<void>((res) => {
        resolveSaveHandoff = res;
      });

      let handoffCount = 0;
      const { owner } = createMockOwner({
        debounceMs: 20,
        onHandoff: async () => {
          handoffCount++;
          if (handoffCount === 1) {
            await saveHandoffBarrier;
          }
        },
      });

      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-deb-queue",
        name: "Debounce Queue Server",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const savePromise = coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com?token=tok",
      });

      await new Promise((r) => setTimeout(r, 10));

      // While save transaction is holding lock inside handoff barrier, mutate general draft setting
      owner.draftSettings.answerTimeoutSeconds = 42;

      // Wait 35ms so debounce timer expires while transaction is holding lock
      await new Promise((r) => setTimeout(r, 35));

      expect(owner.getMaxConcurrency()).toBe(1);

      // Resolve save barrier
      resolveSaveHandoff();
      await savePromise;

      // Wait for queued debounced apply to finish
      await new Promise((r) => setTimeout(r, 50));

      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.answerTimeoutSeconds).toBe(42);
      expect(owner.getMaxConcurrency()).toBe(1);
    });

    it("serializes concurrent MCP save and delete transactions in FIFO order without deadlock", async () => {
      const serverA: McpServerSettings = {
        id: "srv-seq-a",
        name: "Server A",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };
      const serverB: McpServerSettings = {
        id: "srv-seq-b",
        name: "Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [serverA] },
      });
      setMcpHttpUrl(app, "srv-seq-a", "https://mcp.example.com?token=a");
      const coordinator = new McpTransactionCoordinator(owner);

      const p1 = coordinator.saveServer(serverB, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com?token=b",
      });
      const p2 = coordinator.deleteServer("srv-seq-a");

      await Promise.all([p1, p2]);

      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-seq-b");
      expect(getMcpHttpUrl(app, "srv-seq-a")).toBeNull();
      expect(getMcpHttpUrl(app, "srv-seq-b")).toBe(
        "https://mcp.example.com?token=b",
      );
      expect(owner.getMaxConcurrency()).toBe(1);
    });

    it("preserves non-MCP general edits made during rollback and applies them afterward", async () => {
      const { owner } = createMockOwner({
        debounceMs: 30,
        failHandoffTimes: 1,
        handoffError: new Error("Rollback trigger"),
        onHandoff: async () => {
          owner.draftSettings.answerProvider = "ollama";
        },
      });

      const coordinator = new McpTransactionCoordinator(owner);
      const server: McpServerSettings = {
        id: "srv-fail-preserve",
        name: "Fail Preserve",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      await expect(
        coordinator.saveServer(server, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: "https://mcp.example.com?token=fail",
        }),
      ).rejects.toThrow("Rollback trigger");

      // Wait for post-rollback debounced apply
      await new Promise((r) => setTimeout(r, 60));

      expect(owner.settings.mcpServers).toHaveLength(0);
      expect(owner.draftSettings.mcpServers).toHaveLength(0);
      expect(owner.settings.answerProvider).toBe("ollama");
      expect(owner.draftSettings.answerProvider).toBe("ollama");
      expect(owner.getMaxConcurrency()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Compensating handoff tests
  // --------------------------------------------------------------------------
  describe("Compensating handoff", () => {
    it("stdio -> HTTP rollback: 1st handoff fails, rollback handoff succeeds -> restores stdio generation, env secret in sidecar, no HTTP URL, no MCP_ROLLBACK_FAILED", async () => {
      const stdioServer: McpServerSettings = {
        id: "srv-stdio-http-comp",
        name: "Compensating Stdio",
        transport: "stdio",
        command: "python",
        args: ["server.py"],
        cwd: "vault",
        url: "",
        envNames: ["STDIO_CANARY_KEY"],
        toolPolicies: {},
        enabled: true,
      };
      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [stdioServer] },
        failHandoffTimes: 1,
        handoffError: new Error("Initial HTTP connection refused"),
      });
      setMcpSecret(
        app,
        "srv-stdio-http-comp",
        "STDIO_CANARY_KEY",
        "stdio_canary_val",
      );
      const coordinator = new McpTransactionCoordinator(owner);

      const httpTarget: McpServerSettings = {
        ...stdioServer,
        transport: "http",
        command: "",
        args: [],
        url: "https://mcp.example.com",
        envNames: [],
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(httpTarget, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: "https://mcp.example.com/stream?token=new_tok",
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("Initial HTTP connection refused");
      expect(caught!.message).not.toContain("MCP_ROLLBACK_FAILED");

      // 1. Old stdio config/session generation restored
      expect(owner.settings.mcpServers[0].transport).toBe("stdio");
      expect(owner.draftSettings.mcpServers[0].transport).toBe("stdio");
      expect(owner.sidecarConfig.mcpServers[0].transport).toBe("stdio");
      expect(owner.sidecarGeneration).toBe(3);

      // 2. Old env secret is in sidecar snapshot
      expect(
        getMcpSecret(app, "srv-stdio-http-comp", "STDIO_CANARY_KEY"),
      ).toBe("stdio_canary_val");
      expect(
        owner.sidecarSecrets.servers["srv-stdio-http-comp"][
          "STDIO_CANARY_KEY"
        ],
      ).toBe("stdio_canary_val");

      // 3. HTTP URL is absent from both sidecar snapshot and SecretStorage
      expect(getMcpHttpUrl(app, "srv-stdio-http-comp")).toBeNull();
      expect(
        owner.sidecarSecrets.http_urls["srv-stdio-http-comp"],
      ).toBeUndefined();
    });

    it("HTTP -> stdio rollback: 1st handoff fails, rollback handoff succeeds -> restores HTTP generation, full HTTP URL in sidecar, no stdio env, no MCP_ROLLBACK_FAILED", async () => {
      const httpServer: McpServerSettings = {
        id: "srv-http-stdio-comp",
        name: "Compensating HTTP",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };
      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [httpServer] },
        failHandoffTimes: 1,
        handoffError: new Error("Stdio process spawn failed"),
      });
      setMcpHttpUrl(
        app,
        "srv-http-stdio-comp",
        "https://mcp.example.com/stream?token=prev_http_tok",
      );
      const coordinator = new McpTransactionCoordinator(owner);

      const stdioTarget: McpServerSettings = {
        ...httpServer,
        transport: "stdio",
        command: "python",
        args: ["main.py"],
        url: "",
        envNames: ["NEW_ENV_KEY"],
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(stdioTarget, {
          envValues: { NEW_ENV_KEY: "attempted_env_val" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("Stdio process spawn failed");
      expect(caught!.message).not.toContain("MCP_ROLLBACK_FAILED");

      // 1. Old HTTP config/session generation restored
      expect(owner.settings.mcpServers[0].transport).toBe("http");
      expect(owner.draftSettings.mcpServers[0].transport).toBe("http");
      expect(owner.sidecarGeneration).toBe(3);

      // 2. Old full HTTP URL restored in sidecar memory
      expect(getMcpHttpUrl(app, "srv-http-stdio-comp")).toBe(
        "https://mcp.example.com/stream?token=prev_http_tok",
      );
      expect(
        owner.sidecarSecrets.http_urls["srv-http-stdio-comp"],
      ).toBe("https://mcp.example.com/stream?token=prev_http_tok");

      // 3. New stdio env absent
      expect(
        getMcpSecret(app, "srv-http-stdio-comp", "NEW_ENV_KEY"),
      ).toBeNull();
      expect(
        owner.sidecarSecrets.servers["srv-http-stdio-comp"],
      ).toBeUndefined();
    });

    it("delete rollback: 1st handoff fails, rollback handoff succeeds -> restores server session and old secret snapshot, no MCP_ROLLBACK_FAILED", async () => {
      const server: McpServerSettings = {
        id: "srv-del-comp",
        name: "Delete Compensating",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };
      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [server] },
        failHandoffTimes: 1,
        handoffError: new Error("Delete handoff failed"),
      });
      setMcpHttpUrl(
        app,
        "srv-del-comp",
        "https://mcp.example.com/stream?token=del_canary_tok",
      );
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.deleteServer("srv-del-comp");
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("Delete handoff failed");
      expect(caught!.message).not.toContain("MCP_ROLLBACK_FAILED");

      // Server session and old secrets restored
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      expect(owner.sidecarGeneration).toBe(3);
      expect(getMcpHttpUrl(app, "srv-del-comp")).toBe(
        "https://mcp.example.com/stream?token=del_canary_tok",
      );
      expect(owner.sidecarSecrets.http_urls["srv-del-comp"]).toBe(
        "https://mcp.example.com/stream?token=del_canary_tok",
      );
    });

    it("displays MCP_ROLLBACK_FAILED only when rollback handoff also fails", async () => {
      const server: McpServerSettings = {
        id: "srv-perm-fail",
        name: "Permanent Fail Server",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };
      const { owner } = createMockOwner({
        initialSettings: { mcpServers: [server] },
        failHandoffTimes: 2,
        handoffError: new Error("Permanent sidecar disconnect"),
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(
          { ...server, name: "Renamed" },
          {
            envValues: {},
            removedEnvNames: [],
            httpUrl: "https://mcp.example.com?token=tok1",
          },
        );
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain(
        "MCP_TRANSACTION_FAILED: Permanent sidecar disconnect",
      );
      expect(caught!.message).toContain(
        "MCP_ROLLBACK_FAILED: Permanent sidecar disconnect",
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Secret-safe error sanitization tests
  // --------------------------------------------------------------------------
  describe("Secret-safe error sanitization", () => {
    it("redacts non-URL env canary values from SecretStorage errors in transaction error and modal Notice", async () => {
      const rawCanarySecret = "CANARY_SECRET_ENV_VALUE_XYZ_999";
      const app = {
        secretStorage: {
          getSecret: () => null,
          setSecret: () => {
            throw new Error(
              `Failed to commit secret key API_KEY: ${rawCanarySecret}`,
            );
          },
          deleteSecret: () => {},
          listSecrets: () => [],
        },
      } as unknown as App;

      const { owner } = createMockOwner({ app });
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-canary-env",
        name: "Canary Stdio Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(server, {
          envValues: { API_KEY: rawCanarySecret },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).not.toContain(rawCanarySecret);
      expect(caught!.message).toContain("MCP_SECRET_COMMIT_FAILED");
      expect(caught!.message).toContain("API_KEY");
    });

    it("redacts full HTTP URLs with query params, credentials, and paths down to safe origins", () => {
      const canaryUrl =
        "https://admin:supersecret@api.subdomain.example.com:9443/v1/mcp/stream?token=CANARY_QUERY_TOKEN#hash";
      const canaryEnv = "CANARY_RAW_SECRET_12345";

      const rawMessage = `Connection error to ${canaryUrl} with secret ${canaryEnv}`;
      const sanitized = sanitizeSecretMessage(rawMessage, [
        canaryUrl,
        canaryEnv,
      ]);

      expect(sanitized).not.toContain("CANARY_QUERY_TOKEN");
      expect(sanitized).not.toContain("supersecret");
      expect(sanitized).not.toContain("admin:");
      expect(sanitized).not.toContain("/v1/mcp/stream");
      expect(sanitized).not.toContain("CANARY_RAW_SECRET_12345");
      expect(sanitized).toContain("https://api.subdomain.example.com:9443");
      expect(sanitized).toContain("[redacted-secret]");
    });

    it("does not blanket-redact short common strings (< 4 chars)", () => {
      const shortSecret = "abc";
      const message = "The quick brown fox jumps over the lazy dog";
      const sanitized = sanitizeSecretMessage(message, [shortSecret]);
      expect(sanitized).toBe(message);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Pre-structural failure disabled recovery persistence tests (Requirement 1)
  // --------------------------------------------------------------------------
  describe("Pre-structural failure and disabled recovery persistence", () => {
    it("existing HTTP server: first secret write fails before structural apply and restore fails -> all configs & sidecar have server disabled", async () => {
      const existing: McpServerSettings = {
        id: "srv-http-persist-fail",
        name: "Persist Fail HTTP",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      secretStore.set(
        "vault-search-mcp-http-url-srv-http-persist-fail",
        "https://mcp.example.com/stream?token=old_url_tok",
      );

      let writeAttempt = 0;
      const app = {
        secretStorage: {
          getSecret: (k: string) => secretStore.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            writeAttempt++;
            if (writeAttempt === 1) {
              throw new Error("Disk full on secret write");
            }
            if (writeAttempt === 2) {
              throw new Error("Secret restore also failed");
            }
            secretStore.set(k, v);
          },
          deleteSecret: (k: string) => {
            secretStore.delete(k);
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [existing] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(existing, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: "https://mcp.example.com/stream?token=new_attempted_tok",
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SERVER_RECOVERY_DISABLED: srv-http-persist-fail");
      expect(caught!.message).toContain("MCP_ROLLBACK_FAILED");

      // Verify that disabled recovery is persisted to draft, settings, data.json, service-config.json, and sidecar
      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
      expect(owner.dataJson.mcpServers[0].enabled).toBe(false);
      expect(owner.serviceConfigJson.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarConfig.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarGeneration).toBe(2);
    });

    it("existing stdio server: first secret write fails before structural apply and restore fails -> all configs & sidecar have server disabled", async () => {
      const existing: McpServerSettings = {
        id: "srv-stdio-persist-fail",
        name: "Persist Fail Stdio",
        transport: "stdio",
        command: "python",
        args: ["server.py"],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      const { mcpSecretId } = await import("../../src/mcp-secrets");
      secretStore.set(
        mcpSecretId("srv-stdio-persist-fail", "API_KEY"),
        "old_stdio_secret_val",
      );

      let writeAttempt = 0;
      const app = {
        secretStorage: {
          getSecret: (k: string) => secretStore.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            writeAttempt++;
            if (writeAttempt === 1) {
              throw new Error("Secret write failure");
            }
            if (writeAttempt === 2) {
              throw new Error("Secret restore failure");
            }
            secretStore.set(k, v);
          },
          deleteSecret: (k: string) => {
            secretStore.delete(k);
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [existing] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(existing, {
          envValues: { API_KEY: "new_secret_val" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SERVER_RECOVERY_DISABLED: srv-stdio-persist-fail");
      expect(caught!.message).toContain("MCP_ROLLBACK_FAILED");

      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
      expect(owner.dataJson.mcpServers[0].enabled).toBe(false);
      expect(owner.serviceConfigJson.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarConfig.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarGeneration).toBe(2);
    });

    it("deleteServer: secret deletion fails partway and rollback restore fails -> server remains disabled in configs and live runtime", async () => {
      const server: McpServerSettings = {
        id: "srv-del-restore-fail",
        name: "Delete Restore Fail",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      secretStore.set(
        "vault-search-mcp-http-url-srv-del-restore-fail",
        "https://mcp.example.com/stream?token=del_fail_tok",
      );

      let deleteCalls = 0;
      const app = {
        secretStorage: {
          getSecret: (k: string) => secretStore.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            throw new Error("Restore setSecret failed");
          },
          deleteSecret: (k: string) => {
            deleteCalls++;
            throw new Error("Delete operation rejected by keychain");
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [server] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.deleteServer("srv-del-restore-fail");
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SERVER_RECOVERY_DISABLED: srv-del-restore-fail");
      expect(caught!.message).toContain("MCP_ROLLBACK_FAILED");

      // Server is kept but disabled across persisted configs and sidecar
      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
      expect(owner.dataJson.mcpServers[0].enabled).toBe(false);
      expect(owner.serviceConfigJson.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarConfig.mcpServers[0].enabled).toBe(false);
      expect(owner.sidecarGeneration).toBe(2);
    });

    it("new server: secret write/read-back fails and cleanup fails -> safe-origin-only disabled recovery entry created", async () => {
      const newServer: McpServerSettings = {
        id: "srv-new-cleanup-fail",
        name: "New Cleanup Fail Server",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://admin:supersecret@api.service.io:8443/v2/stream?key=LEAKED_CANARY_TOKEN#frag",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      let writeCount = 0;
      const app = {
        secretStorage: {
          getSecret: (k: string) => secretStore.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            writeCount++;
            secretStore.set(k, v);
            if (writeCount === 1) {
              // Fail after writing (e.g. read-back or next step throws)
              throw new Error("Write failed with error");
            }
          },
          deleteSecret: (k: string) => {
            throw new Error("Cleanup deleteSecret failed");
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(newServer, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: "https://admin:supersecret@api.service.io:8443/v2/stream?key=LEAKED_CANARY_TOKEN#frag",
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SERVER_RECOVERY_DISABLED: srv-new-cleanup-fail");
      expect(caught!.message).toContain("MCP_ROLLBACK_FAILED");

      // Recovery entry preserved in draft, settings, data.json, serviceConfigJson
      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      const recoveryEntry = owner.draftSettings.mcpServers[0];
      expect(recoveryEntry.id).toBe("srv-new-cleanup-fail");
      expect(recoveryEntry.enabled).toBe(false);
      // Safe origin only!
      expect(recoveryEntry.url).toBe("https://api.service.io:8443");
      expect(recoveryEntry.url).not.toContain("admin");
      expect(recoveryEntry.url).not.toContain("supersecret");
      expect(recoveryEntry.url).not.toContain("LEAKED_CANARY_TOKEN");
      expect(recoveryEntry.url).not.toContain("/v2/stream");

      expect(owner.settings.mcpServers[0].url).toBe("https://api.service.io:8443");
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
      expect(owner.dataJson.mcpServers[0].url).toBe("https://api.service.io:8443");
      expect(owner.serviceConfigJson.mcpServers[0].url).toBe("https://api.service.io:8443");
      expect(owner.sidecarConfig.mcpServers[0].url).toBe("https://api.service.io:8443");
      expect(owner.sidecarConfig.mcpServers[0].enabled).toBe(false);
    });

    it("restores other independent servers normally when one server restore fails", async () => {
      const serverA: McpServerSettings = {
        id: "srv-independent-A",
        name: "Server A",
        transport: "stdio",
        command: "node",
        args: ["a.js"],
        cwd: "vault",
        url: "",
        envNames: ["A_KEY"],
        toolPolicies: {},
        enabled: true,
      };
      const serverB: McpServerSettings = {
        id: "srv-independent-B",
        name: "Server B",
        transport: "stdio",
        command: "node",
        args: ["b.js"],
        cwd: "vault",
        url: "",
        envNames: ["B_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      const { mcpSecretId } = await import("../../src/mcp-secrets");
      secretStore.set(mcpSecretId("srv-independent-A", "A_KEY"), "secret_A_orig");
      secretStore.set(mcpSecretId("srv-independent-B", "B_KEY"), "secret_B_orig");

      let writeAttempt = 0;
      const app = {
        secretStorage: {
          getSecret: (k: string) => secretStore.get(k) ?? null,
          setSecret: (k: string, v: string) => {
            writeAttempt++;
            if (writeAttempt === 1) throw new Error("A write failed");
            if (k.includes("srv-independent-A")) throw new Error("A restore failed");
            secretStore.set(k, v);
          },
          deleteSecret: (k: string) => {
            secretStore.delete(k);
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [serverA, serverB] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(serverA, {
          envValues: { A_KEY: "secret_A_new" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      // Server A is disabled due to restore failure
      expect(owner.settings.mcpServers.find((s) => s.id === "srv-independent-A")?.enabled).toBe(false);
      // Server B is untouched and still enabled
      expect(owner.settings.mcpServers.find((s) => s.id === "srv-independent-B")?.enabled).toBe(true);
      expect(secretStore.get(mcpSecretId("srv-independent-B", "B_KEY"))).toBe("secret_B_orig");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Secret snapshot safe error boundary tests (Requirement 2)
  // --------------------------------------------------------------------------
  describe("Secret snapshot safe error boundary", () => {
    it("getMcpHttpUrl throwing an Error with full URL during snapshot read aborts immediately without leaking canary in message", async () => {
      const canaryFullUrl =
        "https://admin:canarypass999@api.secret-gateway.internal:8080/mcp/stream?token=SECRET_CANARY_JWT_TOKEN";
      const app = {
        secretStorage: {
          getSecret: (k: string) => {
            if (k.includes("mcp-http-url")) {
              throw new Error(`Keychain failure on url secret read: ${canaryFullUrl}`);
            }
            return null;
          },
          setSecret: () => {},
          deleteSecret: () => {},
          listSecrets: () => [],
        },
      } as unknown as App;

      const { owner } = createMockOwner({ app });
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-snap-fail-http",
        name: "Snap Fail HTTP",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://api.secret-gateway.internal:8080",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(server, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: canaryFullUrl,
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_SNAPSHOT_FAILED");
      expect(caught!.message).not.toContain("canarypass999");
      expect(caught!.message).not.toContain("SECRET_CANARY_JWT_TOKEN");
      expect(caught!.message).not.toContain("/mcp/stream");

      // No changes to settings or draft
      expect(owner.settings.mcpServers).toHaveLength(0);
      expect(owner.draftSettings.mcpServers).toHaveLength(0);
    });

    it("getMcpSecret throwing an Error with env canary during snapshot read aborts safely", async () => {
      const canarySecret = "SUPER_SECRET_CANARY_TOKEN_4567";
      const app = {
        secretStorage: {
          getSecret: (k: string) => {
            if (k.includes("mcp-env")) {
              throw new Error(`Corrupted secret key storage: ${canarySecret}`);
            }
            return null;
          },
          setSecret: () => {},
          deleteSecret: () => {},
          listSecrets: () => [],
        },
      } as unknown as App;

      const existing: McpServerSettings = {
        id: "srv-snap-fail-env",
        name: "Snap Fail Env",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["CANARY_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [existing] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(existing, {
          envValues: { CANARY_KEY: "attempted_val" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_SNAPSHOT_FAILED");
      expect(caught!.message).not.toContain(canarySecret);

      // Structural settings unchanged
      expect(owner.settings.mcpServers[0].enabled).toBe(true);
    });

    it("short secrets (<4 chars) in SecretStorage error messages are not leaked in snapshot read failure", async () => {
      const shortCanary = "xyz";
      const app = {
        secretStorage: {
          getSecret: () => {
            throw new Error(`Storage error with token: ${shortCanary}`);
          },
          setSecret: () => {},
          deleteSecret: () => {},
          listSecrets: () => [],
        },
      } as unknown as App;

      const { owner } = createMockOwner({ app });
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-short-secret",
        name: "Short Secret Server",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://api.test.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(server, {
          envValues: {},
          removedEnvNames: [],
          httpUrl: "https://api.test.com",
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_SNAPSHOT_FAILED");
      expect(caught!.message).not.toContain(shortCanary);
    });

    it("deleteServer snapshot read failure aborts immediately without altering settings", async () => {
      const app = {
        secretStorage: {
          getSecret: () => {
            throw new Error("Delete snapshot read failed with raw details");
          },
          setSecret: () => {},
          deleteSecret: () => {},
          listSecrets: () => [],
        },
      } as unknown as App;

      const server: McpServerSettings = {
        id: "srv-del-snap-fail",
        name: "Del Snap Fail",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [server] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.deleteServer("srv-del-snap-fail");
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_SNAPSHOT_FAILED: 서버(srv-del-snap-fail)");
      expect(owner.settings.mcpServers).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Settings mutation serialization boundary tests (Requirement 3)
  // --------------------------------------------------------------------------
  describe("Settings mutation serialization boundary and hot settings concurrency", () => {
    it("serializes setAnswerModel while MCP save handoff is pending and preserves both updates", async () => {
      let resolveHandoff!: () => void;
      const handoffGate = new Promise<void>((r) => {
        resolveHandoff = r;
      });

      const { owner } = createMockOwner({
        onHandoff: async () => {
          await handoffGate;
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-concurrent-save",
        name: "Concurrent Save Server",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.concurrent.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      // 1. Start MCP save (will pause during handoff)
      const savePromise = coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.concurrent.com/stream?tok=123",
      });

      // 2. Invoke setAnswerModel while save is in flight
      const modelPromise = owner.setAnswerModel("deepseek", "deepseek-chat");

      // Unblock handoff
      resolveHandoff();

      await Promise.all([savePromise, modelPromise]);

      // Both changes must be preserved in settings, draft, dataJson, serviceConfigJson
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-concurrent-save");
      expect(owner.settings.answerProvider).toBe("deepseek");
      expect(owner.settings.answerModel).toBe("deepseek-chat");

      expect(owner.draftSettings.mcpServers).toHaveLength(1);
      expect(owner.draftSettings.answerProvider).toBe("deepseek");
      expect(owner.draftSettings.answerModel).toBe("deepseek-chat");

      expect(owner.dataJson.mcpServers).toHaveLength(1);
      expect(owner.dataJson.answerProvider).toBe("deepseek");
      expect(owner.dataJson.answerModel).toBe("deepseek-chat");

      expect(owner.serviceConfigJson.mcpServers).toHaveLength(1);
      expect(owner.serviceConfigJson.answerProvider).toBe("deepseek");
      expect(owner.serviceConfigJson.answerModel).toBe("deepseek-chat");

      expect(owner.getMaxConcurrency()).toBe(1);
    });

    it("serializes setAnswerReasoningEffort during MCP rollback and does not revert the reasoning effort", async () => {
      let resolveRollback!: () => void;
      const rollbackGate = new Promise<void>((r) => {
        resolveRollback = r;
      });

      let handoffCalls = 0;
      const { owner } = createMockOwner({
        onHandoff: async () => {
          handoffCalls++;
          if (handoffCalls === 1) {
            throw new Error("Intentional handoff failure");
          }
          if (handoffCalls === 2) {
            await rollbackGate;
          }
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-rollback-concurrent",
        name: "Rollback Concurrent",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const savePromise = coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.example.com/stream?tok=abc",
      });

      const reasoningPromise = owner.setAnswerReasoningEffort("high");

      resolveRollback();

      await expect(savePromise).rejects.toThrow("Intentional handoff failure");
      await reasoningPromise;

      // Reasoning effort must remain 'high' and MCP servers must be rolled back to empty
      expect(owner.settings.answerReasoningEffort).toBe("high");
      expect(owner.draftSettings.answerReasoningEffort).toBe("high");
      expect(owner.dataJson.answerReasoningEffort).toBe("high");
      expect(owner.serviceConfigJson.answerReasoningEffort).toBe("high");

      expect(owner.settings.mcpServers).toHaveLength(0);
      expect(owner.draftSettings.mcpServers).toHaveLength(0);
      expect(owner.dataJson.mcpServers).toHaveLength(0);
      expect(owner.serviceConfigJson.mcpServers).toHaveLength(0);

      expect(owner.getMaxConcurrency()).toBe(1);
    });

    it("serializes concurrent MCP delete and toggleFavoriteModel without deadlock", async () => {
      const server: McpServerSettings = {
        id: "srv-del-fav-conc",
        name: "Delete Fav Concurrent",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner } = createMockOwner({
        initialSettings: {
          mcpServers: [server],
          favoriteAnswerModels: [{ provider: "openai", model: "gpt-4o" }],
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      const deletePromise = coordinator.deleteServer("srv-del-fav-conc");
      const togglePromise = owner.toggleFavoriteModel("deepseek", "deepseek-chat");

      await Promise.all([deletePromise, togglePromise]);

      // Both updates applied: server deleted and favorite added
      expect(owner.settings.mcpServers).toHaveLength(0);
      expect(owner.draftSettings.mcpServers).toHaveLength(0);
      expect(owner.dataJson.mcpServers).toHaveLength(0);

      expect(owner.settings.favoriteAnswerModels).toHaveLength(2);
      expect(owner.settings.favoriteAnswerModels[1]).toEqual({
        provider: "deepseek",
        model: "deepseek-chat",
      });
      expect(owner.draftSettings.favoriteAnswerModels).toHaveLength(2);
      expect(owner.dataJson.favoriteAnswerModels).toHaveLength(2);
      expect(owner.serviceConfigJson.favoriteAnswerModels).toHaveLength(2);

      expect(owner.getMaxConcurrency()).toBe(1);
    });

    it("serializes concurrent setProviderModels and MCP save", async () => {
      const { owner } = createMockOwner();
      const coordinator = new McpTransactionCoordinator(owner);

      const server: McpServerSettings = {
        id: "srv-models-conc",
        name: "Models Concurrent",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.models.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const savePromise = coordinator.saveServer(server, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: "https://mcp.models.com?token=123",
      });
      const providerModelsPromise = owner.setProviderModels("openai", [
        "gpt-4o",
        "gpt-4o-mini",
      ]);

      await Promise.all([savePromise, providerModelsPromise]);

      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.fetchedProviderModels?.openai).toEqual([
        "gpt-4o",
        "gpt-4o-mini",
      ]);
      expect(owner.dataJson.fetchedProviderModels?.openai).toEqual([
        "gpt-4o",
        "gpt-4o-mini",
      ]);
      expect(owner.getMaxConcurrency()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Short secret (<4 chars) non-disclosure regression tests (v0.1.64)
  // --------------------------------------------------------------------------
  describe("Short secret non-disclosure and generic coded diagnostic boundary", () => {
    it.each(["x", "xy", "xyz"])(
      "saveServer commit with short env canary '%s' throws MCP_SECRET_COMMIT_FAILED without canary disclosure",
      async (shortCanary) => {
        const app = {
          secretStorage: {
            getSecret: () => null,
            setSecret: () => {
              throw new Error(
                `SecretStorage driver error with short value: [${shortCanary}]`,
              );
            },
            deleteSecret: () => {},
            listSecrets: () => [],
          },
        } as unknown as App;

        const { owner } = createMockOwner({ app });
        const coordinator = new McpTransactionCoordinator(owner);

        const server: McpServerSettings = {
          id: "srv-short-commit",
          name: "Short Canary Server",
          transport: "stdio",
          command: "python",
          args: [],
          cwd: "vault",
          url: "",
          envNames: ["SHORT_KEY"],
          toolPolicies: {},
          enabled: true,
        };

        let caught: Error | null = null;
        try {
          await coordinator.saveServer(server, {
            envValues: { SHORT_KEY: shortCanary },
            removedEnvNames: [],
          });
        } catch (err) {
          caught = err as Error;
        }

        expect(caught).not.toBeNull();
        expect(caught!.message).toContain("MCP_SECRET_COMMIT_FAILED");
        expect(caught!.message).toContain("srv-short-commit");
        expect(caught!.message).toContain("SHORT_KEY");
        expect(caught!.message).not.toContain(shortCanary);
      },
    );

    it("deleteServer with 1~3 char snapshot value throws MCP_SECRET_DELETE_FAILED without short canary disclosure", async () => {
      const shortCanary = "xyz";
      const app = {
        secretStorage: {
          getSecret: () => shortCanary,
          setSecret: () => {},
          deleteSecret: () => {
            throw new Error(
              `SecretStorage failed deleting secret: [${shortCanary}]`,
            );
          },
          listSecrets: () => [],
        },
      } as unknown as App;

      const server: McpServerSettings = {
        id: "srv-short-del",
        name: "Short Del Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["SHORT_DEL_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [server] },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.deleteServer("srv-short-del");
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_DELETE_FAILED");
      expect(caught!.message).toContain("srv-short-del");
      expect(caught!.message).not.toContain(shortCanary);
    });

    it("rollback restore setSecret/getSecret throwing short canary produces MCP_SECRET_RESTORE_FAILED without leaking canary", async () => {
      const shortCanary = "xy";
      let isRollbackPhase = false;

      const store = new Map<string, string>();
      store.set(mcpSecretId("srv-restore-canary", "KEY"), shortCanary);

      const app = {
        secretStorage: {
          getSecret: (id: string) => {
            if (isRollbackPhase) {
              throw new Error(`getSecret failed during rollback: ${shortCanary}`);
            }
            return store.get(id) ?? null;
          },
          setSecret: (id: string, val: string) => {
            if (isRollbackPhase) {
              throw new Error(`setSecret failed during rollback: ${shortCanary}`);
            }
            store.set(id, val);
          },
          deleteSecret: (id: string) => {
            store.delete(id);
          },
          listSecrets: () => Array.from(store.keys()),
        },
      } as unknown as App;

      const server: McpServerSettings = {
        id: "srv-restore-canary",
        name: "Restore Canary Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["KEY"],
        toolPolicies: {},
        enabled: true,
      };

      let applyCalls = 0;
      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [server] },
        onApply: () => {
          applyCalls++;
          if (applyCalls === 1) {
            isRollbackPhase = true;
            throw new Error("Structural apply failed triggering rollback");
          }
        },
      });
      const coordinator = new McpTransactionCoordinator(owner);

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(server, {
          envValues: { KEY: "new_value" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_RESTORE_FAILED");
      expect(caught!.message).toContain("MCP_SERVER_RECOVERY_DISABLED");
      expect(caught!.message).not.toContain(shortCanary);
      // Disabled recovery executed to completion
      expect(owner.settings.mcpServers[0].enabled).toBe(false);
      expect(owner.draftSettings.mcpServers[0].enabled).toBe(false);
    });

    it("ensures normal short strings in non-secret error messages are not corrupted", () => {
      const plainError = "Connection to server failed at port 80 with exit code 1";
      const sanitized = sanitizeSecretMessage(plainError, ["x", "y", "80", "1"]);
      // 1~3 char candidates are not blindly substring-replaced in sanitizeSecretMessage
      expect(sanitized).toBe(plainError);
    });

    it("UI display() errors after successful commit do not trigger transaction rollback", async () => {
      const { owner } = createMockOwner();
      owner.settingTab = {
        display: () => {
          throw new Error("UI render crash in React/DOM");
        },
      };
      const coordinator = new McpTransactionCoordinator(owner);
      const server: McpServerSettings = {
        id: "srv-ui-safe",
        name: "UI Safe Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["KEY"],
        toolPolicies: {},
        enabled: true,
      };

      // saveServer should resolve without throwing because UI errors are caught safely
      await coordinator.saveServer(server, {
        envValues: { KEY: "val" },
        removedEnvNames: [],
      });

      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-ui-safe");
      expect(owner.draftSettings.mcpServers[0].id).toBe("srv-ui-safe");
    });

    it("deleteServer UI display() errors after successful commit do not trigger rollback and server is deleted", async () => {
      const { owner } = createMockOwner();
      let displayCallCount = 0;
      owner.settingTab = {
        display: () => {
          displayCallCount++;
          throw new Error("UI render crash in deleteServer");
        },
      };
      const coordinator = new McpTransactionCoordinator(owner);
      const server: McpServerSettings = {
        id: "srv-del-safe",
        name: "Del Safe Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: ["KEY"],
        toolPolicies: {},
        enabled: true,
      };

      // Save first
      await coordinator.saveServer(server, { envValues: { KEY: "val" }, removedEnvNames: [] });
      expect(owner.settings.mcpServers).toHaveLength(1);

      // Now deleteServer should resolve without throwing and server should be deleted
      await coordinator.deleteServer("srv-del-safe");
      expect(owner.settings.mcpServers).toHaveLength(0);
      expect(owner.draftSettings.mcpServers).toHaveLength(0);
      expect(displayCallCount).toBe(2); // exactly 1 for save, 1 for delete
    });

    it("saveServer and deleteServer call settingTab.display exactly 1 time per operation", async () => {
      const { owner } = createMockOwner();
      let displayCalls = 0;
      owner.settingTab = {
        display: () => {
          displayCalls++;
        },
      };
      const coordinator = new McpTransactionCoordinator(owner);
      const server: McpServerSettings = {
        id: "srv-exact-count",
        name: "Count Server",
        transport: "stdio",
        command: "python",
        args: [],
        cwd: "vault",
        url: "",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      // 1. Save calls display exactly 1 time
      await coordinator.saveServer(server, { envValues: {}, removedEnvNames: [] });
      expect(displayCalls).toBe(1);

      // 2. Delete calls display exactly 1 time
      await coordinator.deleteServer("srv-exact-count");
      expect(displayCalls).toBe(2);
    });
  });

  describe("strict handoff with awaiting_secret HTTP servers integration regression", () => {
    it("successfully saves stdio server A and commits when unrelated enabled HTTP server B is in awaiting_secret state", async () => {
      const serverB: McpServerSettings = {
        id: "srv-http-b",
        name: "HTTP Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [serverB] },
      });
      // Server B has no URL secret stored in secretStorage (legal awaiting_secret)
      expect(getMcpHttpUrl(app, "srv-http-b")).toBeNull();

      const coordinator = new McpTransactionCoordinator(owner);

      const serverA: McpServerSettings = {
        id: "srv-stdio-a",
        name: "Stdio Server A",
        transport: "stdio",
        command: "python",
        args: ["main.py"],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      const envSecretCanary = "super_canary_secret_12345";
      await coordinator.saveServer(serverA, {
        envValues: { API_KEY: envSecretCanary },
        removedEnvNames: [],
      });

      // 1. Secret storage committed
      expect(getMcpSecret(app, "srv-stdio-a", "API_KEY")).toBe(envSecretCanary);

      // 2. Settings & draft updated
      expect(owner.settings.mcpServers).toHaveLength(2);
      expect(owner.settings.mcpServers.find((s) => s.id === "srv-stdio-a")).toBeDefined();
      expect(owner.settings.mcpServers.find((s) => s.id === "srv-http-b")).toBeDefined();

      // 3. Strict handoff payload contains A secrets and B empty tombstone
      expect(owner.sidecarSecrets.servers["srv-stdio-a"]).toEqual({
        API_KEY: envSecretCanary,
      });
      expect(owner.sidecarSecrets.http_urls["srv-http-b"]).toBe("");

      // 4. No rollback occurred
      expect(owner.sidecarGeneration).toBe(2);
      expect(owner.dataJson.mcpServers).toHaveLength(2);
    });

    it("successfully deletes server A when unrelated enabled HTTP server B has empty tombstone", async () => {
      const serverA: McpServerSettings = {
        id: "srv-stdio-a",
        name: "Stdio Server A",
        transport: "stdio",
        command: "python",
        args: ["main.py"],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };
      const serverB: McpServerSettings = {
        id: "srv-http-b",
        name: "HTTP Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://mcp.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [serverA, serverB] },
      });
      setMcpSecret(app, "srv-stdio-a", "API_KEY", "key_to_delete");
      // B has no URL secret in secretStorage

      const coordinator = new McpTransactionCoordinator(owner);
      await coordinator.deleteServer("srv-stdio-a");

      // Server A deleted, Server B remains
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-http-b");
      expect(getMcpSecret(app, "srv-stdio-a", "API_KEY")).toBeNull();
      expect(owner.sidecarSecrets.http_urls["srv-http-b"]).toBe("");
      expect(owner.sidecarSecrets.servers["srv-stdio-a"]).toBeUndefined();
    });

    it("successfully saves HTTP server C when unrelated enabled HTTP server B is in awaiting_secret state", async () => {
      const serverB: McpServerSettings = {
        id: "srv-http-b",
        name: "HTTP Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://origin-b.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [serverB] },
      });

      const coordinator = new McpTransactionCoordinator(owner);

      const serverC: McpServerSettings = {
        id: "srv-http-c",
        name: "HTTP Server C",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://origin-c.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const fullUrlC = "https://origin-c.example.com/stream?token=secret_token_c";
      await coordinator.saveServer(serverC, {
        envValues: {},
        removedEnvNames: [],
        httpUrl: fullUrlC,
      });

      expect(getMcpHttpUrl(app, "srv-http-c")).toBe(fullUrlC);
      expect(owner.settings.mcpServers).toHaveLength(2);
      expect(owner.sidecarSecrets.http_urls["srv-http-c"]).toBe(fullUrlC);
      expect(owner.sidecarSecrets.http_urls["srv-http-b"]).toBe("");
    });

    it("rolls back transaction with coded error when server B secretStorage read throws during strict handoff", async () => {
      const serverB: McpServerSettings = {
        id: "srv-http-b",
        name: "HTTP Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://origin-b.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const secretStore = new Map<string, string>();
      const app = {
        secretStorage: {
          getSecret: (key: string) => {
            if (key.includes("srv-http-b")) {
              throw new Error("Corrupted keychain sector");
            }
            return secretStore.get(key) ?? null;
          },
          setSecret: (key: string, value: string) => {
            secretStore.set(key, value);
          },
          deleteSecret: (key: string) => {
            secretStore.delete(key);
          },
          listSecrets: () => Array.from(secretStore.keys()),
        },
      } as unknown as App;

      const { owner } = createMockOwner({
        app,
        initialSettings: { mcpServers: [serverB] },
      });

      const coordinator = new McpTransactionCoordinator(owner);

      const serverA: McpServerSettings = {
        id: "srv-stdio-a",
        name: "Stdio Server A",
        transport: "stdio",
        command: "python",
        args: ["main.py"],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(serverA, {
          envValues: { API_KEY: "canary_key_not_saved" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_PAYLOAD_READ_FAILED:srv-http-b");

      // Rollback verified: server A is NOT saved, secrets rolled back
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-http-b");
      expect(getMcpSecret(app, "srv-stdio-a", "API_KEY")).toBeNull();
    });

    it("rolls back transaction with coded error when server B has non-empty origin mismatch URL during strict handoff", async () => {
      const serverB: McpServerSettings = {
        id: "srv-http-b",
        name: "HTTP Server B",
        transport: "http",
        command: "",
        args: [],
        cwd: "vault",
        url: "https://configured-origin.example.com",
        envNames: [],
        toolPolicies: {},
        enabled: true,
      };

      const { owner, app } = createMockOwner({
        initialSettings: { mcpServers: [serverB] },
      });
      const canarySecretB = "mismatched_canary_token_secret_999";
      setMcpHttpUrl(
        app,
        "srv-http-b",
        `https://malicious-origin.example.com/mcp?token=${canarySecretB}`,
      );

      const coordinator = new McpTransactionCoordinator(owner);

      const serverA: McpServerSettings = {
        id: "srv-stdio-a",
        name: "Stdio Server A",
        transport: "stdio",
        command: "python",
        args: ["main.py"],
        cwd: "vault",
        url: "",
        envNames: ["API_KEY"],
        toolPolicies: {},
        enabled: true,
      };

      let caught: Error | null = null;
      try {
        await coordinator.saveServer(serverA, {
          envValues: { API_KEY: "my_key" },
          removedEnvNames: [],
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("MCP_SECRET_PAYLOAD_ORIGIN_MISMATCH:srv-http-b");
      // Canary and mismatched URL origin not leaked in error message
      expect(caught!.message).not.toContain(canarySecretB);
      expect(caught!.message).not.toContain("malicious-origin.example.com");

      // Rollback verified
      expect(owner.settings.mcpServers).toHaveLength(1);
      expect(owner.settings.mcpServers[0].id).toBe("srv-http-b");
      expect(getMcpSecret(app, "srv-stdio-a", "API_KEY")).toBeNull();
    });
  });
});


