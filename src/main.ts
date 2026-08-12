import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import * as path from "path";
import { BackendManager } from "./backend-manager";
import { DEFAULT_SETTINGS } from "./constants";
import { VaultSearchSettingTab } from "./settings-tab";
import { cloneSettings, hotConfig, settingsImpact } from "./settings";
import type { BackendStatus, VaultSearchSettings } from "./types";
import { VaultEventQueue } from "./vault-event-queue";
import { VaultSearchModal } from "./search-modal";
import type { SearchResultLocation } from "./search-result-view";
import { selectedTextQuery } from "./search-session";

export default class VaultSearchPlugin extends Plugin {
  declare settings: VaultSearchSettings;
  draftSettings!: VaultSearchSettings;
  backend!: BackendManager;
  private queue!: VaultEventQueue;
  private settingTab!: VaultSearchSettingTab;
  private startupPrepared = false;
  private startupInProgress = false;
  private searchModal: VaultSearchModal | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Vault Search Service는 데스크톱 파일시스템 볼트만 지원합니다.");
      return;
    }
    const vaultPath = adapter.getBasePath();
    const pluginDir = path.join(vaultPath, this.app.vault.configDir, "plugins", this.manifest.id);
    this.backend = new BackendManager(vaultPath, pluginDir, () => this.settings,
      status => this.handleStatus(status));
    const machinePython = await this.backend.readMachinePython();
    if (machinePython) this.settings.pythonExecutable = machinePython;
    else await this.backend.writeMachinePython(this.settings.pythonExecutable);
    this.draftSettings = cloneSettings(this.settings);
    this.queue = new VaultEventQueue(() => this.settings.syncDebounceMs,
      async (changed, deleted) => {
        if (!this.settings.autoSync) return true;
        if (!this.isReady()) return false;
        await this.backend.call("sync_paths", { changed, deleted }, 120_000);
        return true;
      });

    this.registerEvent(this.app.vault.on("create", file => {
      if (file instanceof TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file instanceof TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (file instanceof TFile) this.queue.markDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        this.queue.markDeleted(oldPath);
        this.queue.markChanged(file.path);
      }
    }));

    this.settingTab = new VaultSearchSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.loadPolicy === "vault-open") {
        void this.startBackend().catch(error =>
          new Notice(`Vault Search 시작 실패: ${this.errorMessage(error)}`, 10000));
      } else if (this.settings.loadPolicy === "first-search") {
        void this.startLazyBackend().catch(error =>
          new Notice(`Vault Search 대기 서비스 시작 실패: ${this.errorMessage(error)}`, 10000));
      }
    });
  }

  onunload(): void {
    this.queue?.clear();
    if (this.backend) void this.backend.stop();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Partial<VaultSearchSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded || {}) };
    this.settings.includeGlobs = loaded?.includeGlobs || [...DEFAULT_SETTINGS.includeGlobs];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [...DEFAULT_SETTINGS.excludeGlobs];
    this.draftSettings = cloneSettings(this.settings);
  }

  async saveSettings(): Promise<void> {
    const { pythonExecutable, ...portable } = this.settings;
    await this.saveData(portable);
    if (this.backend) await this.backend.writeMachinePython(pythonExecutable);
  }

  resetDraftSettings(): void {
    this.draftSettings = cloneSettings(this.settings);
    this.settingTab?.display();
  }

  async applyDraftSettings(): Promise<void> {
    const previous = cloneSettings(this.settings);
    const next = cloneSettings(this.draftSettings);
    const impact = settingsImpact(previous, next);
    if (impact === "none") return;
    const previousWasRunning = this.backend.status.state !== "stopped";

    try {
      if (impact === "all" || impact === "vectors" || impact === "restart") {
        await this.backend.stop();
        this.settings = next;
        await this.saveSettings();
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        if (impact === "all") await this.backend.call("rebuild_all", {}, 3_600_000);
        if (impact === "vectors") await this.backend.call("rebuild_vectors", {}, 3_600_000);
        if (!previousWasRunning && this.settings.loadPolicy === "manual") await this.backend.stop();
      } else {
        this.settings = next;
        await this.saveSettings();
        if (this.isReady()) {
          await this.backend.call("apply_search_config", hotConfig(next));
          if (impact === "scope") await this.backend.call("reconcile", { mode: "fast" }, 600_000);
        }
      }
      this.draftSettings = cloneSettings(this.settings);
      new Notice(impact === "all" ? "설정을 적용하고 전체 인덱스를 재구축했습니다."
        : impact === "vectors" ? "설정을 적용하고 벡터 인덱스를 재구축했습니다."
        : "Vault Search 설정을 적용했습니다.");
    } catch (error) {
      await this.backend.stop().catch(() => undefined);
      this.settings = previous;
      this.draftSettings = cloneSettings(previous);
      await this.saveSettings();
      if (previousWasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    } finally {
      this.settingTab?.display();
    }
  }

  async startBackend(): Promise<void> {
    await this.backend.start(false);
    await this.backend.waitUntilReady();
    await this.completeStartup();
    this.settingTab?.display();
  }

  async startLazyBackend(): Promise<void> {
    await this.backend.start(true);
    await this.backend.waitUntilAvailable();
    this.settingTab?.display();
  }

  async stopBackend(): Promise<void> {
    this.startupPrepared = false;
    await this.backend.stop();
    this.settingTab?.display();
  }

  async restartBackend(): Promise<void> {
    this.startupPrepared = false;
    await this.backend.restart();
    await this.completeStartup();
    this.settingTab?.display();
    new Notice("Vault Search Service를 재시작했습니다.");
  }

  async previewScope(): Promise<{ count: number; sample: string[] }> {
    await this.backend.ensureStarted();
    return this.backend.call("preview_scope", {}, 120_000);
  }

  async reconcile(mode: "fast" | "strict" = "strict"): Promise<void> {
    await this.backend.ensureStarted();
    const result = await this.backend.call<Record<string, unknown>>("reconcile", { mode }, 600_000);
    new Notice(result.rebuild_required ? `재구축 필요: ${result.reason}` : "인덱스 증분 대조를 완료했습니다.", 8000);
    this.settingTab?.display();
  }

  async rebuildAll(): Promise<void> {
    await this.backend.ensureStarted();
    new Notice("전체 인덱스 재구축을 시작합니다. 백그라운드에서 진행됩니다.");
    const result = await this.backend.call<{ files: number; chunks: number }>("rebuild_all", {}, 3_600_000);
    new Notice(`전체 재구축 완료: 파일 ${result.files}개, 청크 ${result.chunks}개`, 10000);
    this.settingTab?.display();
  }

  async rebuildVectors(): Promise<void> {
    await this.backend.ensureStarted();
    new Notice("벡터 인덱스 재구축을 시작합니다.");
    const result = await this.backend.call<{ chunks: number }>("rebuild_vectors", {}, 3_600_000);
    new Notice(`벡터 재구축 완료: 청크 ${result.chunks}개`, 10000);
    this.settingTab?.display();
  }

  private registerCommands(): void {
    this.addCommand({ id: "open-search", name: "Open search", callback: () => this.openSearch() });
    this.addCommand({
      id: "search-selected-text",
      name: "Search selected text",
      editorCallback: editor => this.openSearch(selectedTextQuery(editor))
    });
    this.addCommand({ id: "start-service", name: "Start search service", callback: () => void this.startBackend() });
    this.addCommand({ id: "stop-service", name: "Stop search service", callback: () => void this.stopBackend() });
    this.addCommand({ id: "restart-service", name: "Restart search service", callback: () => void this.restartBackend() });
    this.addCommand({ id: "reconcile-index", name: "Reconcile search index", callback: () => void this.reconcile() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild complete search index", callback: () => void this.rebuildAll() });
    this.addCommand({ id: "rebuild-vectors", name: "Rebuild vector index", callback: () => void this.rebuildVectors() });
  }

  private handleStatus(status: BackendStatus): void {
    this.settingTab?.display();
    this.searchModal?.updateBackendStatus(status);
    if (status.state === "ready" || status.state === "ready_no_index") {
      if (this.startupPrepared) void this.queue?.flush();
      else void this.completeStartup();
    }
  }

  private async completeStartup(): Promise<void> {
    if (this.startupPrepared || this.startupInProgress || !this.isReady()) return;
    this.startupInProgress = true;
    try {
      this.queue?.clear();
      if (this.settings.startupReconcile) {
        const result = await this.backend.call<Record<string, unknown>>(
          "reconcile", { mode: "fast" }, 600_000);
        if (result.rebuild_required) {
          new Notice("Vault Search 인덱스가 없습니다. 설정에서 전체 재구축을 실행하세요.", 8000);
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

  async openSearchResult(location: SearchResultLocation): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(location.path);
    if (!(file instanceof TFile)) {
      new Notice(`파일을 찾을 수 없습니다: ${location.path}`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, {
      active: true,
      eState: { line: location.line - 1 }
    });
    this.searchModal?.close();
  }

  openSearchSettings(): void {
    const setting = (this.app as typeof this.app & {
      setting: { open(): void; openTabById(id: string): void };
    }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  searchModalClosed(modal: VaultSearchModal): void {
    if (this.searchModal === modal) this.searchModal = null;
  }
}
