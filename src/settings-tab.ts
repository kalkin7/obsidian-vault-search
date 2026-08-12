import { Notice, PluginSettingTab, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import { MODEL_PROFILES } from "./constants";
import { settingsImpact } from "./settings";

export class VaultSearchSettingTab extends PluginSettingTab {
  constructor(private readonly owner: VaultSearchPlugin) {
    super(owner.app, owner);
  }

  display(): void {
    const { containerEl } = this;
    const draft = this.owner.draftSettings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Search Service" });
    const status = this.owner.backend?.status || { state: "stopped" as const };
    const statusEl = containerEl.createDiv({ cls: "vault-search-status" });
    statusEl.setText([
      `상태: ${status.state}`,
      status.model_id ? `모델: ${status.model_id}` : "",
      status.device ? `디바이스: ${status.device}` : "",
      status.pid ? `PID: ${status.pid} / 포트: ${status.port}` : "",
      status.count_available === false ? "인덱스 개수: 확인 불가" :
        status.files !== undefined ? `인덱스: 파일 ${status.files}개 / 청크 ${status.chunks ?? 0}개` : "",
      status.model_load_seconds !== undefined ? `최근 모델 로딩: ${status.model_load_seconds}초` : "",
      status.progress ? `진행: ${status.progress}` : "",
      status.pending_recovery_required ? `복구 재시도 필요: ${status.pending_recovery_warning || "pending path journal"}` : "",
      status.error ? `오류: ${status.error}` : ""
      , this.owner.runtimeSummary
      , this.owner.runtimeWarning || ""
    ].filter(Boolean).join("\n"));
    if (status.error) statusEl.addClass("vault-search-error");

    const impact = settingsImpact(this.owner.settings, draft);
    new Setting(containerEl)
      .setName("서비스 제어 및 설정 적용")
      .setDesc(`모델은 이 볼트에서만 상주합니다. 대기 중인 설정 영향: ${impact}`)
      .addButton(button => button.setButtonText("시작").onClick(async () => {
        try { await this.owner.startBackend(); } catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("중지").onClick(async () => {
        try { await this.owner.stopBackend(); } catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("설정 적용").setCta().onClick(async () => {
        try { await this.owner.applyDraftSettings(); } catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("변경 취소").onClick(() => this.owner.resetDraftSettings()));

    new Setting(containerEl).setName("시작 정책").addDropdown(dropdown => dropdown
      .addOption("vault-open", "볼트를 열 때 모델 로드")
      .addOption("first-search", "첫 검색 때 모델 로드")
      .addOption("manual", "수동 시작")
      .setValue(draft.loadPolicy)
      .onChange(value => { draft.loadPolicy = value as typeof draft.loadPolicy; this.display(); }));

    new Setting(containerEl).setName("유휴 모델 언로드 (초)")
      .setDesc("0이면 비활성(로드 후 상주). 검색이 없으면 이 시간 후 모델을 언로드해 RAM/VRAM을 반환하고, 다음 검색 시 다시 로드합니다. ONNX 엔진에 권장됩니다.")
      .addText(text => text.setValue(String(draft.modelIdleTimeoutSeconds)).onChange(value => {
        draft.modelIdleTimeoutSeconds = this.nonnegativeNumber(value, draft.modelIdleTimeoutSeconds);
      }));

    new Setting(containerEl).setName("Python 실행 파일")
      .setDesc("전용 venv의 python.exe를 권장합니다.")
      .addText(text => text.setValue(draft.pythonExecutable).setPlaceholder("python")
        .onChange(value => { draft.pythonExecutable = value.trim() || "python"; }));

    new Setting(containerEl).setName("임베딩 모델").addDropdown(dropdown => {
      for (const [id, profile] of Object.entries(MODEL_PROFILES)) dropdown.addOption(id, profile.name);
      dropdown.setValue(draft.modelProfile).onChange(id => {
        const profile = MODEL_PROFILES[id];
        draft.modelProfile = id;
        if (id !== "custom" && profile) {
          draft.modelId = profile.modelId;
          draft.queryPrefix = profile.queryPrefix;
          draft.documentPrefix = profile.documentPrefix;
        }
        this.display();
      });
    });

    new Setting(containerEl).setName("모델 ID")
      .setDesc(MODEL_PROFILES[draft.modelProfile]?.note || "Sentence Transformers 모델 ID")
      .addText(text => text.setValue(draft.modelId).onChange(value => { draft.modelId = value.trim(); }));
    new Setting(containerEl).setName("디바이스")
      .setDesc("자동은 NVIDIA GPU와 검증된 CUDA 런타임이 있으면 GPU를, 아니면 사유를 표시하고 CPU를 사용합니다.")
      .addDropdown(dropdown => dropdown
      .addOption("auto", "자동").addOption("cpu", "CPU").addOption("cuda", "CUDA")
      .setValue(draft.device).onChange(value => { draft.device = value as typeof draft.device; }));
    new Setting(containerEl).setName("임베딩 엔진")
      .setDesc("ONNX는 GPU에서 풀링을 수행해 콜드 시작과 웜 검색이 빠르고 VRAM 반환이 가능하지만, 벌크 인코딩은 PyTorch보다 느립니다. ONNX는 device=cuda에서만 사용할 수 있습니다.")
      .addDropdown(dropdown => dropdown
        .addOption("pytorch", "PyTorch (기본)")
        .addOption("onnx", "ONNX Runtime (CUDA)")
        .setValue(draft.engine).onChange(value => { draft.engine = value as typeof draft.engine; }));
    new Setting(containerEl).setName("CUDA 런타임")
      .setDesc("NVIDIA GPU용 PyTorch를 별도 설치합니다. 수 GB 다운로드와 벡터 재구축으로 수 분 이상 걸릴 수 있습니다.")
      .addButton(button => button.setButtonText("CUDA 런타임 설치").onClick(async () => {
        try { await this.owner.installCudaRuntime(); } catch (error) { this.showError(error); }
      }));
    new Setting(containerEl).setName("임베딩 정규화").addToggle(toggle => toggle
      .setValue(draft.normalizeEmbeddings).onChange(value => { draft.normalizeEmbeddings = value; }));
    new Setting(containerEl).setName("Query prefix").addText(text => text
      .setValue(draft.queryPrefix).onChange(value => { draft.queryPrefix = value; }));
    new Setting(containerEl).setName("Document prefix").addText(text => text
      .setValue(draft.documentPrefix).onChange(value => { draft.documentPrefix = value; }));

    new Setting(containerEl).setName("Include globs").setDesc("볼트 상대 경로, 한 줄에 하나")
      .addTextArea(area => {
        area.setValue(draft.includeGlobs.join("\n")); area.inputEl.rows = 7;
        area.onChange(value => { draft.includeGlobs = this.lines(value); });
      });
    new Setting(containerEl).setName("Exclude globs").setDesc("볼트 상대 경로, 한 줄에 하나")
      .addTextArea(area => {
        area.setValue(draft.excludeGlobs.join("\n")); area.inputEl.rows = 7;
        area.onChange(value => { draft.excludeGlobs = this.lines(value); });
      });

    new Setting(containerEl).setName("인덱스 관리")
      .setDesc("설정 적용 후 범위를 확인하세요. 재구축은 임시 파일 검증 후 원자적으로 교체됩니다.")
      .addButton(button => button.setButtonText("범위 미리보기").onClick(async () => {
        try { const result = await this.owner.previewScope(); new Notice(`검색 대상: ${result.count}개 파일`); }
        catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("정밀 대조").onClick(async () => {
        try { await this.owner.reconcile("strict"); } catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("벡터 재구축").onClick(async () => {
        try { await this.owner.rebuildVectors(); } catch (error) { this.showError(error); }
      }))
      .addButton(button => button.setButtonText("전체 재구축").setWarning().onClick(async () => {
        try { await this.owner.rebuildAll(); } catch (error) { this.showError(error); }
      }));

    new Setting(containerEl).setName("청크 크기 / 오버랩")
      .setDesc("값을 변경하면 전체 인덱스 재구축이 필요합니다.")
      .addText(text => text.setValue(String(draft.chunkChars)).onChange(value => {
        draft.chunkChars = this.positiveNumber(value, draft.chunkChars);
      })).addText(text => text.setValue(String(draft.chunkOverlap)).onChange(value => {
        draft.chunkOverlap = this.nonnegativeNumber(value, draft.chunkOverlap);
      }));
    new Setting(containerEl).setName("청킹 전략")
      .setDesc("Markdown 구조 인식 전략을 포함해 변경 시 전체 인덱스 재구축이 필요합니다.")
      .addDropdown(dropdown => dropdown
        .addOption("paragraph-v1", "문단 기반 (기본값)")
        .addOption("markdown-v2", "Markdown 구조 인식")
        .setValue(draft.chunkingStrategy)
        .onChange(value => {
          draft.chunkingStrategy = value as typeof draft.chunkingStrategy;
          this.display();
        }));
    new Setting(containerEl).setName("BM25 / 벡터 / 최종 후보 / RRF k")
      .setDesc("최종 후보는 16~40개를 권장합니다.")
      .addText(text => text.setValue(String(draft.bm25TopK)).onChange(value => {
        draft.bm25TopK = this.positiveNumber(value, draft.bm25TopK);
      })).addText(text => text.setValue(String(draft.vectorTopK)).onChange(value => {
        draft.vectorTopK = this.positiveNumber(value, draft.vectorTopK);
      })).addText(text => text.setValue(String(draft.finalTopK)).onChange(value => {
        draft.finalTopK = this.positiveNumber(value, draft.finalTopK);
      })).addText(text => text.setValue(String(draft.rrfK)).onChange(value => {
        draft.rrfK = this.positiveNumber(value, draft.rrfK);
      }));
    new Setting(containerEl).setName("검색 다양성 / 제목 가중치")
      .setDesc("파일당 최대 청크 수와 파일명·경로·헤딩 RRF 가중치입니다. 기본값은 1 / 1.0입니다.")
      .addText(text => text.setValue(String(draft.maxChunksPerFile)).onChange(value => {
        draft.maxChunksPerFile = this.positiveNumber(value, draft.maxChunksPerFile);
      })).addText(text => text.setValue(String(draft.titleRrfWeight)).onChange(value => {
        draft.titleRrfWeight = this.nonnegativeNumber(value, draft.titleRrfWeight);
      }));
    new Setting(containerEl).setName("접두사 검색 폴백")
      .setDesc("정확 BM25 결과가 없을 때 토큰 접두사 검색으로 한 번 더 찾습니다.")
      .addToggle(toggle => toggle.setValue(draft.prefixFallback)
        .onChange(value => { draft.prefixFallback = value; }));
    new Setting(containerEl).setName("동기화 debounce (ms)").addText(text => text
      .setValue(String(draft.syncDebounceMs)).onChange(value => {
        draft.syncDebounceMs = this.positiveNumber(value, draft.syncDebounceMs);
      }));
    new Setting(containerEl).setName("자동 증분 동기화").addToggle(toggle => toggle
      .setValue(draft.autoSync).onChange(value => { draft.autoSync = value; }));
    new Setting(containerEl).setName("시작 시 전체 대조").addToggle(toggle => toggle
      .setValue(draft.startupReconcile).onChange(value => { draft.startupReconcile = value; }));
  }

  private lines(value: string): string[] {
    return value.split(/\r?\n/).map(line => line.trim().replace(/\\/g, "/")).filter(Boolean);
  }

  private positiveNumber(value: string, fallback: number): number {
    const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonnegativeNumber(value: string, fallback: number): number {
    const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private showError(error: unknown): void {
    new Notice(`Vault Search 오류: ${error instanceof Error ? error.message : String(error)}`, 8000);
    this.display();
  }
}
