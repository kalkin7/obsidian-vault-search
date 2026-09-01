import { FileSystemAdapter, Notice, Plugin, requestUrl, TFile } from "obsidian";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import * as path from "path";
import {
  agentIntegrationNotice,
  agentIntegrationStatus,
  installAgentIntegration,
  type AgentIntegrationResult,
  type AgentIntegrationStatus,
} from "./agent-integration";
import { BackendManager } from "./backend-manager";
import {
  DEFAULT_SETTINGS,
  LLM_MODEL_ENDPOINTS,
  LLM_PROVIDER_DEFAULTS,
  MAX_MCP_URL_CHARS,
  reasoningEffortLevels,
  VIEW_TYPE_VAULT_AI_SEARCH,
} from "./constants";
import { McpServerEditorModal } from "./mcp-server-modal";
import {
  cloneMcpServers,
  McpTransactionCoordinator,
} from "./mcp-transaction-coordinator";
import { VaultSearchSettingTab } from "./settings-tab";
import {
  cloneSettings,
  defaultLoadPolicy,
  hotConfig,
  isAutoPython,
  migrateSettings,
  settingsImpact,
} from "./settings";
import type {
  BackendInstallState,
  BackendStatus,
  McpServerSettings,
  PythonRuntimeInfo,
  VaultSearchSettings,
} from "./types";
import { VaultEventQueue } from "./vault-event-queue";
import { VaultSearchModal } from "./search-modal";
import type { SearchResultLocation } from "./search-result-view";
import { selectedTextQuery } from "./search-session";
import { confirmRuntimeInstall } from "./runtime-install-modal";
import { selectRuntime } from "./runtime-selection";
import { VaultSearchItemView } from "./search-item-view";
import {
  getProviderSecret,
  hasSecretStorage,
  providerEnvironment,
  setProviderSecret,
  validateProviderApiKey,
} from "./llm-secrets";
import {
  buildMcpSecretPayload,
  deleteMcpHttpUrl,
  deleteMcpSecret,
  deleteServerSecrets,
  getMcpHttpUrl,
  getMcpSecret,
  hasMcpEnvSecret,
  hasMcpHttpUrl,
  migrateMcpHttpUrls,
  setMcpHttpUrl,
  setMcpSecret,
} from "./mcp-secrets";
import { toSafeOrigin } from "./mcp-server-form";
import type {
  FavoriteAnswerModel,
  LLMProviderId,
  McpStatusResponse,
  McpToolPolicy,
  SkillsStatusResponse,
} from "./types";
import { normalizeProviderModels } from "./model-catalog";
import { ICON_LIGHTNING, registerLightningIcon } from "./icons";

const PROVIDER_IDS: LLMProviderId[] = ["openai", "opencode-go", "deepseek"];

/** Normalize the stored favorite list. Accepts the legacy flat string[]
 *  shape (v0.1.16), attributing each model to the current provider, plus the
 *  { provider, model } shape saved since. */
function normalizeFavoriteModels(
  raw: unknown[],
  fallbackProvider: LLMProviderId,
): FavoriteAnswerModel[] {
  const seen = new Set<string>();
  const out: FavoriteAnswerModel[] = [];
  for (const entry of raw) {
    let provider = fallbackProvider;
    let model = "";
    if (typeof entry === "string") {
      model = entry.trim();
    } else if (entry && typeof entry === "object") {
      const value = entry as { provider?: unknown; model?: unknown };
      model = typeof value.model === "string" ? value.model.trim() : "";
      if (PROVIDER_IDS.includes(value.provider as LLMProviderId)) {
        provider = value.provider as LLMProviderId;
      }
    }
    if (!model) continue;
    const key = `${provider}::${model}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ provider, model });
    }
  }
  return out;
}

export default class VaultSearchPlugin extends Plugin {
  declare settings: VaultSearchSettings;
  draftSettings!: VaultSearchSettings;
  backend!: BackendManager;
  private queue!: VaultEventQueue;
  settingTab!: VaultSearchSettingTab;
  private startupPrepared = false;
  private startupInProgress = false;
  private startupConfigSanitized = false;
  private searchModal: VaultSearchModal | null = null;
  private readonly aiSearchViews = new Set<VaultSearchItemView>();
  /** Unified FIFO serialization boundary for debounced settings applies, manual applies, and transactions. */
  private settingsQueue: Promise<void> = Promise.resolve();
  /** Debounce handle for auto-applying settings-tab edits. */
  private draftApplyTimer: number | null = null;
  /** Backing state of the stable draft proxy (identity never changes, so
   *  controls bound to the proxy keep working after an auto-apply). */
  private draftTarget!: VaultSearchSettings;
  /** Set when a draft edit lands while an apply is in flight — a follow-up
   *  apply is then scheduled so the edit is never dropped. */
  private draftDirty = false;
  private readonly providerModels: Partial<Record<LLMProviderId, string[]>> =
    {};
  runtimeSummary = "런타임: 확인 전";
  runtimeWarning: string | null = null;
  /** Install state of the plugin-side Python backend folder, shown in the
   *  settings tab. Refreshed on load and after (re)provisioning. */
  backendInstall: BackendInstallState = {
    installed: false,
    version: null,
    expected: "",
  };
  /** Installed state of the agent integration (AGENTS.md block + wrapper + skill). */
  agentIntegration: AgentIntegrationStatus | null = null;
  private _unloaded = false;
  private _agentIntegrationTask: Promise<void> | null = null;

  async onload(): Promise<void> {
    registerLightningIcon();
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice(
        "Vault Search Service는 데스크톱 파일시스템 볼트만 지원합니다.",
      );
      return;
    }
    const vaultPath = adapter.getBasePath();
    const pluginDir = path.join(
      vaultPath,
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
    );
    this.backend = new BackendManager(
      vaultPath,
      pluginDir,
      () => this.settings,
      (status) => this.handleStatus(status),
      this.manifest.version,
      () => providerEnvironment(this.app),
      (options) =>
        buildMcpSecretPayload(
          this.app,
          this.settings.mcpServers || [],
          options,
        ),
    );
    // Atomically ensure service-config.json exists in sanitized form (safe origins only)
    try {
      await this.backend.persistServiceConfig();
      this.startupConfigSanitized = true;
    } catch {
      this.startupConfigSanitized = false;
      console.warn(
        "[vault-search] Failed to write sanitized service-config during startup (SERVICE_CONFIG_WRITE_FAILED)",
      );
      new Notice(
        "Vault Search 초기화 실패: SERVICE_CONFIG_WRITE_FAILED",
        10000,
      );
    }
    const machinePython = await this.backend.readMachinePython();
    if (machinePython) this.settings.pythonExecutable = machinePython;
    else await this.backend.writeMachinePython(this.settings.pythonExecutable);
    await this.refreshBackendInstall();
    this.initDraft(this.settings);
    this.queue = new VaultEventQueue(
      () => this.settings.syncDebounceMs,
      async (changed, deleted) => {
        if (!this.settings.autoSync) return true;
        if (!this.isReady()) return false;
        await this.backend.call("sync_paths", { changed, deleted }, 120_000);
        return true;
      },
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) this.queue.markChanged(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) this.queue.markChanged(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) this.queue.markDeleted(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.queue.markDeleted(oldPath);
          this.queue.markChanged(file.path);
        }
      }),
    );

    this.settingTab = new VaultSearchSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerView(
      VIEW_TYPE_VAULT_AI_SEARCH,
      (leaf) => new VaultSearchItemView(leaf, this),
    );
    const ribbonIcon = this.addRibbonIcon(
      ICON_LIGHTNING,
      "Open AI Vault Search",
      () => {
        void this.openAiSearchPanel();
      },
    );
    void ribbonIcon;
    this.registerCommands();
    this._agentIntegrationTask = this.refreshAgentIntegration().catch((e) => {
      console.warn("[vault-search] refreshAgentIntegration failed", e);
    });

    this.app.workspace.onLayoutReady(() => {
      if (!this.startupConfigSanitized) {
        return;
      }
      if (this.settings.loadPolicy === "vault-open") {
        void this.startBackend().catch(
          (error) =>
            new Notice(
              `Vault Search 시작 실패: ${this.errorMessage(error)}`,
              10000,
            ),
        );
      } else if (this.settings.loadPolicy === "first-search") {
        void this.startLazyBackend().catch(
          (error) =>
            new Notice(
              `Vault Search 대기 서비스 시작 실패: ${this.errorMessage(error)}`,
              10000,
            ),
        );
      }
    });
  }

  onunload(): void {
    this._unloaded = true;
    if (this.draftApplyTimer !== null) clearTimeout(this.draftApplyTimer);
    this.queue?.clear();
    this.clearRecoveryTimers();
    // Plugin unload must not kill a standalone daemon started by the CLI; it
    // only detaches from it (heartbeat stops, process survives).
    if (this.backend) void this.backend.stop(true);
  }

  private clearRecoveryTimers(): void {
    // No direct timers here, but ensure any pending agent integration task does not touch UI
  }

  async loadSettings(): Promise<void> {
    const loaded =
      (await this.loadData()) as Partial<VaultSearchSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded || {}) };
    this.settings.includeGlobs = loaded?.includeGlobs || [
      ...DEFAULT_SETTINGS.includeGlobs,
    ];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [
      ...DEFAULT_SETTINGS.excludeGlobs,
    ];
    const rawFavorites = loaded?.favoriteAnswerModels;
    this.settings.favoriteAnswerModels = Array.isArray(rawFavorites)
      ? normalizeFavoriteModels(rawFavorites, this.settings.answerProvider)
      : [];
    // Restore the fetched model lists so the settings model list and its
    // stars survive restarts without re-running "모델 최신화".
    const fetched = this.settings.fetchedProviderModels || {};
    for (const provider of Object.keys(fetched) as LLMProviderId[]) {
      const models = fetched[provider];
      if (Array.isArray(models)) {
        this.providerModels[provider] = models.filter(
          (model): model is string => typeof model === "string",
        );
      }
    }
    if (
      !(
        this.settings.answerProvider in
        { openai: true, "opencode-go": true, deepseek: true }
      )
    )
      this.settings.answerProvider = DEFAULT_SETTINGS.answerProvider;
    this.settings.answerModel = String(
      this.settings.answerModel || DEFAULT_SETTINGS.answerModel,
    );
    if (
      !["auto", "none", "low", "medium", "high", "xhigh", "max"].includes(
        this.settings.answerReasoningEffort,
      )
    ) {
      this.settings.answerReasoningEffort = "auto";
    }
    this.settings.answerMaxContextChars = Math.max(
      8000,
      Math.min(
        32000,
        Number(this.settings.answerMaxContextChars) ||
          DEFAULT_SETTINGS.answerMaxContextChars,
      ),
    );
    this.settings.answerMaxOutputTokens = Math.max(
      128,
      Math.min(
        8000,
        Number(this.settings.answerMaxOutputTokens) ||
          DEFAULT_SETTINGS.answerMaxOutputTokens,
      ),
    );
    this.settings.answerTimeoutSeconds = Math.max(
      5,
      Math.min(
        60,
        Number(this.settings.answerTimeoutSeconds) ||
          DEFAULT_SETTINGS.answerTimeoutSeconds,
      ),
    );
    const mcpMigration = migrateMcpHttpUrls(this.app, this.settings);
    const failedIds = new Set(mcpMigration.failedServers.map((s) => s.id));
    if (mcpMigration.failedServers.length > 0) {
      new Notice(
        `일부 원격 MCP 서버(${mcpMigration.failedServers.length}개)의 URL 보안 저장소 이전에 실패하여 해당 서버가 비활성화되었습니다. 설정을 확인해 주세요.`,
        8000,
      );
    }
    if (mcpMigration.migratedCount > 0) {
      new Notice(
        "원격 MCP 서버 URL이 보안 저장소로 안전하게 이전되었습니다. 보안을 위해 원격 서비스의 토큰을 재발급(회전)하는 것을 권장합니다.",
        8000,
      );
    }
    const migrated = migrateSettings(this.settings) || mcpMigration.changed;
    if (loaded?.loadPolicy === undefined) {
      this.settings.loadPolicy = defaultLoadPolicy(this.settings.engine);
    }
    this.normalizeAgentSettings(failedIds);
    this.initDraft(this.settings);
    if (migrated || loaded?.loadPolicy === undefined) {
      await this.saveSettings();
    }
  }

  /** Refresh the settings-tab backend install state (installed / version
   *  match). Called on load and after backend (re)provisioning. */
  async refreshBackendInstall(): Promise<void> {
    this.backendInstall = {
      installed: false,
      version: null,
      expected: this.manifest.version,
    };
    const version = await this.backend.backendVersion();
    if (version !== null) {
      this.backendInstall = {
        installed: true,
        version,
        expected: this.manifest.version,
      };
    }
  }

  async saveSettings(): Promise<void> {
    const { pythonExecutable, ...portable } = this.settings;
    await this.saveData(portable);
    if (this.backend) {
      await this.backend.writeMachinePython(pythonExecutable);
      // Keep service-config.json in sync with hot changes (model / reasoning
      // effort / provider switches) so a sidecar restart does not reload a
      // stale provider/model from the last spawn.
      await this.backend.persistServiceConfig();
    }
  }

  getProviderApiKey(provider: LLMProviderId): string {
    return getProviderSecret(this.app, provider);
  }

  async saveProviderApiKey(
    provider: LLMProviderId,
    value: string,
  ): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.saveProviderApiKeyUnlocked(provider, value),
    );
  }

  private async saveProviderApiKeyUnlocked(
    provider: LLMProviderId,
    value: string,
  ): Promise<void> {
    if (!hasSecretStorage(this.app)) {
      throw new Error(
        "Obsidian 1.11.4 이상에서만 API 키를 보안 저장할 수 있습니다.",
      );
    }
    const secret = value.trim();
    if (!secret) {
      // Empty value = delete (the settings Delete button): clear the stored
      // secret and restart the sidecar so the cleared key takes effect.
      setProviderSecret(this.app, provider, "");
      if (this.backend.status.state !== "stopped") await this.backend.restart();
      return;
    }
    // Probe the real chat endpoint before saving: the models endpoint does
    // not validate keys, so a definitive 401/403 here is the only reliable
    // way to catch a wrong or expired key at save time.
    const status = await validateProviderApiKey(provider, secret);
    if (status === "invalid") {
      throw new Error(
        `${LLM_PROVIDER_DEFAULTS[provider].name}가 이 API 키를 거부했습니다. ` +
          "키를 다시 복사하거나 provider 콘솔에서 구독/키 상태를 확인해 주세요.",
      );
    }
    setProviderSecret(this.app, provider, secret);
    if (this.backend.status.state !== "stopped") await this.backend.restart();
  }

  async fetchProviderModels(provider: LLMProviderId): Promise<string[]> {
    const apiKey = getProviderSecret(this.app, provider);
    if (!apiKey) throw new Error("먼저 이 provider의 API 키를 저장해 주세요.");
    const response = await requestUrl({
      url: LLM_MODEL_ENDPOINTS[provider],
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = response.json?.data;
    if (!Array.isArray(data))
      throw new Error("provider가 모델 목록을 반환하지 않았습니다.");
    return normalizeProviderModels(provider, data);
  }

  getProviderModels(provider: LLMProviderId): string[] {
    return this.providerModels[provider] || [];
  }

  /** Cache of fetched model lists per provider (shared by settings + view).
   *  Persists to data.json so restarts keep the list and its stars. */
  async setProviderModels(
    provider: LLMProviderId,
    models: string[],
  ): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.setProviderModelsUnlocked(provider, models),
    );
  }

  private async setProviderModelsUnlocked(
    provider: LLMProviderId,
    models: string[],
  ): Promise<void> {
    const previousMemory = this.providerModels[provider];
    const previousSettings = this.settings.fetchedProviderModels;
    const previousDraft = this.draftSettings.fetchedProviderModels;

    this.providerModels[provider] = models;
    this.settings.fetchedProviderModels = {
      ...this.settings.fetchedProviderModels,
      [provider]: models,
    };
    this.draftSettings.fetchedProviderModels = {
      ...this.draftSettings.fetchedProviderModels,
      [provider]: models,
    };
    try {
      await this.saveSettings();
    } catch (err) {
      if (previousMemory === undefined) {
        delete this.providerModels[provider];
      } else {
        this.providerModels[provider] = previousMemory;
      }
      this.settings.fetchedProviderModels = previousSettings;
      this.draftSettings.fetchedProviderModels = previousDraft;
      throw err;
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
  }

  /** Models the AI search footer offers: the chosen model (if any) plus
   *  favorites from ALL providers that have an API key configured — models of
   *  a provider without a key are never offered, and nothing is presumed:
   *  with no choice and no favorites the selector stays empty. Selecting a
   *  cross-provider favorite also switches the provider. */
  getAnswerModelOptions(): FavoriteAnswerModel[] {
    const favorites = (this.settings.favoriteAnswerModels || []).filter(
      (favorite) => favorite?.model && this.hasProviderKey(favorite.provider),
    );
    const currentProvider = this.settings.answerProvider;
    const options: FavoriteAnswerModel[] = [];
    const seen = new Set<string>();
    const push = (provider: LLMProviderId, model: string) => {
      const key = `${provider}::${model}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ provider, model });
      }
    };
    if (this.settings.answerModel) {
      push(currentProvider, this.settings.answerModel);
    }
    for (const favorite of favorites) {
      push(favorite.provider, favorite.model);
    }
    if (favorites.length) return options;
    if (options.length) return options;
    // No choice and no favorites: fall back to the fetched list of the
    // current provider (only when its key is present) so the selector is not
    // permanently empty before favorites exist.
    if (this.hasProviderKey(currentProvider)) {
      for (const model of this.providerModels[currentProvider] || []) {
        push(currentProvider, model);
      }
    }
    return options;
  }

  private hasProviderKey(provider: LLMProviderId): boolean {
    return Boolean(getProviderSecret(this.app, provider));
  }

  /** Change the answer provider/model (hot — no restart; the backend picks
   *  it up on the next answer request). Persists immediately so a plugin
   *  update/reload never loses the choice. */
  async setAnswerModel(
    provider: LLMProviderId,
    model: string,
    options?: { notify?: boolean },
  ): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.setAnswerModelUnlocked(provider, model, options),
    );
  }

  private async setAnswerModelUnlocked(
    provider: LLMProviderId,
    model: string,
    options?: { notify?: boolean },
  ): Promise<void> {
    const value = model.trim();
    const previous = this.settings.answerModel;
    const previousProvider = this.settings.answerProvider;
    const previousReasoning = this.settings.answerReasoningEffort;
    const previousDraftModel = this.draftSettings.answerModel;
    const previousDraftProvider = this.draftSettings.answerProvider;
    const previousDraftReasoning = this.draftSettings.answerReasoningEffort;

    if (!value || (value === previous && provider === previousProvider)) return;
    this.settings.answerProvider = provider;
    this.settings.answerModel = value;
    // The reasoning effort must stay valid for the newly selected model:
    // reset to auto when the stored level is not in the new model's set, so
    // an unsupported value (e.g. xhigh after switching to deepseek-v4-flash)
    // is never sent to the provider.
    const effort = this.settings.answerReasoningEffort;
    if (
      effort !== "auto" &&
      !reasoningEffortLevels(provider, value).includes(effort)
    ) {
      this.settings.answerReasoningEffort = "auto";
      this.draftSettings.answerReasoningEffort = "auto";
    }
    // Keep the settings draft in sync so a later "설정 적용" does not
    // overwrite this hot change with a stale draft value.
    this.draftSettings.answerProvider = provider;
    this.draftSettings.answerModel = value;
    try {
      await this.saveSettings();
    } catch (err) {
      this.settings.answerProvider = previousProvider;
      this.settings.answerModel = previous;
      this.settings.answerReasoningEffort = previousReasoning;
      this.draftSettings.answerProvider = previousDraftProvider;
      this.draftSettings.answerModel = previousDraftModel;
      this.draftSettings.answerReasoningEffort = previousDraftReasoning;
      throw err;
    }
    if (this.backend.status.state !== "stopped") {
      await this.backend
        .call("apply_search_config", hotConfig(this.settings), 30_000)
        .catch(() => undefined);
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
    if (options?.notify ?? true) {
      new Notice(
        provider === previousProvider
          ? `답변 모델을 ${value}(으)로 변경했습니다.`
          : `답변 provider를 ${provider}로 전환하고 모델을 ${value}(으)로 변경했습니다.`,
      );
    }
  }

  /** Reasoning levels the current answer model supports (with auto). */
  getAnswerReasoningEffortOptions(): string[] {
    return [
      "auto",
      ...reasoningEffortLevels(
        this.settings.answerProvider,
        this.settings.answerModel,
      ),
    ];
  }

  /** Change the reasoning effort from the panel composer (hot, persists). */
  async setAnswerReasoningEffort(effort: string): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.setAnswerReasoningEffortUnlocked(effort),
    );
  }

  private async setAnswerReasoningEffortUnlocked(
    effort: string,
  ): Promise<void> {
    const value = effort.trim();
    const valid = [
      "auto",
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ].includes(value);
    if (!valid || value === this.settings.answerReasoningEffort) return;
    const previousSettings = this.settings.answerReasoningEffort;
    const previousDraft = this.draftSettings.answerReasoningEffort;

    this.settings.answerReasoningEffort =
      value as VaultSearchSettings["answerReasoningEffort"];
    this.draftSettings.answerReasoningEffort =
      this.settings.answerReasoningEffort;
    try {
      await this.saveSettings();
    } catch (err) {
      this.settings.answerReasoningEffort = previousSettings;
      this.draftSettings.answerReasoningEffort = previousDraft;
      throw err;
    }
    if (this.backend.status.state !== "stopped") {
      await this.backend
        .call("apply_search_config", hotConfig(this.settings), 30_000)
        .catch(() => undefined);
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
  }

  /** Star/unstar a model from the settings list. Persists immediately (hot)
   *  so favorites survive plugin updates; cross-provider favorites are all
   *  offered in the AI search footer selector. */
  async toggleFavoriteModel(
    provider: LLMProviderId,
    model: string,
    desiredFavorite?: boolean,
  ): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.toggleFavoriteModelUnlocked(provider, model, desiredFavorite),
    );
  }

  async setFavoriteModel(
    provider: LLMProviderId,
    model: string,
    desiredFavorite: boolean,
  ): Promise<void> {
    return this.enqueueSettingsLock(() =>
      this.toggleFavoriteModelUnlocked(provider, model, desiredFavorite),
    );
  }

  private async toggleFavoriteModelUnlocked(
    provider: LLMProviderId,
    model: string,
    desiredFavorite?: boolean,
  ): Promise<void> {
    const currentFavorites = this.settings.favoriteAnswerModels || [];
    const isFavorite = currentFavorites.some(
      (favorite) => favorite.provider === provider && favorite.model === model,
    );
    const targetFavorite =
      desiredFavorite === undefined ? !isFavorite : desiredFavorite;

    if (isFavorite === targetFavorite) {
      if (this.draftSettings.favoriteAnswerModels) {
        const draftHasIt = (this.draftSettings.favoriteAnswerModels || []).some(
          (f) => f.provider === provider && f.model === model,
        );
        if (draftHasIt !== targetFavorite) {
          this.draftSettings.favoriteAnswerModels = currentFavorites.map(
            (f) => ({ ...f }),
          );
        }
      }
      return;
    }

    const previousSettings = this.settings.favoriteAnswerModels;
    const previousDraft = this.draftSettings.favoriteAnswerModels;

    const favorites = currentFavorites.map((favorite) => ({ ...favorite }));
    const index = favorites.findIndex(
      (favorite) => favorite.provider === provider && favorite.model === model,
    );
    if (targetFavorite) {
      if (index < 0) favorites.push({ provider, model });
    } else if (index >= 0) favorites.splice(index, 1);
    this.settings.favoriteAnswerModels = favorites;
    this.draftSettings.favoriteAnswerModels = favorites.map((favorite) => ({
      ...favorite,
    }));
    try {
      await this.saveSettings();
    } catch (err) {
      this.settings.favoriteAnswerModels = previousSettings;
      this.draftSettings.favoriteAnswerModels = previousDraft;
      throw err;
    }
    if (this.backend.status.state !== "stopped") {
      await this.backend
        .call("apply_search_config", hotConfig(this.settings), 30_000)
        .catch(() => undefined);
    }
    for (const view of this.aiSearchViews) view.refreshModelSelector();
  }

  /** Create the single stable draft proxy the settings tab edits. Any later
   *  change schedules a debounced auto-apply — the settings tab has no save
   *  button; edits persist on their own (~0.7 s after the last keystroke). */
  private initDraft(settings: VaultSearchSettings): void {
    this.draftTarget = cloneSettings(settings);
    this.draftSettings = new Proxy(this.draftTarget, {
      set: (target, property, value) => {
        const applied = Reflect.set(target, property, value);
        if (applied) {
          this.draftDirty = true;
          this.scheduleDraftApply();
        }
        return applied;
      },
    });
  }

  /** Mutate the draft backing state in-place to the given settings and cancel
   *  any pending debounced auto-apply timer. Proxy identity remains unchanged. */
  restoreDraftInPlace(settings: VaultSearchSettings): void {
    this.cancelPendingDraftApply();
    this.syncDraftTo(settings);
  }

  /** Mutate the draft MCP servers slice in-place to the given server list. */
  restoreMcpServersInPlace(servers: McpServerSettings[]): void {
    this.draftTarget.mcpServers = cloneMcpServers(servers);
  }

  /** Cancel any scheduled auto-apply timer so stale keystrokes are not applied early. */
  cancelPendingDraftApply(): void {
    if (this.draftApplyTimer !== null) {
      clearTimeout(this.draftApplyTimer);
      this.draftApplyTimer = null;
    }
  }

  private async enqueueSettingsLock<T>(action: () => Promise<T>): Promise<T> {
    const prevQueue = this.settingsQueue;
    let releaseLock!: () => void;
    this.settingsQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prevQueue.catch(() => undefined);
    try {
      return await action();
    } finally {
      releaseLock();
    }
  }

  /** Serialize transactional updates against concurrent settings auto-applies. */
  async withTransactionLock<T>(action: () => Promise<T>): Promise<T> {
    this.cancelPendingDraftApply();
    return this.enqueueSettingsLock(async () => {
      this.cancelPendingDraftApply();
      try {
        return await action();
      } finally {
        if (this.draftDirty) {
          this.scheduleDraftApply();
        }
      }
    });
  }

  /** Replace the draft's contents with the given settings WITHOUT scheduling
   *  an auto-apply (used after a successful apply). The proxy identity stays
   *  the same, so settings controls bound to it keep receiving edits. */
  private syncDraftTo(settings: VaultSearchSettings): void {
    for (const key of Object.keys(this.draftTarget) as Array<
      keyof VaultSearchSettings
    >) {
      if (!(key in settings)) {
        delete (this.draftTarget as any)[key];
      }
    }
    Object.assign(this.draftTarget, cloneSettings(settings));
  }

  /** Debounced auto-apply for draft edits (batches text-field keystrokes). */
  scheduleDraftApply(): void {
    if (this.draftApplyTimer !== null) clearTimeout(this.draftApplyTimer);
    this.draftApplyTimer = window.setTimeout(() => {
      this.draftApplyTimer = null;
      void this.applyDraftSettings().catch((error) => {
        new Notice(`설정 적용 실패: ${this.errorMessage(error)}`, 8000);
      });
    }, 700);
  }

  async applyDraftSettings(options?: { unlocked?: boolean }): Promise<void> {
    if (options?.unlocked) {
      return this.applyDraftSettingsUnlocked();
    }
    return this.enqueueSettingsLock(async () => {
      this.cancelPendingDraftApply();
      await this.applyDraftSettingsUnlocked();
      if (this.draftDirty) {
        this.scheduleDraftApply();
      }
    });
  }

  async applyDraftSettingsUnlocked(): Promise<void> {
    return this.applyDraftSettingsInternal();
  }

  private async applyDraftSettingsInternal(): Promise<void> {
    this.draftDirty = false;
    const previous = cloneSettings(this.settings);
    const next = cloneSettings(this.draftSettings);
    const impact = settingsImpact(previous, next);
    if (impact === "none") return;
    if (
      previous.device !== next.device ||
      previous.engine !== next.engine ||
      previous.pythonExecutable !== next.pythonExecutable
    ) {
      await this.prepareRuntime(next, true);
    }
    const previousWasRunning = this.backend.status.state !== "stopped";

    try {
      if (impact === "all" || impact === "vectors" || impact === "restart") {
        await this.backend.stop();
        this.settings = next;
        await this.saveSettings();
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        if (impact === "all")
          await this.backend.call("rebuild_all", {}, 3_600_000);
        if (impact === "vectors")
          await this.backend.call("rebuild_vectors", {}, 3_600_000);
        if (!previousWasRunning && this.settings.loadPolicy === "manual")
          await this.backend.stop();
      } else {
        this.settings = next;
        await this.saveSettings();
        // Hot settings must reach a live backend even before the model loads
        // (lazy sidecar): the service applies them without the model. Scope
        // changes additionally need a ready index to reconcile.
        if (this.backend.status.state !== "stopped") {
          await this.backend.call("apply_search_config", hotConfig(next));
          if (impact === "scope" && this.isReady())
            await this.backend.call("reconcile", { mode: "fast" }, 600_000);
        }
      }
      if (!this.draftDirty) {
        this.syncDraftTo(this.settings);
      }
      if (impact === "all" || impact === "vectors" || impact === "restart") {
        new Notice(
          impact === "all"
            ? "설정을 적용하고 전체 인덱스를 재구축했습니다."
            : impact === "vectors"
              ? "설정을 적용하고 벡터 인덱스를 재구축했습니다."
              : "설정을 적용하고 서비스를 재시작했습니다.",
        );
      }
    } catch (error) {
      await this.backend.stop().catch(() => undefined);
      this.settings = previous;
      await this.saveSettings();
      if (previousWasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      if (this.draftDirty) this.scheduleDraftApply();
      throw error;
    } finally {
      // No full settings-tab re-render here: auto-apply fires while the user
      // is typing, and a re-render resets the scroll position. The status
      // line refreshes in place via backend status events; the panel model
      // selector is the only part that must rebuild.
      for (const view of this.aiSearchViews) view.refreshModelSelector();
    }
  }

  async ensureSanitizedConfig(): Promise<void> {
    if (!this.startupConfigSanitized) {
      try {
        await this.backend.persistServiceConfig();
        this.startupConfigSanitized = true;
      } catch {
        new Notice(
          "Vault Search 시작 실패: SERVICE_CONFIG_WRITE_FAILED",
          10000,
        );
        throw new Error("SERVICE_CONFIG_WRITE_FAILED");
      }
    }
  }

  async startBackend(): Promise<void> {
    await this.ensureSanitizedConfig();
    // If a sidecar is already live (plugin reload, previous Start), attach
    // instead of inspecting Python and killing the process. That hang is
    // what left the Start button spinning.
    await this.backend.start(false);
    const state = this.backend.status.state;
    if (state === "stopped" || state === "error" || state === "starting") {
      await this.prepareRuntime(this.settings, false);
      await this.backend.start(false);
    }
    this.settingTab?.display();
    void this.backend
      .ensureStarted()
      .then(() => this.completeStartup())
      .catch(
        (error) =>
          new Notice(
            `Vault Search 시작 실패: ${this.errorMessage(error)}`,
            10000,
          ),
      );
  }

  async installCudaRuntime(): Promise<void> {
    return this.enqueueSettingsLock(async () => {
      this.cancelPendingDraftApply();
      await this.installCudaRuntimeInternal();
      if (this.draftDirty) {
        this.scheduleDraftApply();
      }
    });
  }

  private async installCudaRuntimeInternal(): Promise<void> {
    // A usable runtime already proves CUDA availability, and nvidia-smi may be
    // absent from PATH even when the driver works — so validate existing
    // runtimes first and only require the GPU probe when an install is needed.
    const current = await this.backend.inspectPython(
      this.settings.pythonExecutable,
    );
    const cuda = await this.backend.managedRuntime("cuda");
    if (current?.cudaAvailable || cuda?.cudaAvailable) {
      new Notice(
        current?.cudaAvailable
          ? "현재 런타임이 이미 CUDA를 사용 중입니다."
          : "설치된 CUDA 런타임이 이미 사용 가능합니다.",
        8000,
      );
      this.settingTab?.display();
      return;
    }
    if (!(await this.backend.hasNvidiaGpu())) {
      throw new Error("NVIDIA GPU 또는 드라이버를 찾을 수 없습니다.");
    }
    if (!(await confirmRuntimeInstall(this.app, true))) return;
    const cpu = await this.backend.managedRuntime("cpu");
    const basePython =
      current?.baseExecutable || cpu?.baseExecutable || "python";
    new Notice(
      "CUDA 런타임을 설치하고 있습니다. 수 분 이상 걸릴 수 있습니다.",
      10000,
    );
    const installed = await this.backend.installManagedRuntime(
      "cuda",
      basePython,
      (text) => {
        if (text)
          this.runtimeSummary = `CUDA 설치 중: ${text.split(/\r?\n/).at(-1)}`;
      },
    );
    this.runtimeSummary = `런타임: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`;
    this.runtimeWarning = null;
    if (this.settings.device === "cpu") {
      const active = current || cpu;
      this.runtimeSummary = active
        ? `런타임: CPU / PyTorch ${active.torchVersion} (CUDA 런타임 설치됨)`
        : "런타임: CPU (CUDA 런타임 설치됨)";
      new Notice(
        "CUDA 런타임을 설치했습니다. 현재 CPU 명시 설정은 유지됩니다.",
        10000,
      );
      this.settingTab?.display();
      return;
    }
    const previous = cloneSettings(this.settings);
    const wasRunning = this.backend.status.state !== "stopped";
    try {
      if (wasRunning) await this.backend.stop();
      this.settings.pythonExecutable = installed.pythonExecutable;
      this.draftSettings.pythonExecutable = installed.pythonExecutable;
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        await this.backend.call("rebuild_vectors", {}, 3_600_000);
      }
      await this.saveSettings();
    } catch (error) {
      await this.backend.stop().catch(() => undefined);
      this.settings = previous;
      this.syncDraftTo(previous);
      await this.saveSettings();
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    }
    new Notice("CUDA 런타임 설치와 적용을 완료했습니다.", 10000);
    this.settingTab?.display();
  }

  async startLazyBackend(): Promise<void> {
    await this.ensureSanitizedConfig();
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(true);
    await this.backend.waitUntilAvailable();
    this.settingTab?.display();
  }

  async ensureSearchStarted(): Promise<void> {
    await this.ensureSanitizedConfig();
    if (
      this.backend.status.state === "stopped" ||
      this.backend.status.state === "error"
    ) {
      await this.prepareRuntime(this.settings, false);
    }
    await this.backend.ensureStarted();
  }

  async provisionOnnx(): Promise<void> {
    await this.ensureSanitizedConfig();
    if (this.backend.status.state === "stopped") {
      await this.prepareRuntime(this.settings, false);
      await this.backend.start(false);
      try {
        await this.backend.waitUntilAvailable();
      } catch {
        /* sidecar may be in error state until the derived graph exists */
      }
    }
    const result = await this.backend.call<{
      provisioned: boolean;
      path?: string;
    }>("provision_onnx", {}, 600_000);
    if (!result.provisioned) throw new Error("ONNX 파생 모델 생성 실패");
    new Notice("ONNX 파생 모델을 생성했습니다. 서비스를 재시작합니다.", 8000);
    await this.restartBackend();
  }

  async provisionBackend(): Promise<void> {
    await this.ensureSanitizedConfig();
    await this.backend.stop();
    await this.backend.ensureBackendProvisioned({ force: true });
    await this.refreshBackendInstall();
    new Notice("Python 백엔드를 설치했습니다. 서비스를 재시작합니다.", 8000);
    await this.restartBackend();
  }

  async stopBackend(): Promise<void> {
    this.startupPrepared = false;
    await this.backend.stop();
    this.settingTab?.display();
  }
  async restartBackend(): Promise<void> {
    this.startupPrepared = false;
    await this.ensureSanitizedConfig();
    await this.prepareRuntime(this.settings, false);
    await this.backend.restart();
    await this.completeStartup();
    this.settingTab?.display();
    new Notice("Vault Search Service를 재시작했습니다.");
  }

  async previewScope(): Promise<{ count: number; sample: string[] }> {
    await this.ensureSearchStarted();
    return this.backend.call("preview_scope", {}, 120_000);
  }

  async reconcile(mode: "fast" | "strict" = "strict"): Promise<void> {
    await this.ensureSearchStarted();
    const result = await this.backend.call<Record<string, unknown>>(
      "reconcile",
      { mode },
      600_000,
    );
    new Notice(
      result.rebuild_required
        ? `재구축 필요: ${result.reason}`
        : "인덱스 증분 대조를 완료했습니다.",
      8000,
    );
    this.settingTab?.display();
  }

  async rebuildAll(): Promise<void> {
    await this.ensureSearchStarted();
    new Notice("전체 인덱스 재구축을 시작합니다. 백그라운드에서 진행됩니다.");
    void this.backend
      .call<{ files: number; chunks: number }>("rebuild_all", {}, 3_600_000)
      .then((result) => {
        new Notice(
          `전체 재구축 완료: 파일 ${result.files}개, 청크 ${result.chunks}개`,
          10000,
        );
        this.settingTab?.display();
      })
      .catch(
        (error) =>
          new Notice(
            `Vault Search 재구축 실패: ${this.errorMessage(error)}`,
            10000,
          ),
      );
  }

  async rebuildVectors(): Promise<void> {
    await this.ensureSearchStarted();
    new Notice("벡터 인덱스 재구축을 시작합니다.");
    const result = await this.backend.call<{ chunks: number }>(
      "rebuild_vectors",
      {},
      3_600_000,
    );
    new Notice(`벡터 재구축 완료: 청크 ${result.chunks}개`, 10000);
    this.settingTab?.display();
  }

  /** Clamp the agent-extension settings to their protocol bounds so a
   *  hand-edited data.json can never produce an invalid sidecar config. */
  private normalizeAgentSettings(failedServerIds?: Set<string>): void {
    const s = this.settings;
    s.answerProjectRules = String(s.answerProjectRules || "").slice(0, 32_000);
    if (s.answerProjectRulesSource !== "agents-md")
      s.answerProjectRulesSource = "custom";
    s.mcpEnabled = Boolean(s.mcpEnabled);
    s.mcpServers = (Array.isArray(s.mcpServers) ? s.mcpServers : []).slice(
      0,
      20,
    );
    for (const server of s.mcpServers) {
      server.id = String(server.id || "").slice(0, 64);
      server.name = String(server.name || "").slice(0, 64);
      server.command = String(server.command || "");
      server.args = (Array.isArray(server.args) ? server.args : [])
        .map((arg) => String(arg))
        .slice(0, 64);
      server.envNames = (Array.isArray(server.envNames) ? server.envNames : [])
        .map((name) => String(name))
        .slice(0, 32);
      server.cwd = String(server.cwd || "vault");
      server.transport = server.transport === "http" ? "http" : "stdio";
      if (server.transport === "http") {
        if (failedServerIds && failedServerIds.has(server.id)) {
          // Failed migration: preserve raw URL for recovery/retry, keep disabled
          server.url = String(server.url || "");
          server.enabled = false;
        } else {
          server.url = toSafeOrigin(server.url);
        }
      } else {
        server.url = "";
      }
      server.enabled = server.enabled !== false;
      const policies: Record<string, McpToolPolicy> = {};
      for (const [tool, policy] of Object.entries(server.toolPolicies || {})) {
        if (policy === "deny" || policy === "ask" || policy === "allow") {
          policies[tool] = policy;
        }
      }
      server.toolPolicies = policies;
    }
    s.skillsEnabled = Boolean(s.skillsEnabled);
    s.skillRoots = (Array.isArray(s.skillRoots) ? s.skillRoots : []).slice(
      0,
      20,
    );
    for (const root of s.skillRoots) {
      root.id = String(root.id || "").slice(0, 64);
      root.path = String(root.path || "");
      root.enabled = root.enabled !== false;
    }
    s.enabledSkills = (Array.isArray(s.enabledSkills) ? s.enabledSkills : [])
      .map((id) => String(id))
      .slice(0, 1000);
  }

  // -------------------------------------------------------------------------
  // API agent extensions: project rules / MCP / skills
  // -------------------------------------------------------------------------

  /** Snapshot-import the vault-root AGENTS.md into the project rules draft.
   *  Deliberately a snapshot: later file edits never auto-apply (plan §7.1). */
  async importAgentsMd(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath("AGENTS.md");
    if (!(file instanceof TFile)) {
      throw new Error("볼트 루트에 AGENTS.md 파일이 없습니다.");
    }
    const content = await this.app.vault.read(file);
    if (!content.trim()) {
      throw new Error("AGENTS.md가 비어 있습니다.");
    }
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    this.draftSettings.answerProjectRules = content.slice(0, 32_000);
    this.draftSettings.answerProjectRulesSource = "agents-md";
    this.draftSettings.answerProjectRulesImportedAt = new Date().toISOString();
    this.draftSettings.answerProjectRulesHash = hash.slice(0, 12);
    new Notice("AGENTS.md 내용을 가져왔습니다. 설정 적용 후 저장됩니다.", 6000);
  }

  clearProjectRules(): void {
    this.draftSettings.answerProjectRules = "";
    this.draftSettings.answerProjectRulesSource = "custom";
    this.draftSettings.answerProjectRulesImportedAt = undefined;
    this.draftSettings.answerProjectRulesHash = undefined;
  }

  /** Open the Smart-Composer-style editor modal. Without an id this edits a
   *  fresh draft entry that is only committed to the settings list on save;
   *  cancelling a brand-new entry also purges any env values saved while
   *  filling the form so nothing orphaned survives (plan §12.3). */
  openMcpServerEditor(serverId?: string): void {
    const existing = (this.draftSettings.mcpServers || []).find(
      (server) => server.id === serverId,
    );
    const working = existing
      ? {
          ...existing,
          args: [...existing.args],
          envNames: [...existing.envNames],
          toolPolicies: { ...existing.toolPolicies },
        }
      : {
          id: randomUUID(),
          name: `서버 ${(this.draftSettings.mcpServers || []).length + 1}`,
          enabled: true,
          transport: "stdio" as const,
          command: "",
          args: [],
          cwd: "vault",
          url: "",
          envNames: [],
          toolPolicies: {},
        };
    const coordinator = new McpTransactionCoordinator(this);
    new McpServerEditorModal(this, working, {
      hasEnvValue: (name) => this.hasMcpEnvValue(working.id, name),
      hasHttpUrl: () => this.hasMcpHttpUrl(working.id, working.url),
      onSave: (savedWorking, staged) =>
        coordinator.saveServer(savedWorking, staged),
      onCancelledNew: () => {
        deleteServerSecrets(this.app, working);
      },
    }).open();
  }

  /** Remove a server in an atomic transaction via the coordinator. */
  async deleteMcpServer(serverId: string): Promise<void> {
    const coordinator = new McpTransactionCoordinator(this);
    await coordinator.deleteServer(serverId);
  }

  async saveMcpEnvValue(
    serverId: string,
    envName: string,
    value: string,
  ): Promise<void> {
    setMcpSecret(this.app, serverId, envName, value);
    // Live rotation: push the fresh snapshot so a connected server picks up
    // the new value without waiting for a settings-triggered restart. The
    // sidecar reconnects only the server whose values changed.
    await this.backend.sendMcpSecrets().catch(() => undefined);
  }

  /** Delete one env value from secret storage and drop it from the sidecar's
   *  in-memory snapshot immediately (fix §5). */
  async removeMcpEnvValue(serverId: string, envName: string): Promise<void> {
    deleteMcpSecret(this.app, serverId, envName);
    await this.backend.sendMcpSecrets().catch(() => undefined);
  }

  /** Best-effort snapshot push after any secret lifecycle change. */
  private async notifyMcpSecretsChanged(): Promise<void> {
    try {
      await this.backend.sendMcpSecrets();
    } catch {
      /* the next start pushes the snapshot anyway */
    }
  }

  hasMcpEnvValue(serverId: string, envName: string): boolean {
    return hasMcpEnvSecret(this.app, serverId, envName);
  }

  hasMcpHttpUrl(serverId: string, expectedServerUrl?: string): boolean {
    return hasMcpHttpUrl(this.app, serverId, expectedServerUrl);
  }

  async refreshMcpStatus(): Promise<McpStatusResponse> {
    return this.backend.call<McpStatusResponse>("mcp_status", {}, 15_000);
  }

  async refreshMcpTools(): Promise<McpStatusResponse> {
    return this.backend.call<McpStatusResponse>("mcp_refresh", {}, 60_000);
  }

  async refreshSkillsStatus(): Promise<SkillsStatusResponse> {
    return this.backend.call<SkillsStatusResponse>("skills_status", {}, 30_000);
  }

  async rescanSkills(): Promise<SkillsStatusResponse> {
    return this.backend.call<SkillsStatusResponse>(
      "skills_refresh",
      {},
      60_000,
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-search",
      name: "Open search",
      callback: () => this.openSearch(),
    });
    this.addCommand({
      id: "open-ai-search",
      name: "Open AI Vault Search",
      callback: () => void this.openAiSearchPanel(),
    });
    this.addCommand({
      id: "ai-vault-search-sample-render",
      name: "AI Vault Search: 목록 렌더링 샘플 미리보기",
      callback: () => void this.renderSampleAnswer(),
    });
    this.addCommand({
      id: "search-selected-text",
      name: "Search selected text",
      editorCallback: (editor) => this.openSearch(selectedTextQuery(editor)),
    });
    this.addCommand({
      id: "start-service",
      name: "Start search service",
      callback: () => void this.startBackend(),
    });
    this.addCommand({
      id: "stop-service",
      name: "Stop search service",
      callback: () => void this.stopBackend(),
    });
    this.addCommand({
      id: "restart-service",
      name: "Restart search service",
      callback: () => void this.restartBackend(),
    });
    this.addCommand({
      id: "reconcile-index",
      name: "Reconcile search index",
      callback: () => void this.reconcile(),
    });
    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild complete search index",
      callback: () => void this.rebuildAll(),
    });
    this.addCommand({
      id: "rebuild-vectors",
      name: "Rebuild vector index",
      callback: () => void this.rebuildVectors(),
    });
    this.addCommand({
      id: "install-agent-integration",
      name: "Install agent integration (AGENTS.md + wrapper + skill)",
      callback: () => {
        void this.runAgentIntegrationInstall()
          .then((result) => {
            new Notice(agentIntegrationNotice(result), 8000);
            this.settingTab?.display();
          })
          .catch(
            (error) =>
              new Notice(
                `Vault Search 오류: ${this.errorMessage(error)}`,
                8000,
              ),
          );
      },
    });
  }

  async refreshAgentIntegration(): Promise<void> {
    this.agentIntegration = await agentIntegrationStatus(
      this.backend.vaultPath,
      this.backend.pluginDir,
    );
    if (this._unloaded) return;
    this.settingTab?.display();
  }

  async runAgentIntegrationInstall(): Promise<AgentIntegrationResult> {
    const result = await installAgentIntegration(
      this.backend.vaultPath,
      this.backend.pluginDir,
    );
    await this.refreshAgentIntegration();
    return result;
  }

  private async prepareRuntime(
    target: VaultSearchSettings,
    interactive: boolean,
  ): Promise<void> {
    // Ensure the plugin-side backend matches the manifest before inspecting it:
    // inspectPython resolves vault_search via the backend folder, so a stale
    // (or not-yet-provisioned) folder would be read and every runtime rejected.
    await this.backend.ensureBackendProvisioned();
    const cpu = await this.backend.managedRuntime("cpu");
    const cuda = await this.backend.managedRuntime("cuda");
    // Auto mode (empty or "python"): prefer a managed venv runtime so a
    // machine.json drift to an arbitrary system python is ignored; fall back
    // to the PATH python when no managed runtime exists yet. An explicit path
    // is inspected as-is and used when valid.
    let current: PythonRuntimeInfo | null = null;
    if (isAutoPython(target.pythonExecutable)) {
      current = cuda || cpu;
      if (!current) {
        const system = await this.backend.inspectPython("python");
        if (system) current = system;
      }
    } else {
      current = await this.backend.inspectPython(target.pythonExecutable);
    }
    const choose = (python: string, summary: string) => {
      target.pythonExecutable = python;
      this.runtimeSummary = summary;
      this.runtimeWarning = null;
    };
    // Persist the resolved python to machine.json so the selection survives
    // restarts. Without this, every vault open re-derives the runtime from the
    // machine.json default ("python") and can pick a different python than the
    // previous session, which makes GPU/CPU behavior flip between restarts.
    const persist = () =>
      this.backend.writeMachinePython(target.pythonExecutable);

    const hasGpu = await this.backend.hasNvidiaGpu();
    const selection = selectRuntime(target.device, current, cpu, cuda, hasGpu);
    if (selection.kind === "error") throw new Error(selection.message);
    if (selection.kind === "selected") {
      const selected = selection.runtime;
      choose(
        selected.pythonExecutable,
        selected.cudaAvailable
          ? `런타임: CUDA ${selected.cudaBuild || ""} / ${selected.deviceName || "GPU"}`
          : `런타임: CPU / PyTorch ${selected.torchVersion}`,
      );
      await persist();
      return;
    }
    if (selection.kind === "cpu-fallback" && !interactive) {
      target.pythonExecutable = selection.runtime.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selection.runtime.torchVersion}`;
      this.runtimeWarning = selection.warning;
      await persist();
      return;
    }

    const install =
      interactive &&
      (await confirmRuntimeInstall(this.app, target.device === "cuda"));
    if (!install) {
      if (target.device === "cuda")
        throw new Error(
          interactive
            ? "CUDA 런타임 설치가 취소되어 설정을 적용하지 않았습니다."
            : "CUDA 런타임이 없습니다. 설정에서 CUDA 런타임을 먼저 설치해 주세요.",
        );
      const selected =
        selection.kind === "cpu-fallback" ? selection.runtime : cpu || current;
      if (!selected) throw new Error("사용 가능한 CPU 검색 런타임이 없습니다.");
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning =
        "NVIDIA GPU가 감지됐지만 CUDA 런타임이 설치되지 않아 CPU를 사용합니다.";
      await persist();
      return;
    }

    const basePython =
      current?.baseExecutable || cpu?.baseExecutable || "python";
    try {
      new Notice(
        "CUDA 런타임을 설치하고 있습니다. 수 분 이상 걸릴 수 있습니다.",
        10000,
      );
      const installed = await this.backend.installManagedRuntime(
        "cuda",
        basePython,
        (text) => {
          if (text)
            this.runtimeSummary = `CUDA 설치 중: ${text.split(/\r?\n/).at(-1)}`;
        },
      );
      choose(
        installed.pythonExecutable,
        `런타임: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`,
      );
    } catch (error) {
      if (target.device === "cuda") throw error;
      const selected = cpu || current;
      if (!selected) throw error;
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = `CUDA 런타임 설치 실패로 CPU를 사용합니다: ${this.errorMessage(error)}`;
    }
    await persist();
  }

  private handleStatus(status: BackendStatus): void {
    // Update only the settings-tab status line in place — a full display()
    // re-render resets the scroll position and steals focus while the user
    // edits settings.
    this.settingTab?.updateBackendStatus(status);
    this.searchModal?.updateBackendStatus(status);
    for (const view of this.aiSearchViews) view.updateBackendStatus(status);
    if (status.state === "ready" || status.state === "ready_no_index") {
      if (this.startupPrepared) void this.queue?.flush();
      else void this.completeStartup();
    }
  }

  private async completeStartup(): Promise<void> {
    if (this.startupPrepared || this.startupInProgress || !this.isReady())
      return;
    this.startupInProgress = true;
    try {
      this.queue?.clear();
      if (this.settings.startupReconcile) {
        const result = await this.backend.call<Record<string, unknown>>(
          "reconcile",
          { mode: "fast" },
          600_000,
        );
        if (result.rebuild_required) {
          const status = this.backend.status;
          const action =
            status.recommended_action === "rebuild_vectors"
              ? "벡터 재구축"
              : "전체 재구축";
          new Notice(
            `Vault Search 인덱스에 호환성 문제가 있습니다. 설정에서 ${action}을 실행하세요.`,
            8000,
          );
        }
      }
      this.startupPrepared = true;
    } finally {
      this.startupInProgress = false;
    }
    await this.queue?.flush();
  }

  private isReady(): boolean {
    const state = this.backend.status.state;
    return state === "ready" || state === "ready_no_index";
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  openSearch(initialQuery = ""): void {
    this.searchModal?.close();
    this.searchModal = new VaultSearchModal(this, initialQuery);
    this.searchModal.open();
  }

  async openSearchResult(
    location: SearchResultLocation,
    keepPanel = false,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(location.path);
    if (!(file instanceof TFile)) {
      new Notice(`파일을 찾을 수 없습니다: ${location.path}`);
      return;
    }
    await this.app.workspace.getLeaf(keepPanel ? "tab" : false).openFile(file, {
      active: true,
      eState: { line: location.line - 1 },
    });
    if (!keepPanel) this.searchModal?.close();
  }

  async openAiSearchPanel(initialQuery = ""): Promise<void> {
    const leaf =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_AI_SEARCH)[0] ??
      this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("AI Vault Search 패널을 열 수 없습니다.");
      return;
    }
    const currentState = leaf.getViewState();
    await leaf.setViewState({
      type: VIEW_TYPE_VAULT_AI_SEARCH,
      active: true,
      state: {
        ...(currentState.state || {}),
        ...(initialQuery ? { query: initialQuery } : {}),
      },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  registerAiView(view: VaultSearchItemView): void {
    this.aiSearchViews.add(view);
  }

  /** Command handler for "목록 렌더링 샘플 미리보기": open the panel and
   *  render the fixed sample so list rendering can be checked without the
   *  model (answers vary per question, so a fixed sample is the only way to
   *  reproduce a rendering case). */
  private async renderSampleAnswer(): Promise<void> {
    await this.openAiSearchPanel();
    const view = [...this.aiSearchViews][0];
    if (!view) {
      new Notice("AI Vault Search 패널을 먼저 열어 주세요.");
      return;
    }
    view.renderSample();
  }

  unregisterAiView(view: VaultSearchItemView): void {
    this.aiSearchViews.delete(view);
  }

  openSearchSettings(): void {
    const setting = (
      this.app as typeof this.app & {
        setting: { open(): void; openTabById(id: string): void };
      }
    ).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  searchModalClosed(modal: VaultSearchModal): void {
    if (this.searchModal === modal) this.searchModal = null;
  }
}
