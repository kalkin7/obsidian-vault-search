import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import * as path from "path";
import { BackendManager } from "./backend-manager";
import { DEFAULT_SETTINGS } from "./constants";
import { VaultSearchSettingTab } from "./settings-tab";
import { cloneSettings, defaultLoadPolicy, hotConfig, migrateSettings, settingsImpact } from "./settings";
import type { BackendStatus, VaultSearchSettings } from "./types";
import { VaultEventQueue } from "./vault-event-queue";
import { VaultSearchModal } from "./search-modal";
import type { SearchResultLocation } from "./search-result-view";
import { selectedTextQuery } from "./search-session";
import { confirmRuntimeInstall } from "./runtime-install-modal";
import { selectRuntime } from "./runtime-selection";

export default class VaultSearchPlugin extends Plugin {
  declare settings: VaultSearchSettings;
  draftSettings!: VaultSearchSettings;
  backend!: BackendManager;
  private queue!: VaultEventQueue;
  private settingTab!: VaultSearchSettingTab;
  private startupPrepared = false;
  private startupInProgress = false;
  private searchModal: VaultSearchModal | null = null;
  private runtimeChangePromise: Promise<void> | null = null;
  runtimeSummary = "런타임: 확인 전";
  runtimeWarning: string | null = null;

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
      status => this.handleStatus(status), this.manifest.version);
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
    // Plugin unload must not kill a standalone daemon started by the CLI; it
    // only detaches from it (heartbeat stops, process survives).
    if (this.backend) void this.backend.stop(true);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Partial<VaultSearchSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded || {}) };
    this.settings.includeGlobs = loaded?.includeGlobs || [...DEFAULT_SETTINGS.includeGlobs];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [...DEFAULT_SETTINGS.excludeGlobs];
    const migrated = migrateSettings(this.settings);
    if (loaded?.loadPolicy === undefined) {
      this.settings.loadPolicy = defaultLoadPolicy(this.settings.engine);
    }
    this.draftSettings = cloneSettings(this.settings);
    if (migrated || loaded?.loadPolicy === undefined) {
      await this.saveSettings();
    }
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
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.applyDraftSettingsInternal();
    try { await this.runtimeChangePromise; }
    finally { this.runtimeChangePromise = null; }
  }

  private async applyDraftSettingsInternal(): Promise<void> {
    const previous = cloneSettings(this.settings);
    const next = cloneSettings(this.draftSettings);
    const impact = settingsImpact(previous, next);
    if (impact === "none") return;
    if (previous.device !== next.device || previous.engine !== next.engine ||
        previous.pythonExecutable !== next.pythonExecutable) {
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
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(false);
    await this.backend.waitUntilReady();
    await this.completeStartup();
    this.settingTab?.display();
  }

  async installCudaRuntime(): Promise<void> {
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.installCudaRuntimeInternal();
    try { await this.runtimeChangePromise; }
    finally { this.runtimeChangePromise = null; }
  }

  private async installCudaRuntimeInternal(): Promise<void> {
    if (!await this.backend.hasNvidiaGpu()) {
      throw new Error("NVIDIA GPU 또는 드라이버를 찾을 수 없습니다.");
    }
    if (!await confirmRuntimeInstall(this.app, true)) return;
    const current = await this.backend.inspectPython(this.settings.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    new Notice("CUDA 런타임을 설치하고 있습니다. 수 분 이상 걸릴 수 있습니다.", 10000);
    const installed = await this.backend.installManagedRuntime("cuda", basePython,
      text => { if (text) this.runtimeSummary = `CUDA 설치 중: ${text.split(/\r?\n/).at(-1)}`; });
    this.runtimeSummary = `런타임: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`;
    this.runtimeWarning = null;
    if (this.settings.device === "cpu") {
      const active = current || cpu;
      this.runtimeSummary = active
        ? `런타임: CPU / PyTorch ${active.torchVersion} (CUDA 런타임 설치됨)`
        : "런타임: CPU (CUDA 런타임 설치됨)";
      new Notice("CUDA 런타임을 설치했습니다. 현재 CPU 명시 설정은 유지됩니다.", 10000);
      this.settingTab?.display();
      return;
    }
    const previous = cloneSettings(this.settings);
    const previousDraft = cloneSettings(this.draftSettings);
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
      this.draftSettings = previousDraft;
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
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(true);
    await this.backend.waitUntilAvailable();
    this.settingTab?.display();
  }

  async ensureSearchStarted(): Promise<void> {
    if (this.backend.status.state === "stopped" || this.backend.status.state === "error") {
      await this.prepareRuntime(this.settings, false);
    }
    await this.backend.ensureStarted();
  }

  async provisionOnnx(): Promise<void> {
    if (this.backend.status.state === "stopped") {
      await this.prepareRuntime(this.settings, false);
      await this.backend.start(false);
      try { await this.backend.waitUntilAvailable(); }
      catch { /* sidecar may be in error state until the derived graph exists */ }
    }
    const result = await this.backend.call<{ provisioned: boolean; path?: string }>(
      "provision_onnx", {}, 600_000);
    if (!result.provisioned) throw new Error("ONNX 파생 모델 생성 실패");
    new Notice("ONNX 파생 모델을 생성했습니다. 서비스를 재시작합니다.", 8000);
    await this.restartBackend();
  }

  async provisionBackend(): Promise<void> {
    await this.backend.stop();
    await this.backend.ensureBackendProvisioned({ force: true });
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
    const result = await this.backend.call<Record<string, unknown>>("reconcile", { mode }, 600_000);
    new Notice(result.rebuild_required ? `재구축 필요: ${result.reason}` : "인덱스 증분 대조를 완료했습니다.", 8000);
    this.settingTab?.display();
  }

  async rebuildAll(): Promise<void> {
    await this.ensureSearchStarted();
    new Notice("전체 인덱스 재구축을 시작합니다. 백그라운드에서 진행됩니다.");
    const result = await this.backend.call<{ files: number; chunks: number }>("rebuild_all", {}, 3_600_000);
    new Notice(`전체 재구축 완료: 파일 ${result.files}개, 청크 ${result.chunks}개`, 10000);
    this.settingTab?.display();
  }

  async rebuildVectors(): Promise<void> {
    await this.ensureSearchStarted();
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

  private async prepareRuntime(target: VaultSearchSettings, interactive: boolean): Promise<void> {
    const current = await this.backend.inspectPython(target.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const cuda = await this.backend.managedRuntime("cuda");
    const choose = (python: string, summary: string) => {
      target.pythonExecutable = python;
      this.runtimeSummary = summary;
      this.runtimeWarning = null;
    };

    const hasGpu = await this.backend.hasNvidiaGpu();
    const selection = selectRuntime(target.device, current, cpu, cuda, hasGpu);
    if (selection.kind === "error") throw new Error(selection.message);
    if (selection.kind === "selected") {
      const selected = selection.runtime;
      choose(selected.pythonExecutable, selected.cudaAvailable
        ? `런타임: CUDA ${selected.cudaBuild || ""} / ${selected.deviceName || "GPU"}`
        : `런타임: CPU / PyTorch ${selected.torchVersion}`);
      return;
    }
    if (selection.kind === "cpu-fallback" && !interactive) {
      target.pythonExecutable = selection.runtime.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selection.runtime.torchVersion}`;
      this.runtimeWarning = selection.warning;
      return;
    }

    const install = interactive && await confirmRuntimeInstall(this.app, target.device === "cuda");
    if (!install) {
      if (target.device === "cuda") throw new Error(interactive
        ? "CUDA 런타임 설치가 취소되어 설정을 적용하지 않았습니다."
        : "CUDA 런타임이 없습니다. 설정에서 CUDA 런타임을 먼저 설치해 주세요.");
      const selected = selection.kind === "cpu-fallback" ? selection.runtime : cpu || current;
      if (!selected) throw new Error("사용 가능한 CPU 검색 런타임이 없습니다.");
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = "NVIDIA GPU가 감지됐지만 CUDA 런타임이 설치되지 않아 CPU를 사용합니다.";
      return;
    }

    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    try {
      new Notice("CUDA 런타임을 설치하고 있습니다. 수 분 이상 걸릴 수 있습니다.", 10000);
      const installed = await this.backend.installManagedRuntime("cuda", basePython,
        text => { if (text) this.runtimeSummary = `CUDA 설치 중: ${text.split(/\r?\n/).at(-1)}`; });
      choose(installed.pythonExecutable,
        `런타임: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`);
    } catch (error) {
      if (target.device === "cuda") throw error;
      const selected = cpu || current;
      if (!selected) throw error;
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `런타임: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = `CUDA 런타임 설치 실패로 CPU를 사용합니다: ${this.errorMessage(error)}`;
    }
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
          const status = this.backend.status;
          const action = status.recommended_action === "rebuild_vectors" ? "벡터 재구축" : "전체 재구축";
          new Notice(`Vault Search 인덱스에 호환성 문제가 있습니다. 설정에서 ${action}을 실행하세요.`, 8000);
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
