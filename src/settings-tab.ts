import { Notice, PluginSettingTab, Setting } from "obsidian";
import type VaultSearchPlugin from "./main";
import { LLM_PROVIDER_DEFAULTS, MODEL_PROFILES } from "./constants";
import { defaultLoadPolicy, isAutoPython } from "./settings";
import { agentIntegrationNotice } from "./agent-integration";
import type { AgentIntegrationStatus } from "./agent-integration";
import { validateProviderApiKey } from "./llm-secrets";
import type { BackendStatus, LLMProviderId } from "./types";
import { chooseProviderModel } from "./model-catalog";
import { renderApiAgentSettings } from "./api-agent-settings";
import { renderMcpSettings } from "./mcp-settings";
import { renderSkillSettings } from "./skill-settings";

type SettingsTabId = "general" | "answer" | "agent" | "search";

export class VaultSearchSettingTab extends PluginSettingTab {
  private activeTab: SettingsTabId = "general";
  private providerModelSelections: Partial<Record<LLMProviderId, string>> = {};
  private modelSelectionOpSeq = 0;
  private latestModelSelectionOp: Partial<Record<LLMProviderId, number>> = {};
  private favoriteOpSeq = 0;
  private latestFavoriteOp: Record<string, number> = {};
  /** Status line created by display(); updated in place on backend events so
   *  the tab never re-renders (which would reset the scroll position) while
   *  the user is editing settings. */
  private statusEl: HTMLElement | null = null;

  constructor(private readonly owner: VaultSearchPlugin) {
    super(owner.app, owner);
  }

  /** Refresh only the status line (no full re-render). */
  updateBackendStatus(status: BackendStatus): void {
    const el = this.statusEl;
    if (!el || !el.isConnected) return;
    el.setText(this.buildStatusText(status));
    el.toggleClass("vault-search-error", Boolean(status.error));
  }

  private buildStatusText(status: BackendStatus): string {
    return [
      `상태: ${status.state}`,
      status.model_id ? `모델: ${status.model_id}` : "",
      status.device ? `디바이스: ${status.device}` : "",
      this.providerStatusLine(status),
      status.pid ? `PID: ${status.pid} / 포트: ${status.port}` : "",
      status.count_available === false
        ? "인덱스 개수: 확인 불가"
        : status.files === undefined
          ? ""
          : `인덱스: 파일 ${status.files}개 / 청크 ${status.chunks ?? 0}개`,
      status.model_load_seconds === undefined
        ? ""
        : `최근 모델 로딩: ${status.model_load_seconds}초`,
      status.progress ? `진행: ${status.progress}` : "",
      status.pending_recovery_required
        ? `복구 재시도 필요: ${status.pending_recovery_warning || "pending path journal"}`
        : "",
      status.index_rebuild_required
        ? `인덱스 호환성 문제: ${status.recommended_action === "rebuild_vectors" ? "벡터 재구축 필요" : "전체 재구축 필요"}`
        : "",
      status.error ? `오류: ${status.error}` : "",
      this.owner.runtimeSummary,
      this.owner.runtimeWarning || "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  display(): void {
    const { containerEl } = this;
    const draft = this.owner.draftSettings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Search Service" });
    const status = this.owner.backend?.status || { state: "stopped" as const };
    const statusEl = containerEl.createDiv({ cls: "vault-search-status" });
    statusEl.setText(this.buildStatusText(status));
    this.statusEl = statusEl;
    if (status.error) statusEl.addClass("vault-search-error");

    new Setting(containerEl)
      .setName("서비스 제어")
      .setDesc(
        "설정 변경은 입력 후 자동으로 저장·적용됩니다 (약 1초). 모델은 이 볼트에서만 상주합니다.",
      )
      .addButton((button) =>
        button.setButtonText("시작").onClick(async () => {
          try {
            await this.owner.startBackend();
          } catch (error) {
            this.showError(error);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("중지").onClick(async () => {
          try {
            await this.owner.stopBackend();
          } catch (error) {
            this.showError(error);
          }
        }),
      );

    new Setting(containerEl)
      .setName("시작 정책")
      .setDesc(
        "기본값은 엔진에 따라 자동 조정됩니다: ONNX는 첫 검색 시 로드, PyTorch는 볼트 열 때 로드. 여기서 직접 선택하면 그 값이 유지됩니다.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vault-open", "볼트를 열 때 모델 로드")
          .addOption("first-search", "첫 검색 때 모델 로드")
          .addOption("manual", "수동 시작")
          .setValue(draft.loadPolicy)
          .onChange((value) => {
            draft.loadPolicy = value as typeof draft.loadPolicy;
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("유휴 모델 언로드 (초)")
      .setDesc(
        "기본값 300초. 0이면 비활성(로드 후 상주). 검색이 없으면 이 시간 후 모델을 언로드합니다. ONNX 엔진은 ORT 세션을 해제해 VRAM/RAM을 반환하고, 다음 검색 시 다시 로드합니다. PyTorch 엔진은 참조를 해제하되 CUDA 캐시로 VRAM 일부가 남을 수 있습니다.",
      )
      .addText((text) =>
        text
          .setValue(String(draft.modelIdleTimeoutSeconds))
          .onChange((value) => {
            draft.modelIdleTimeoutSeconds = this.nonnegativeNumber(
              value,
              draft.modelIdleTimeoutSeconds,
            );
          }),
      );

    const autoPython = isAutoPython(draft.pythonExecutable);
    new Setting(containerEl)
      .setName("Python 실행 파일")
      .setDesc(
        "비워두면(또는 python) 관리형 런타임(venv)을 자동으로 찾아 설정합니다. 직접 입력하면 그 Python을 사용합니다. " +
          (autoPython ? "현재: 자동 선택" : `현재: ${draft.pythonExecutable}`),
      )
      .addText((text) =>
        text
          .setValue(autoPython ? "" : draft.pythonExecutable)
          .setPlaceholder("자동 (관리형 venv 우선)")
          .onChange((value) => {
            draft.pythonExecutable = value.trim() || "python";
          }),
      );
    const install = this.owner.backendInstall;
    const backendStateText =
      !install.expected
        ? "확인 중…"
        : !install.installed
          ? "미설치"
          : install.version === install.expected
            ? `설치됨 (v${install.version}, 최신)`
            : `설치됨 (v${install.version}) — 플러그인 v${install.expected}와 불일치`;
    new Setting(containerEl)
      .setName("Python 백엔드")
      .setDesc(
        `현재 상태: ${backendStateText}. BRAT 설치는 main.js/manifest/styles.css만 넣으므로, 백엔드는 GitHub 릴리스에서 자동으로 받습니다. 이 버튼으로 다시 받거나 버전을 맞춥니다.`,
      )
      .addButton((button) =>
        button.setButtonText("백엔드 설치/복구").onClick(async () => {
          try {
            await this.owner.provisionBackend();
          } catch (error) {
            this.showError(error);
          }
        }),
      );

    containerEl.createEl("h3", { text: "AI Vault 답변" });
    new Setting(containerEl)
      .setName("답변 provider")
      .setDesc(
        "검색 근거만 provider에 전달합니다. API key는 플러그인에 저장하지 않고 sidecar가 환경변수에서 읽습니다.",
      )
      .addDropdown((dropdown) => {
        for (const [id, provider] of Object.entries(LLM_PROVIDER_DEFAULTS))
          dropdown.addOption(id, provider.name);
        dropdown.setValue(draft.answerProvider).onChange((value) => {
          const previousProvider = draft.answerProvider;
          this.providerModelSelections[previousProvider] = draft.answerModel;
          draft.answerProvider = value as typeof draft.answerProvider;
          // No presumptuous default: only a previously remembered selection
          // (or nothing) carries over when switching providers.
          draft.answerModel = chooseProviderModel(
            this.owner.getProviderModels(draft.answerProvider),
            this.providerModelSelections[draft.answerProvider],
            "",
          );
          this.providerModelSelections[draft.answerProvider] =
            draft.answerModel;
          this.display();
        });
      });
    const answerProvider = LLM_PROVIDER_DEFAULTS[draft.answerProvider];
    const savedApiKey = this.owner.getProviderApiKey(draft.answerProvider);
    let apiKeyInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName(`API 키 (${answerProvider.name})`)
      .setDesc(
        savedApiKey
          ? "Obsidian 보안 저장소에 저장됨. 테스트로 유효성을 확인할 수 있습니다."
          : "Obsidian 보안 저장소에 저장합니다",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(
          savedApiKey
            ? "저장된 키를 교체하려면 입력"
            : `${answerProvider.env} 입력`,
        );
        apiKeyInput = text.inputEl;
        return text;
      })
      .addButton((button) =>
        button.setButtonText("테스트").onClick(async () => {
          const targetProvider = draft.answerProvider;
          const targetProviderInfo = LLM_PROVIDER_DEFAULTS[targetProvider];
          const key = apiKeyInput?.value.trim() || savedApiKey || "";
          if (!key) {
            new Notice("저장된 키가 없습니다.");
            return;
          }
          button.setDisabled(true);
          try {
            const status = await validateProviderApiKey(
              targetProvider,
              key,
            );
            let message: string;
            if (status === "valid") {
              message = `${targetProviderInfo.name} 키가 유효합니다.`;
            } else if (status === "invalid") {
              message = `${targetProviderInfo.name}가 이 키를 거부했습니다. 키를 다시 확인해 주세요.`;
            } else {
              message = `${targetProviderInfo.name} 키 인증을 확인할 수 없습니다 (네트워크/provider 상태). 저장은 가능합니다.`;
            }
            new Notice(message, 8000);
          } catch (error) {
            this.showError(error);
          } finally {
            button.setDisabled(false);
          }
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("저장")
          .setCta()
          .onClick(async () => {
            const targetProvider = draft.answerProvider;
            const targetProviderInfo = LLM_PROVIDER_DEFAULTS[targetProvider];
            const value = apiKeyInput?.value.trim() || "";
            if (!value) {
              new Notice("저장할 API 키를 입력해 주세요.");
              return;
            }
            try {
              await this.owner.saveProviderApiKey(targetProvider, value);
              new Notice(`${targetProviderInfo.name} API 키를 저장했습니다.`);
              this.display();
            } catch (error) {
              this.showError(error);
            }
          }),
      )
      .addButton((button) =>
        button.setButtonText("삭제").onClick(async () => {
          const targetProvider = draft.answerProvider;
          const targetProviderInfo = LLM_PROVIDER_DEFAULTS[targetProvider];
          try {
            await this.owner.saveProviderApiKey(targetProvider, "");
            new Notice(`${targetProviderInfo.name} API 키를 삭제했습니다.`);
            this.display();
          } catch (error) {
            this.showError(error);
          }
        }),
      );
    const fetchedModels = this.owner.getProviderModels(draft.answerProvider);
    let modelOptions = fetchedModels;
    if (draft.answerModel && !modelOptions.includes(draft.answerModel)) {
      // Keep the stored current model visible even when it is not in the
      // fetched list (e.g. a snapshot the dated filter removed), so it can
      // still be selected or favorited.
      modelOptions = [draft.answerModel, ...modelOptions];
    }
    const favorites = Array.isArray(draft.favoriteAnswerModels)
      ? [...draft.favoriteAnswerModels]
      : [];
    const modelSetting = new Setting(containerEl)
      .setName("답변 모델")
      .setDesc(
        fetchedModels.length
          ? `${fetchedModels.length}개 모델을 확인했습니다. 모델을 클릭해 선택하고, ★로 즐겨찾기를 지정하세요. 즐겨찾기 모델은 모든 provider에서 모아져 AI Vault Search 패널의 모델 선택에 표시됩니다.`
          : `먼저 모델 최신화를 눌러 선택지를 가져오세요. 선택하기 전에는 모델이 지정되지 않습니다.`,
      )
      .setClass("vault-search-model-setting");
    const modelList = modelSetting.controlEl.createDiv({
      cls: "vault-search-model-list",
    });
    const renderModelList = () => {
      modelList.empty();
      if (!modelOptions.length) {
        modelList.createEl("div", {
          cls: "vault-search-model-empty",
          text: "선택된 모델이 없습니다. 위 목록에서 모델을 선택하세요.",
        });
      }
      for (const model of modelOptions) {
        const row = modelList.createDiv({ cls: "vault-search-model-row" });
        row.toggleClass("is-selected", model === draft.answerModel);
        const name = row.createEl("button", {
          cls: "vault-search-model-name",
          text: model,
          attr: { type: "button", title: model },
        });
        name.addEventListener("click", async () => {
          name.disabled = true;
          const targetProvider = draft.answerProvider;
          const targetModel = model;
          const prevModel = draft.answerModel;
          const prevSelection = this.providerModelSelections[targetProvider];
          const opId = ++this.modelSelectionOpSeq;
          this.latestModelSelectionOp[targetProvider] = opId;

          draft.answerModel = targetModel;
          this.providerModelSelections[targetProvider] = targetModel;
          renderModelList();
          try {
            await this.owner.setAnswerModel(targetProvider, targetModel, {
              notify: false,
            });
          } catch (error) {
            const isLatest =
              this.latestModelSelectionOp[targetProvider] === opId;
            const matchesDraft =
              draft.answerProvider === targetProvider &&
              draft.answerModel === targetModel;
            const matchesSelection =
              this.providerModelSelections[targetProvider] === targetModel;

            if (isLatest && matchesDraft && matchesSelection) {
              draft.answerModel = prevModel;
              this.providerModelSelections[targetProvider] = prevSelection;
              renderModelList();
            } else if (isLatest && matchesSelection) {
              this.providerModelSelections[targetProvider] = prevSelection;
            }
            this.showError(error);
          }
        });
        if (model === draft.answerModel && !fetchedModels.includes(model)) {
          row.createEl("span", {
            cls: "vault-search-model-current",
            text: "(현재 설정)",
          });
        }
        const starred = favorites.some(
          (favorite) =>
            favorite.provider === draft.answerProvider &&
            favorite.model === model,
        );
        const star = row.createEl("button", {
          cls: "vault-search-model-star",
          text: starred ? "★" : "☆",
          attr: {
            type: "button",
            "aria-label": starred ? "즐겨찾기에서 제거" : "즐겨찾기로 지정",
            title: starred ? "즐겨찾기에서 제거" : "즐겨찾기로 지정",
          },
        });
        star.toggleClass("is-favorite", starred);
        star.addEventListener("click", async () => {
          star.disabled = true;
          const targetProvider = draft.answerProvider;
          const targetModel = model;
          const opKey = `${targetProvider}::${targetModel}`;
          const opId = ++this.favoriteOpSeq;
          this.latestFavoriteOp[opKey] = opId;

          const prevFavorites = Array.isArray(draft.favoriteAnswerModels)
            ? draft.favoriteAnswerModels.map((f) => ({ ...f }))
            : [];
          const exists = prevFavorites.some(
            (f) =>
              f.provider === targetProvider && f.model === targetModel,
          );
          const desiredFavorite = !exists;
          const optimisticFavorites = desiredFavorite
            ? [
                ...prevFavorites,
                { provider: targetProvider, model: targetModel },
              ]
            : prevFavorites.filter(
                (f) =>
                  !(f.provider === targetProvider && f.model === targetModel),
              );

          draft.favoriteAnswerModels = optimisticFavorites.map((f) => ({
            ...f,
          }));
          favorites.length = 0;
          favorites.push(...optimisticFavorites.map((f) => ({ ...f })));
          renderModelList();
          try {
            await this.owner.toggleFavoriteModel(
              targetProvider,
              targetModel,
              desiredFavorite,
            );
            const isLatest = this.latestFavoriteOp[opKey] === opId;
            if (isLatest) {
              const latestSaved = Array.isArray(
                this.owner.settings.favoriteAnswerModels,
              )
                ? this.owner.settings.favoriteAnswerModels.map((f) => ({
                    ...f,
                  }))
                : [];
              draft.favoriteAnswerModels = latestSaved.map((f) => ({ ...f }));
              favorites.length = 0;
              favorites.push(...latestSaved.map((f) => ({ ...f })));
              if (draft.answerProvider === targetProvider) {
                renderModelList();
              }
            }
          } catch (error) {
            const isLatest = this.latestFavoriteOp[opKey] === opId;
            const currentDraftFavs = draft.favoriteAnswerModels || [];
            const isOptimisticMatch =
              currentDraftFavs.length === optimisticFavorites.length &&
              optimisticFavorites.every((opt) =>
                currentDraftFavs.some(
                  (cur) =>
                    cur.provider === opt.provider && cur.model === opt.model,
                ),
              );

            if (isLatest && isOptimisticMatch) {
              draft.favoriteAnswerModels = prevFavorites.map((f) => ({
                ...f,
              }));
              favorites.length = 0;
              favorites.push(...prevFavorites.map((f) => ({ ...f })));
              if (draft.answerProvider === targetProvider) {
                renderModelList();
              }
            }
            this.showError(error);
          }
        });
      }
    };
    renderModelList();
    modelSetting.addButton((button) =>
      button.setButtonText("모델 최신화").onClick(async () => {
        button.setDisabled(true);
        const targetProvider = draft.answerProvider;
        const targetProviderInfo = LLM_PROVIDER_DEFAULTS[targetProvider];
        try {
          const models = await this.owner.fetchProviderModels(targetProvider);
          await this.owner.setProviderModels(targetProvider, models);
          this.providerModelSelections[targetProvider] =
            draft.answerProvider === targetProvider
              ? draft.answerModel
              : (this.providerModelSelections[targetProvider] || "");
          new Notice(
            models.length
              ? `${targetProviderInfo.name}: 선택 가능한 모델 ${models.length}개를 확인했습니다.`
              : targetProvider === "openai"
                ? "OpenAI API가 선택 가능한 채팅 모델을 반환하지 않았습니다. API 키의 모델 권한을 확인해 주세요."
                : `${targetProviderInfo.name}: 선택 가능한 모델을 찾지 못했습니다. API 키의 모델 권한을 확인해 주세요.`,
          );
          if (draft.answerProvider === targetProvider) {
            this.display();
          }
        } catch (error) {
          this.showError(error);
        } finally {
          button.setDisabled(false);
        }
      }),
    );
    new Setting(containerEl)
      .setName("답변 context 문자 수")
      .setDesc("8,000~32,000자")
      .addText((text) =>
        text.setValue(String(draft.answerMaxContextChars)).onChange((value) => {
          draft.answerMaxContextChars = Math.max(
            8000,
            Math.min(
              32000,
              this.nonnegativeNumber(value, draft.answerMaxContextChars),
            ),
          );
        }),
      );
    new Setting(containerEl)
      .setName("답변 출력 토큰")
      .setDesc("128~8,000 토큰")
      .addText((text) =>
        text.setValue(String(draft.answerMaxOutputTokens)).onChange((value) => {
          draft.answerMaxOutputTokens = Math.max(
            128,
            Math.min(
              8000,
              this.nonnegativeNumber(value, draft.answerMaxOutputTokens),
            ),
          );
        }),
      );
    new Setting(containerEl)
      .setName("답변 timeout (초)")
      .setDesc("provider 요청 timeout은 최대 60초입니다.")
      .addText((text) =>
        text.setValue(String(draft.answerTimeoutSeconds)).onChange((value) => {
          draft.answerTimeoutSeconds = Math.max(
            5,
            Math.min(
              60,
              this.nonnegativeNumber(value, draft.answerTimeoutSeconds),
            ),
          );
        }),
      );

    containerEl.createEl("h3", { text: "AI Vault 히스토리" });
    new Setting(containerEl)
      .setName("히스토리 폴더")
      .setDesc(
        "대화가 마크다운 노트로 저장되는 볼트 내 경로입니다. 노트는 언제든 직접 읽고 편집할 수 있습니다. 참고: 히스토리 노트도 검색 인덱스에 포함될 수 있으므로 제외하려면 제외 목록에 이 폴더를 추가하세요.",
      )
      .addText((text) =>
        text
          .setPlaceholder("AI Vault Search/history")
          .setValue(draft.historyFolder)
          .onChange((value) => {
            draft.historyFolder = value.trim() || "AI Vault Search/history";
          }),
      );
    new Setting(containerEl)
      .setName("자동 저장")
      .setDesc("답변이 완료될 때마다 현재 대화를 히스토리에 자동 저장합니다.")
      .addToggle((toggle) =>
        toggle.setValue(draft.historyAutosave).onChange((value) => {
          draft.historyAutosave = value;
        }),
      );
    new Setting(containerEl)
      .setName("최대 보존 개수")
      .setDesc("보관할 히스토리 노트 수입니다. 0이면 무제한으로 보관합니다.")
      .addText((text) =>
        text.setValue(String(draft.historyMaxEntries)).onChange((value) => {
          draft.historyMaxEntries = this.nonnegativeNumber(
            value,
            draft.historyMaxEntries,
          );
        }),
      );

    const agent = this.owner.agentIntegration;
    new Setting(containerEl)
      .setName("에이전트 통합")
      .setDesc(
        "AI 에이전트(Claude Code, Codex, Gemini CLI 등)가 이 볼트에서 vault-search를 사용하도록 지시 파일과 검색 래퍼를 설치합니다. " +
          "볼트 루트 파일은 명시적으로 설치할 때만 수정되며, 기존 검색 지시가 있으면 자동으로 건너뜁니다. " +
          (agent ? this.agentStatusText(agent) : "상태 확인 중…"),
      )
      .addButton((button) =>
        button
          .setButtonText("설치/갱신")
          .setCta()
          .onClick(async () => {
            try {
              const result = await this.owner.runAgentIntegrationInstall();
              new Notice(agentIntegrationNotice(result), 8000);
              this.display();
            } catch (error) {
              this.showError(error);
            }
          }),
      );

    // --- API agent extensions: project rules / MCP servers / skills ---
    renderApiAgentSettings(containerEl, this.owner, draft);
    renderMcpSettings(containerEl, this.owner, draft);
    renderSkillSettings(containerEl, this.owner, draft);

    new Setting(containerEl).setName("임베딩 모델").addDropdown((dropdown) => {
      for (const [id, profile] of Object.entries(MODEL_PROFILES))
        dropdown.addOption(id, profile.name);
      dropdown.setValue(draft.modelProfile).onChange((id) => {
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

    new Setting(containerEl)
      .setName("모델 ID")
      .setDesc(
        MODEL_PROFILES[draft.modelProfile]?.note ||
          "Sentence Transformers 모델 ID",
      )
      .addText((text) =>
        text.setValue(draft.modelId).onChange((value) => {
          draft.modelId = value.trim();
        }),
      );
    new Setting(containerEl)
      .setName("임베딩 백엔드")
      .setDesc(
        "ONNX Runtime(기본): 직접 ONNX 경로로 시작이 빠르고 유휴 시 VRAM/RAM을 해제합니다. GPU가 있으면 TensorRT/CUDA를, 없으면 CPU를 자동 사용합니다. PyTorch: 벌크 인덱싱이 가장 빠르지만 시작이 느립니다. 백엔드를 바꾸면 시작 정책 기본값도 함께 조정됩니다.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("onnx", "ONNX Runtime (기본, 권장)")
          .addOption("pytorch", "PyTorch")
          .setValue(draft.engine)
          .onChange((value) => {
            const previous = draft.engine;
            draft.engine = value as typeof draft.engine;
            if (draft.loadPolicy === defaultLoadPolicy(previous)) {
              draft.loadPolicy = defaultLoadPolicy(draft.engine);
            }
            this.display();
          }),
      );

    containerEl.createEl("h3", { text: "고급 설정" });

    new Setting(containerEl)
      .setName("디바이스")
      .setDesc(
        "자동(기본)은 GPU와 검증된 CUDA 런타임이 있으면 GPU를, 없으면 CPU를 사용합니다. CUDA를 명시하면 대용량 런타임 다운로드가 필요할 수 있습니다.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "자동")
          .addOption("cpu", "CPU")
          .addOption("cuda", "CUDA")
          .setValue(draft.device)
          .onChange((value) => {
            draft.device = value as typeof draft.device;
          }),
      );
    const caps = status.capabilities;
    if (
      draft.engine === "onnx" &&
      caps &&
      caps.derived_model_available === false
    ) {
      new Setting(containerEl)
        .setName("ONNX 파생 모델 준비")
        .setDesc(
          caps.model_available === false
            ? "e5-base 모델 스냅샷이 로컬에 없습니다. 먼저 intfloat/multilingual-e5-base를 받아 주세요."
            : "로컬 스냅샷에 파생 풀링 그래프(onnx/model-pooled-normalized.onnx)가 없습니다. 생성을 실행하면 ONNX 엔진을 사용할 수 있습니다.",
        )
        .addButton((button) => {
          button.setButtonText("파생 모델 생성").setCta();
          if (caps.model_available === false) button.setDisabled(true);
          button.onClick(async () => {
            try {
              await this.owner.provisionOnnx();
            } catch (error) {
              this.showError(error);
            }
          });
        });
    }
    // Options are gated on capabilities only once the backend has reported
    // them; unknown (service stopped / not started yet) keeps every choice so
    // the user can pick one. The saved value is always present and selected:
    // falling back to "auto" here would silently misrepresent the stored
    // provider after a restart and make it look like the choice was reset.
    const providerOptions: Array<[string, string]> = [["auto", "자동"]];
    if (caps?.cuda_available !== false) providerOptions.push(["cuda", "CUDA"]);
    if (caps?.tensorrt_available !== false)
      providerOptions.push(["tensorrt", "TensorRT"]);
    const providerLabels: Record<string, string> = {
      auto: "자동",
      cuda: "CUDA",
      tensorrt: "TensorRT",
    };
    const providerValue = draft.provider;
    if (!providerOptions.some(([value]) => value === providerValue)) {
      const label = providerLabels[providerValue] || providerValue;
      const rejectedByCaps =
        caps !== undefined &&
        ((providerValue === "cuda" && caps.cuda_available === false) ||
          (providerValue === "tensorrt" && caps.tensorrt_available === false));
      providerOptions.push([
        providerValue,
        rejectedByCaps ? `${label} (현재 런타임에서 사용 불가)` : label,
      ]);
    }
    const supported = caps
      ? [caps.cuda_available && "CUDA", caps.tensorrt_available && "TensorRT"]
          .filter(Boolean)
          .join(", ") || "CPU만"
      : "서비스 시작 후 확인";
    new Setting(containerEl)
      .setName("ONNX 실행 제공자 (provider)")
      .setDesc(
        `CUDA 실행 시에만 적용됩니다 (device=cuda 또는 auto가 CUDA로 해석될 때). 이 머신 지원: ${supported}. auto는 TensorRT가 설치되어 있으면 우선하고, 아니면 CUDA로 폴백합니다.`,
      )
      .addDropdown((dropdown) => {
        for (const [value, label] of providerOptions)
          dropdown.addOption(value, label);
        dropdown
          .setValue(providerValue)
          .setDisabled(draft.engine !== "onnx" || draft.device === "cpu")
          .onChange((value) => {
            draft.provider = value as typeof draft.provider;
          });
      });
    const cudaInstalled = caps?.cuda_available === true;
    new Setting(containerEl)
      .setName("CUDA 런타임")
      .setDesc(
        cudaInstalled
          ? "CUDA 런타임이 설치되어 사용 가능합니다. 재설치가 필요하면 런타임 폴더를 정리한 뒤 다시 설치하세요."
          : "NVIDIA GPU용 PyTorch와 onnxruntime-gpu를 별도 설치합니다. 수 GB 다운로드와 벡터 재구축으로 수 분 이상 걸릴 수 있습니다.",
      )
      .addButton((button) => {
        button
          .setButtonText(
            cudaInstalled ? "CUDA 런타임 설치됨" : "CUDA 런타임 설치",
          )
          .setDisabled(cudaInstalled)
          .onClick(async () => {
            try {
              await this.owner.installCudaRuntime();
            } catch (error) {
              this.showError(error);
            }
          });
      });
    new Setting(containerEl).setName("임베딩 정규화").addToggle((toggle) =>
      toggle.setValue(draft.normalizeEmbeddings).onChange((value) => {
        draft.normalizeEmbeddings = value;
      }),
    );
    new Setting(containerEl).setName("Query prefix").addText((text) =>
      text.setValue(draft.queryPrefix).onChange((value) => {
        draft.queryPrefix = value;
      }),
    );
    new Setting(containerEl).setName("Document prefix").addText((text) =>
      text.setValue(draft.documentPrefix).onChange((value) => {
        draft.documentPrefix = value;
      }),
    );

    new Setting(containerEl)
      .setName("Include globs")
      .setDesc("볼트 상대 경로, 한 줄에 하나")
      .setClass("vault-search-textarea")
      .addTextArea((area) => {
        area.setValue(draft.includeGlobs.join("\n"));
        area.inputEl.rows = 7;
        area.onChange((value) => {
          draft.includeGlobs = this.lines(value);
        });
      });
    new Setting(containerEl)
      .setName("Exclude globs")
      .setDesc("볼트 상대 경로, 한 줄에 하나")
      .setClass("vault-search-textarea")
      .addTextArea((area) => {
        area.setValue(draft.excludeGlobs.join("\n"));
        area.inputEl.rows = 7;
        area.onChange((value) => {
          draft.excludeGlobs = this.lines(value);
        });
      });

    new Setting(containerEl)
      .setName("위키 폴더")
      .setDesc(
        "타임라인/관계 검색에서 sources 참조를 따라가는 위키 폴더 목록입니다 (볼트 상대 경로, 한 줄에 하나). " +
          "기본값(5_Wiki/…)은 K_Notes 배치입니다. 위키가 다른 폴더에 있으면 여기서 지정하고, 위키가 없으면 비워 두면 확장이 동작하지 않습니다.",
      )
      .setClass("vault-search-textarea")
      .addTextArea((area) => {
        area.setValue(draft.wikiFolders.join("\n"));
        area.inputEl.rows = 4;
        area.onChange((value) => {
          draft.wikiFolders = this.lines(value);
        });
      });

    new Setting(containerEl)
      .setName("인덱스 관리")
      .setDesc(
        "설정 적용 후 범위를 확인하세요. 재구축은 임시 파일 검증 후 원자적으로 교체됩니다.",
      )
      .addButton((button) =>
        button.setButtonText("범위 미리보기").onClick(async () => {
          try {
            const result = await this.owner.previewScope();
            new Notice(`검색 대상: ${result.count}개 파일`);
          } catch (error) {
            this.showError(error);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("정밀 대조").onClick(async () => {
          try {
            await this.owner.reconcile("strict");
          } catch (error) {
            this.showError(error);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("벡터 재구축").onClick(async () => {
          try {
            await this.owner.rebuildVectors();
          } catch (error) {
            this.showError(error);
          }
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("전체 재구축")
          .setWarning()
          .onClick(async () => {
            try {
              await this.owner.rebuildAll();
            } catch (error) {
              this.showError(error);
            }
          }),
      );

    this.numericFields(
      "청크 크기 / 오버랩",
      "값을 변경하면 전체 인덱스 재구축이 필요합니다.",
      [
        {
          label: "크기",
          value: draft.chunkChars,
          set: (v) => {
            draft.chunkChars = v;
          },
        },
        {
          label: "오버랩",
          value: draft.chunkOverlap,
          allowZero: true,
          set: (v) => {
            draft.chunkOverlap = v;
          },
        },
      ],
    );
    new Setting(containerEl)
      .setName("청킹 전략")
      .setDesc(
        "Markdown 구조 인식 전략을 포함해 변경 시 전체 인덱스 재구축이 필요합니다.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("paragraph-v1", "문단 기반 (기본값)")
          .addOption("markdown-v2", "Markdown 구조 인식")
          .setValue(draft.chunkingStrategy)
          .onChange((value) => {
            draft.chunkingStrategy = value as typeof draft.chunkingStrategy;
            this.display();
          }),
      );
    this.numericFields(
      "BM25 / 벡터 / 최종 후보 / RRF k",
      "검색이 '후보를 넓게 모아 융합한 뒤 최종 결과만 반환'하는 너비를 조정합니다. " +
        "기본값 80 / 80 / 40은 K_Notes 골드셋 기준 recall@40 0.856으로 측정해 정한 값입니다.",
      [
        {
          label: "BM25",
          value: draft.bm25TopK,
          set: (v) => {
            draft.bm25TopK = v;
          },
        },
        {
          label: "벡터",
          value: draft.vectorTopK,
          set: (v) => {
            draft.vectorTopK = v;
          },
        },
        {
          label: "최종",
          value: draft.finalTopK,
          set: (v) => {
            draft.finalTopK = v;
          },
        },
        {
          label: "RRF k",
          value: draft.rrfK,
          set: (v) => {
            draft.rrfK = v;
          },
        },
      ],
    );
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text:
        "• bm25TopK: 키워드(BM25)로 뽑는 후보 청크 수. 넓히면 정확한 단어가 흩어진 파일도 놓치지 않지만, " +
        "잡음이 늘 수 있습니다.\n" +
        "• vectorTopK: 의미(임베딩) 유사도로 뽑는 후보 청크 수. 넓히면 표현이 달라도 관련된 파일이 회수됩니다.\n" +
        "• finalTopK: 최종 반환 결과 수. 에이전트가 넓게 조사할 때는 40개 정도가 적당합니다.\n" +
        "• rrfK: 여러 채널 결과를 융합할 때 순위 점수를 평탄화하는 상수입니다. " +
        "결과가 한 채널에 치우치면 이 값을 줄여 보세요.\n" +
        "바꾸면 실행 중 서비스에 즉시 반영되며, 결과가 이상하면 기본값으로 되돌리면 됩니다.",
    });
    this.numericFields(
      "검색 다양성 / 제목 가중치",
      "파일당 최대 청크 수와 파일명·경로·헤딩 RRF 가중치입니다. 기본값은 1 / 1.0입니다.",
      [
        {
          label: "파일당 청크",
          value: draft.maxChunksPerFile,
          set: (v) => {
            draft.maxChunksPerFile = v;
          },
        },
        {
          label: "제목 가중치",
          value: draft.titleRrfWeight,
          allowZero: true,
          set: (v) => {
            draft.titleRrfWeight = v;
          },
        },
      ],
    );
    containerEl.createEl("div", {
      cls: "vault-search-setting-hint",
      text:
        "• maxChunksPerFile: 한 파일이 최종 결과에서 차지할 수 있는 청크 수. 1이면 각 파일은 결과 1개로 제한되어 " +
        "다른 파일도 볼 수 있습니다. 한 파일의 여러 구절을 보려면 늘려 보세요.\n" +
        "• titleRrfWeight: 파일명·경로·헤딩 매치가 결과 순위에 미치는 가중치. 파일 제목을 중요하게 여기려면 올리세요.",
    });
    new Setting(containerEl)
      .setName("접두사 검색 폴백")
      .setDesc(
        "정확 BM25 결과가 없을 때 토큰 접두사 검색으로 한 번 더 찾습니다.",
      )
      .addToggle((toggle) =>
        toggle.setValue(draft.prefixFallback).onChange((value) => {
          draft.prefixFallback = value;
        }),
      );
    new Setting(containerEl).setName("동기화 debounce (ms)").addText((text) =>
      text.setValue(String(draft.syncDebounceMs)).onChange((value) => {
        draft.syncDebounceMs = this.positiveNumber(value, draft.syncDebounceMs);
      }),
    );
    new Setting(containerEl).setName("자동 증분 동기화").addToggle((toggle) =>
      toggle.setValue(draft.autoSync).onChange((value) => {
        draft.autoSync = value;
      }),
    );
    new Setting(containerEl).setName("시작 시 전체 대조").addToggle((toggle) =>
      toggle.setValue(draft.startupReconcile).onChange((value) => {
        draft.startupReconcile = value;
      }),
    );
    this.renderTabs();
  }

  private renderTabs(): void {
    const root = this.containerEl;
    const rendered = Array.from(root.children);
    root.empty();
    root.addClass("vault-search-settings");

    const tabs = root.createDiv({ cls: "vault-search-settings-tabs" });
    const panels = {
      general: root.createDiv({ cls: "vault-search-settings-panel" }),
      answer: root.createDiv({ cls: "vault-search-settings-panel" }),
      agent: root.createDiv({ cls: "vault-search-settings-panel" }),
      search: root.createDiv({ cls: "vault-search-settings-panel" }),
    } satisfies Record<SettingsTabId, HTMLElement>;
    const labels: Record<SettingsTabId, string> = {
      general: "일반",
      answer: "AI 답변",
      agent: "API 에이전트",
      search: "검색·런타임",
    };
    const buttons = new Map<SettingsTabId, HTMLButtonElement>();
    const updateActive = () => {
      for (const tab of Object.keys(panels) as SettingsTabId[]) {
        panels[tab].toggleClass("is-active", tab === this.activeTab);
        buttons.get(tab)?.toggleClass("is-active", tab === this.activeTab);
      }
    };
    for (const tab of Object.keys(labels) as SettingsTabId[]) {
      const button = tabs.createEl("button", {
        text: labels[tab],
        cls: "vault-search-settings-tab",
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        this.activeTab = tab;
        updateActive();
      });
      buttons.set(tab, button);
    }

    let panel: SettingsTabId = "general";
    const searchSettingNames = new Set([
      "에이전트 통합",
      "임베딩 모델",
      "모델 ID",
      "임베딩 백엔드",
      "인덱스 관리",
      "청크 크기 / 오버랩",
      "청킹 전략",
      "BM25 / 벡터 / 최종 후보 / RRF k",
      "검색 다양성 / 제목 가중치",
      "접두사 검색 폴백",
      "동기화 debounce (ms)",
      "자동 증분 동기화",
      "시작 시 전체 대조",
    ]);
    for (const child of rendered) {
      const element = child as HTMLElement;
      if (element.tagName === "H3") {
        if (element.textContent?.includes("AI Vault")) panel = "answer";
        if (
          element.textContent?.includes("API 에이전트") ||
          element.textContent?.includes("MCP 서버") ||
          element.textContent?.includes("스킬")
        )
          panel = "agent";
        if (element.textContent?.includes("고급")) panel = "search";
      }
      const settingName = element
        .querySelector(".setting-item-name")
        ?.textContent?.trim();
      if (
        panel === "answer" &&
        settingName &&
        searchSettingNames.has(settingName)
      ) {
        panel = "search";
      }
      panels[panel].appendChild(element);
    }
    updateActive();
  }

  /** Render a numeric row as labeled horizontal fields (label above each
   *  input) laid out BELOW the setting name/description across the full width,
   *  instead of squeezing several fields into the right control column (which
   *  runs out of space for 4+ fields). */
  private numericFields(
    name: string,
    desc: string,
    fields: Array<{
      label: string;
      value: number;
      set: (value: number) => void;
      allowZero?: boolean;
    }>,
  ): void {
    const setting = new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .setClass("vault-search-fields-below");
    const control = setting.controlEl;
    control.addClass("vault-search-num-fields");
    for (const field of fields) {
      const group = control.createDiv({ cls: "vault-search-num-field" });
      group.createEl("span", {
        text: field.label,
        cls: "vault-search-num-field-label",
      });
      const input = group.createEl("input", {
        type: "text",
        cls: "vault-search-num-field-input",
        value: String(field.value),
      });
      input.addEventListener("input", () => {
        const parsed = Number(input.value);
        const valid =
          Number.isFinite(parsed) &&
          (field.allowZero ? parsed >= 0 : parsed > 0);
        if (valid) field.set(parsed);
      });
    }
  }

  private lines(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(Boolean);
  }

  /** Status line for the ONNX execution provider. Shows the *effective*
   *  provider (the EP the loaded session was actually built with) when the
   *  model is loaded, and the expected resolution before load, so the display
   *  reflects reality rather than only the configured value. */
  private providerStatusLine(status: BackendStatus): string {
    const effective = status.effective_provider;
    const shown = effective || status.expected_provider;
    if (!shown) return "";
    const configNote =
      status.provider && status.provider !== "auto"
        ? ` (설정: ${this.providerLabel(status.provider)})`
        : "";
    return `실행 제공자: ${this.providerLabel(shown)}${configNote}${effective ? "" : " (로드 전 예상)"}`;
  }

  private providerLabel(provider: string | null | undefined): string {
    switch (provider) {
      case "TensorrtExecutionProvider":
      case "tensorrt":
        return "TensorRT";
      case "CUDAExecutionProvider":
      case "cuda":
        return "CUDA";
      case "CPUExecutionProvider":
      case "cpu":
        return "CPU";
      case "auto":
        return "자동";
      default:
        return provider || "-";
    }
  }

  private agentStatusText(agent: AgentIntegrationStatus): string {
    const agents =
      agent.agentsFile === "absent"
        ? "AGENTS.md: 없음"
        : agent.agentsFile === "managed"
          ? "AGENTS.md: 관리 블록 있음"
          : agent.agentsFile === "conflict"
            ? "AGENTS.md: 기존 검색 지시 있음 (자동 통합 안 함)"
            : "AGENTS.md: 기존 파일 있음";
    const claude =
      agent.claudeFile === "absent"
        ? "CLAUDE.md: 없음"
        : agent.claudeFile === "managed"
          ? "CLAUDE.md: 관리 블록 있음"
          : agent.claudeFile === "conflict"
            ? "CLAUDE.md: 기존 검색 지시 있음 (자동 통합 안 함)"
            : "CLAUDE.md: 기존 파일 있음";
    const wrapper = agent.wrapper ? "래퍼: 설치됨" : "래퍼: 없음";
    const skill =
      agent.skill === "absent"
        ? "스킬(Claude): 없음"
        : agent.skill === "managed"
          ? "스킬(Claude): 관리됨"
          : "스킬(Claude): 기존 파일";
    const agentsSkill = agent.agentsSkill
      ? "스킬(Codex/Antigravity/OpenCode): 설치됨"
      : "스킬(Codex/Antigravity/OpenCode): 없음";
    return `현재 상태 — ${agents} / ${claude} / ${wrapper} / ${skill} / ${agentsSkill}`;
  }

  private positiveNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private nonnegativeNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private showError(error: unknown): void {
    new Notice(
      `Vault Search 오류: ${error instanceof Error ? error.message : String(error)}`,
      8000,
    );
    this.display();
  }
}
