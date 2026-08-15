import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { BackendCallError } from "./backend-manager";
import { AnswerRenderer } from "./answer-renderer";
import { AnswerSession, type AnswerConversationMessage } from "./answer-session";
import { SearchResultView, type SearchResultLocation } from "./search-result-view";
import type { AnswerResult, AnswerState, BackendStatus, VaultSearchSettings } from "./types";
import { VIEW_TYPE_VAULT_AI_SEARCH } from "./constants";

const ANSWER_TRANSPORT_MARGIN_MS = 2_000;

export interface SearchItemViewOwner {
  app: ItemView["app"];
  settings: VaultSearchSettings;
  backend: {
    status: BackendStatus;
    call<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  };
  ensureSearchStarted(): Promise<void>;
  openSearchResult(location: SearchResultLocation, keepPanel?: boolean): Promise<void>;
  openSearchSettings(): void;
  lightningIconSrc(): string;
  registerAiView(view: VaultSearchItemView): void;
  unregisterAiView(view: VaultSearchItemView): void;
}

export class VaultSearchItemView extends ItemView {
  private readonly listeners: Array<() => void> = [];
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private answerEl!: HTMLElement;
  private sourcesEl!: HTMLElement;
  private answerRenderer!: AnswerRenderer;
  private sourceView!: SearchResultView;
  private session!: AnswerSession;
  private lastQuery = "";

  constructor(viewLeaf: WorkspaceLeaf, private readonly owner: SearchItemViewOwner) {
    super(viewLeaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AI_SEARCH;
  }

  getDisplayText(): string {
    return "AI Vault Search";
  }

  getIcon(): "search" {
    return "search";
  }

  getState(): Record<string, unknown> {
    return {
      query: this.lastQuery,
      provider: this.owner.settings.answerProvider,
      model: this.owner.settings.answerModel,
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const value = state && typeof state === "object" ? state as Record<string, unknown> : {};
    if (typeof value.query === "string") {
      this.lastQuery = value.query;
      if (this.inputEl) this.inputEl.value = this.lastQuery;
    }
    await super.setState(state, result);
  }

  protected async onOpen(): Promise<void> {
    this.owner.registerAiView(this);
    this.contentEl.empty();
    this.contentEl.addClass("vault-ai-search-view");
    const header = this.contentEl.createDiv({ cls: "vault-ai-search-header" });
    header.createEl("h2", { text: "AI Vault Search" });
    header.createDiv({
      cls: "vault-ai-search-provider",
      text: `${this.owner.settings.answerProvider} · ${this.owner.settings.answerModel}`,
    });
    const headerButton = header.createEl("button", {
      cls: "vault-ai-search-lightning-button",
      attr: { type: "button", "aria-label": "AI Vault Search 질문 입력" },
    });
    headerButton.createEl("img", {
      cls: "vault-search-lightning-icon",
      attr: { src: this.owner.lightningIconSrc(), alt: "" },
    });
    headerButton.addEventListener("click", () => this.inputEl?.focus());
    this.statusEl = this.contentEl.createDiv({ cls: "vault-ai-search-status" });
    this.answerEl = this.contentEl.createDiv({ cls: "vault-ai-search-answer" });
    this.sourcesEl = this.contentEl.createDiv({ cls: "vault-ai-search-sources" });
    this.answerRenderer = new AnswerRenderer(this.answerEl, {
      openCitation: (location) => this.owner.openSearchResult(location, true),
    });
    this.sourceView = new SearchResultView(
      this.sourcesEl,
      (location) => this.owner.openSearchResult(location, true),
    );
    this.session = new AnswerSession(
      (query, conversation) => this.answer(query, conversation),
      (state) => this.renderAnswerState(state),
    );
    const footer = this.contentEl.createDiv({ cls: "vault-ai-search-footer" });
    this.inputEl = footer.createEl("input", {
      cls: "vault-ai-search-input",
      attr: { type: "search", placeholder: "볼트에 질문하기", "aria-label": "AI Vault Search query" },
    });
    const submit = footer.createEl("button", { text: "질문", attr: { type: "button" } });
    const clear = footer.createEl("button", { text: "지우기", attr: { type: "button" } });
    const submitQuery = () => {
      this.lastQuery = this.inputEl.value;
      this.session.submit(this.lastQuery);
    };
    submit.addEventListener("click", submitQuery);
    this.listeners.push(() => submit.removeEventListener("click", submitQuery));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitQuery();
      }
    };
    this.inputEl.addEventListener("keydown", onKeyDown);
    this.listeners.push(() => this.inputEl.removeEventListener("keydown", onKeyDown));
    const clearQuery = () => {
      this.lastQuery = "";
      this.inputEl.value = "";
      this.session.clear();
      this.answerEl.empty();
      this.sourcesEl.empty();
    };
    clear.addEventListener("click", clearQuery);
    this.listeners.push(() => clear.removeEventListener("click", clearQuery));
    this.inputEl.value = this.lastQuery;
    this.renderBackendStatus(this.owner.backend.status);
    this.inputEl.focus();
  }

  protected async onClose(): Promise<void> {
    this.session?.dispose();
    for (const remove of this.listeners.splice(0)) remove();
    this.owner.unregisterAiView(this);
    this.contentEl.empty();
  }

  updateBackendStatus(status: BackendStatus): void {
    if (this.statusEl) this.renderBackendStatus(status);
  }

  private async answer(
    query: string,
    conversation: AnswerConversationMessage[],
  ): Promise<AnswerResult> {
    await this.owner.ensureSearchStarted();
    const params = {
      query,
      top_k: 12,
      max_context_chars: this.owner.settings.answerMaxContextChars,
      conversation,
    };
    try {
      return await this.owner.backend.call<AnswerResult>(
        "answer",
        params,
        this.owner.settings.answerTimeoutSeconds * 1000 + ANSWER_TRANSPORT_MARGIN_MS,
      );
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.owner.backend.call<AnswerResult>(
          "answer",
          params,
          this.owner.settings.answerTimeoutSeconds * 1000 + ANSWER_TRANSPORT_MARGIN_MS,
        );
      }
      throw error;
    }
  }

  private renderAnswerState(state: AnswerState): void {
    if (state.kind === "idle") {
      this.answerEl.empty();
      this.sourcesEl.empty();
      this.statusEl?.setText("");
      return;
    }
    if (state.kind === "retrieving") {
      this.statusEl?.setText("볼트 근거를 찾는 중…");
      return;
    }
    if (state.kind === "answering") {
      this.statusEl?.setText("답변을 작성하는 중…");
      return;
    }
    if (state.kind === "answer") {
      this.renderAnswer(state.result);
      return;
    }
    this.statusEl?.setText(`답변을 사용할 수 없습니다: ${state.message}`);
    this.statusEl?.addClass("vault-search-error");
    if (state.evidence?.length) {
      this.sourcesEl.empty();
      const details = this.sourcesEl.createEl("details", { cls: "vault-ai-search-evidence" });
      details.createEl("summary", { text: `검색 근거 (${state.evidence.length})` });
      const list = details.createDiv({ cls: "vault-ai-search-source-list" });
      this.sourceView = new SearchResultView(list, (location) => this.owner.openSearchResult(location, true));
      this.sourceView.render(state.evidence);
    }
    const retry = this.answerEl.createEl("button", { text: "다시 시도", attr: { type: "button" } });
    retry.addEventListener("click", () => this.session.submit(this.lastQuery));
  }

  private renderAnswer(result: AnswerResult): void {
    this.statusEl?.removeClass("vault-search-error");
    this.statusEl?.setText(
      `${result.provider} · ${result.model}${result.grounded ? " · 근거 있음" : " · 근거 부족"}`,
    );
    this.answerRenderer.render(result.answer, result.citations);
    this.sourcesEl.empty();
    const details = this.sourcesEl.createEl("details", { cls: "vault-ai-search-evidence" });
    details.createEl("summary", { text: `근거 펼치기 (${result.evidence.length})` });
    const list = details.createDiv({ cls: "vault-ai-search-source-list" });
    this.sourceView = new SearchResultView(list, (location) => this.owner.openSearchResult(location, true));
    this.sourceView.render(result.evidence);
  }

  private renderBackendStatus(status: BackendStatus): void {
    if (status.state === "error") {
      this.statusEl.setText(status.error || "검색 서비스를 사용할 수 없습니다.");
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "idle") {
      this.statusEl.setText("모델 대기 중 · 질문 시 모델을 로드합니다.");
    } else if (status.state === "starting" || status.state === "loading_model") {
      this.statusEl.setText("검색 모델을 로드하고 있습니다…");
    }
  }
}
