import {
  ItemView,
  Notice,
  setIcon,
  type IconName,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { BackendCallError } from "./backend-manager";
import { AnswerRenderer, toNoteMarkdown } from "./answer-renderer";
import {
  AnswerSession,
  type AnswerConversationMessage,
} from "./answer-session";
import {
  SearchResultView,
  type SearchResultLocation,
} from "./search-result-view";
import type {
  AnswerEvidence,
  AnswerResult,
  AnswerState,
  BackendStatus,
  Citation,
  FavoriteAnswerModel,
  LLMProviderId,
  VaultSearchSettings,
} from "./types";
import { VIEW_TYPE_VAULT_AI_SEARCH } from "./constants";
import { ICON_HISTORY, ICON_LIGHTNING } from "./icons";
import {
  deleteHistory,
  listHistory,
  loadHistory,
  saveHistory,
  type HistoryMessage,
  type HistoryMeta,
  type HistorySession,
} from "./history";

const ANSWER_TRANSPORT_MARGIN_MS = 2_000;
/** Textarea auto-grow cap; past this the box scrolls instead. */
const INPUT_MAX_HEIGHT = 200;

export interface SearchItemViewOwner {
  app: ItemView["app"];
  settings: VaultSearchSettings;
  backend: {
    status: BackendStatus;
    call<T>(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<T>;
  };
  ensureSearchStarted(): Promise<void>;
  openSearchResult(
    location: SearchResultLocation,
    keepPanel?: boolean,
  ): Promise<void>;
  openSearchSettings(): void;
  getAnswerModelOptions(): FavoriteAnswerModel[];
  setAnswerModel(
    provider: LLMProviderId,
    model: string,
    options?: { notify?: boolean },
  ): Promise<void>;
  getAnswerReasoningEffortOptions(): string[];
  setAnswerReasoningEffort(effort: string): Promise<void>;
  toggleFavoriteModel(provider: LLMProviderId, model: string): Promise<void>;
  registerAiView(view: VaultSearchItemView): void;
  unregisterAiView(view: VaultSearchItemView): void;
}

export class VaultSearchItemView extends ItemView {
  private readonly listeners: Array<() => void> = [];
  private inputEl!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private answerEl!: HTMLElement;
  private providerEl!: HTMLElement;
  private session!: AnswerSession;
  private modelSelect!: HTMLSelectElement;
  private effortSelect!: HTMLSelectElement;
  private pendingEl: HTMLElement | null = null;
  private lastQuery = "";
  private historyButton!: HTMLButtonElement;
  private historyPopover: HTMLElement | null = null;
  /** Full transcript of the current panel session (raw [S#] markers) — the
   *  source for history saves. Reset on 지우기 / history load. */
  private transcript: HistoryMessage[] = [];
  private sessionCreated = "";
  private sessionTitle = "";
  private lastCitations: Citation[] | null = null;

  /** Close the history popover when clicking anywhere outside it. */
  private readonly onDocClick = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && this.historyButton?.contains(target)) return;
    if (this.historyPopover && !this.historyPopover.contains(target)) {
      this.hideHistoryPopover();
    }
  };

  constructor(
    viewLeaf: WorkspaceLeaf,
    private readonly owner: SearchItemViewOwner,
  ) {
    super(viewLeaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AI_SEARCH;
  }

  getDisplayText(): string {
    return "AI Vault Search";
  }

  getIcon(): IconName {
    return ICON_LIGHTNING;
  }

  getState(): Record<string, unknown> {
    // The panel's conversation is session-scoped and the input is cleared on
    // reopen, so there is nothing meaningful to persist across restarts.
    return {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
  }

  protected async onOpen(): Promise<void> {
    this.owner.registerAiView(this);
    this.contentEl.empty();
    this.contentEl.addClass("vault-ai-search-view");
    const header = this.contentEl.createDiv({ cls: "vault-ai-search-header" });
    header.createEl("h2", { text: "AI Vault Search" });
    this.providerEl = header.createDiv({ cls: "vault-ai-search-provider" });
    this.historyButton = header.createEl("button", {
      cls: "vault-ai-search-history-button",
      attr: { type: "button", "aria-label": "AI Vault Search 히스토리" },
    });
    setIcon(this.historyButton, ICON_HISTORY);
    this.historyButton.addEventListener("click", () => {
      void this.toggleHistoryPopover();
    });
    document.addEventListener("mousedown", this.onDocClick, true);
    this.statusEl = this.contentEl.createDiv({ cls: "vault-ai-search-status" });
    this.answerEl = this.contentEl.createDiv({ cls: "vault-ai-search-answer" });
    this.session = new AnswerSession(
      (query, conversation) => this.answer(query, conversation),
      (state) => this.renderAnswerState(state),
    );
    const footer = this.contentEl.createDiv({ cls: "vault-ai-search-footer" });
    this.inputEl = footer.createEl("textarea", {
      cls: "vault-ai-search-input",
      attr: {
        rows: "2",
        placeholder: "볼트에 질문하기…",
        title: "Enter: 전송 · Shift+Enter: 줄바꿈",
        "aria-label": "AI Vault Search query",
      },
    });
    const composerBar = footer.createDiv({
      cls: "vault-ai-search-composer-bar",
    });
    composerBar.createEl("span", {
      text: "모델",
      cls: "vault-ai-search-model-label",
    });
    this.modelSelect = composerBar.createEl("select", {
      cls: "vault-ai-search-model-select",
      attr: { "aria-label": "답변 모델 (즐겨찾기)" },
    });
    composerBar.createEl("span", {
      text: "추론",
      cls: "vault-ai-search-model-label",
    });
    this.effortSelect = composerBar.createEl("select", {
      cls: "vault-ai-search-model-select vault-ai-search-effort-select",
      attr: { "aria-label": "추론 강도 (reasoning effort)" },
    });
    const onEffortChange = () => {
      const value = this.effortSelect.value;
      if (value) void this.owner.setAnswerReasoningEffort(value);
    };
    this.effortSelect.addEventListener("change", onEffortChange);
    this.listeners.push(() =>
      this.effortSelect.removeEventListener("change", onEffortChange),
    );
    composerBar.createEl("span", {
      text: "Enter: 전송 · Shift+Enter: 줄바꿈",
      cls: "vault-ai-search-composer-hint",
    });
    const spacer = composerBar.createDiv({
      cls: "vault-ai-search-composer-spacer",
    });
    const submit = composerBar.createEl("button", {
      text: "질문",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    const clear = composerBar.createEl("button", {
      text: "지우기",
      attr: { type: "button" },
    });
    const submitQuery = () => {
      const query = this.inputEl.value;
      if (query.trim().length < 2) return;
      if (!this.owner.settings.answerModel) {
        new Notice("답변 모델을 먼저 선택해 주세요. (설정에서 ★로 지정)");
        return;
      }
      this.lastQuery = query;
      // A previous in-flight answer may still have a pending block in the
      // conversation; remove it before starting a new request so no stale
      // "답변 작성 중…" survives.
      this.clearPending();
      this.appendUserMessage(query);
      this.transcript.push({ role: "user", content: query });
      this.pendingEl = null;
      this.session.submit(query);
      this.inputEl.value = "";
      this.autoGrowInput();
    };
    submit.addEventListener("click", submitQuery);
    this.listeners.push(() => submit.removeEventListener("click", submitQuery));
    const onKeyDown = (event: KeyboardEvent) => {
      // Enter sends; Shift+Enter inserts a newline (textarea default).
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitQuery();
      }
    };
    this.inputEl.addEventListener("keydown", onKeyDown);
    this.listeners.push(() =>
      this.inputEl.removeEventListener("keydown", onKeyDown),
    );
    const onInput = () => this.autoGrowInput();
    this.inputEl.addEventListener("input", onInput);
    this.listeners.push(() =>
      this.inputEl.removeEventListener("input", onInput),
    );
    const clearQuery = () => {
      this.lastQuery = "";
      this.inputEl.value = "";
      this.autoGrowInput();
      this.session.clear();
      this.answerEl.empty();
      this.pendingEl = null;
      this.transcript = [];
      this.sessionCreated = "";
      this.sessionTitle = "";
      this.lastCitations = null;
      this.hideHistoryPopover();
    };
    clear.addEventListener("click", clearQuery);
    this.listeners.push(() => clear.removeEventListener("click", clearQuery));
    void spacer;
    const onModelChange = () => {
      const [provider, model] = this.modelSelect.value.split("::", 2);
      if (provider && model) {
        void this.owner.setAnswerModel(provider as LLMProviderId, model);
      }
    };
    this.modelSelect.addEventListener("change", onModelChange);
    this.listeners.push(() =>
      this.modelSelect.removeEventListener("change", onModelChange),
    );
    // Start with a clean input on reopen — the conversation is session-scoped
    // and a stale query in an empty chat is confusing.
    this.inputEl.value = "";
    this.autoGrowInput();
    this.refreshModelSelector();
    this.renderBackendStatus(this.owner.backend.status);
    this.inputEl.focus();
  }

  protected async onClose(): Promise<void> {
    this.session?.dispose();
    document.removeEventListener("mousedown", this.onDocClick, true);
    this.hideHistoryPopover();
    for (const remove of this.listeners.splice(0)) remove();
    this.owner.unregisterAiView(this);
    this.contentEl.empty();
  }

  updateBackendStatus(status: BackendStatus): void {
    if (this.statusEl) this.renderBackendStatus(status);
  }

  /** Re-populate the footer model selector from the owner's favorite list
   *  (called on open and whenever settings/models change externally). No
   *  model is presumed: with nothing chosen and no usable favorites the
   *  selector shows a placeholder and the header says 모델 미선택. */
  refreshModelSelector(): void {
    if (!this.modelSelect) return;
    const options = this.owner.getAnswerModelOptions();
    const currentProvider = this.owner.settings.answerProvider;
    const current = this.owner.settings.answerModel;
    const favorites = this.owner.settings.favoriteAnswerModels || [];
    this.modelSelect.empty();
    if (options.length) {
      for (const option of options) {
        const crossProvider = option.provider !== currentProvider;
        const isCurrent =
          option.provider === currentProvider && option.model === current;
        const isFavorite = favorites.some(
          (favorite) =>
            favorite.provider === option.provider &&
            favorite.model === option.model,
        );
        let text = option.model;
        if (crossProvider) text = `${option.model} (${option.provider})`;
        else if (isCurrent && !isFavorite) text = `${option.model} (현재 설정)`;
        this.modelSelect.createEl("option", {
          text,
          value: `${option.provider}::${option.model}`,
        });
      }
      this.modelSelect.value = `${currentProvider}::${current}`;
    } else {
      this.modelSelect.createEl("option", {
        text: "— 모델을 선택하세요 —",
        value: "",
      });
      this.modelSelect.value = "";
    }
    this.modelSelect.title =
      "답변 모델 — 설정에서 ★로 지정한 즐겨찾기입니다. (현재 설정)은 즐겨찾기가 아닌 지금 선택된 모델입니다.";
    if (this.effortSelect) {
      const effortOptions = this.owner.getAnswerReasoningEffortOptions();
      const currentEffort = this.owner.settings.answerReasoningEffort;
      this.effortSelect.empty();
      for (const level of effortOptions) {
        this.effortSelect.createEl("option", {
          text: level === "auto" ? "자동" : level,
          value: level,
        });
      }
      this.effortSelect.value = effortOptions.includes(currentEffort)
        ? currentEffort
        : "auto";
      this.effortSelect.title =
        "추론 강도 — 모델별 지원 범위에 맞춰 표시됩니다. none은 즉답, high/max는 깊은 추론.";
    }
    if (this.providerEl) {
      this.providerEl.setText(
        this.owner.settings.answerModel
          ? `${this.owner.settings.answerProvider} · ${this.owner.settings.answerModel}`
          : "모델 미선택",
      );
    }
  }

  private autoGrowInput(): void {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight + 2, INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
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
      // Agentic mode: the model iteratively searches / reads / greps the
      // vault (same quality as a CLI agent) before answering.
      deep: true,
    };
    // The agent loop takes multiple LLM round-trips; give it a generous
    // transport budget (per-call timeout x turns) instead of the single-shot
    // timeout.
    const timeoutMs =
      this.owner.settings.answerTimeoutSeconds * 1000 * 12 +
      ANSWER_TRANSPORT_MARGIN_MS;
    try {
      return await this.owner.backend.call<AnswerResult>(
        "answer",
        params,
        timeoutMs,
      );
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.owner.backend.call<AnswerResult>(
          "answer",
          params,
          timeoutMs,
        );
      }
      throw error;
    }
  }

  private renderAnswerState(state: AnswerState): void {
    if (state.kind === "idle") {
      this.statusEl?.setText("");
      return;
    }
    if (state.kind === "retrieving") {
      this.setPending("볼트 근거를 찾는 중…");
      return;
    }
    if (state.kind === "answering") {
      this.setPending("답변을 작성하는 중…");
      return;
    }
    if (state.kind === "answer") {
      this.renderAnswer(state.result);
      return;
    }
    this.renderUnavailable(state);
  }

  private appendUserMessage(text: string): void {
    const bubble = this.answerEl.createDiv({ cls: "vault-ai-search-user" });
    bubble.setText(text);
    this.scrollToBottom();
  }

  private setPending(text: string): void {
    if (!this.pendingEl) {
      this.pendingEl = this.answerEl.createDiv({
        cls: "vault-ai-search-assistant",
      });
      this.pendingEl.createDiv({ cls: "vault-ai-search-thinking" });
    }
    const label = this.pendingEl.querySelector(
      ".vault-ai-search-thinking",
    ) as HTMLElement | null;
    if (label) label.setText(text);
    this.scrollToBottom();
  }

  private clearPending(): void {
    if (this.pendingEl) {
      this.pendingEl.remove();
      this.pendingEl = null;
    }
  }

  private renderMessageEvidence(
    block: HTMLElement,
    evidence: AnswerEvidence[],
  ): void {
    const details = block.createEl("details", {
      cls: "vault-ai-search-evidence",
    });
    details.createEl("summary", {
      text: `근거 펼치기 (${evidence.length})`,
    });
    const list = details.createDiv({ cls: "vault-ai-search-source-list" });
    const view = new SearchResultView(list, (location) =>
      this.owner.openSearchResult(location, true),
    );
    view.render(evidence);
  }

  private scrollToBottom(): void {
    this.answerEl.scrollTop = this.answerEl.scrollHeight;
  }

  private renderUnavailable(
    state: Extract<AnswerState, { kind: "unavailable" }>,
  ): void {
    this.clearPending();
    const block = this.answerEl.createDiv({
      cls: "vault-ai-search-assistant",
    });
    const meta = block.createDiv({ cls: "vault-ai-search-thought" });
    meta.setText("답변을 사용할 수 없습니다");
    meta.addClass("vault-search-error");
    const message =
      state.code === "LLM_AUTH_FAILED"
        ? "API 키가 유효하지 않습니다. 설정에서 프로바이더 API 키를 다시 확인해 주세요."
        : state.message;
    block.createDiv({ cls: "vault-ai-search-answer-body" }).setText(message);
    if (state.evidence?.length) {
      this.renderMessageEvidence(block, state.evidence);
    }
    const retry = block.createEl("button", {
      text: "다시 시도",
      attr: { type: "button" },
    });
    retry.addEventListener("click", () => this.session.submit(this.lastQuery));
    this.scrollToBottom();
  }

  private renderAnswer(result: AnswerResult): void {
    this.statusEl?.removeClass("vault-search-error");
    this.clearPending();
    this.transcript.push({ role: "assistant", content: result.answer });
    const block = this.answerEl.createDiv({
      cls: "vault-ai-search-assistant",
    });
    const deep = result.diagnostics.deep
      ? ` · 조사 ${result.diagnostics.turns ?? 0}턴`
      : "";
    const meta = block.createDiv({ cls: "vault-ai-search-thought" });
    meta.setText(
      `${result.provider} · ${result.model}${result.grounded ? " · 근거 있음" : " · 근거 부족"}${deep}`,
    );
    const body = block.createDiv({ cls: "vault-ai-search-answer-body" });
    const renderer = new AnswerRenderer(body, {
      openCitation: (location) => this.owner.openSearchResult(location, true),
    });
    // Copy a note-ready version: [S#] citations become working wikilinks to
    // the vault files and a 근거 list is appended, so pasting the answer into
    // a note keeps every reference live.
    renderer.render(result.answer, result.citations, (text) =>
      this.copyAnswer(toNoteMarkdown(text, result.citations)),
    );
    if (result.evidence.length) {
      this.renderMessageEvidence(block, result.evidence);
    }
    if (this.owner.settings.historyAutosave) {
      void this.saveCurrentSession();
    }
    this.scrollToBottom();
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  private async toggleHistoryPopover(): Promise<void> {
    if (this.historyPopover) {
      this.hideHistoryPopover();
      return;
    }
    this.historyPopover = this.contentEl.createDiv({
      cls: "vault-ai-search-history-popover",
    });
    await this.renderHistoryList();
  }

  private hideHistoryPopover(): void {
    this.historyPopover?.remove();
    this.historyPopover = null;
  }

  private async renderHistoryList(): Promise<void> {
    const popover = this.historyPopover;
    if (!popover) return;
    popover.empty();
    const head = popover.createDiv({ cls: "vault-ai-search-history-head" });
    head.createEl("span", { text: "히스토리" });
    const saveNow = head.createEl("button", {
      text: "지금 저장",
      cls: "vault-ai-search-history-save",
      attr: { type: "button" },
    });
    saveNow.addEventListener("click", () => {
      void this.saveCurrentSession(true);
      this.hideHistoryPopover();
      new Notice("히스토리에 저장했습니다.");
    });
    const metas = await listHistory(
      this.app.vault,
      this.owner.settings.historyFolder,
    );
    if (metas.length === 0) {
      popover.createDiv({
        cls: "vault-ai-search-history-empty",
        text: "저장된 히스토리가 없습니다. 답변이 완료되면 자동으로 저장됩니다.",
      });
      return;
    }
    for (const meta of metas) {
      const row = popover.createDiv({ cls: "vault-ai-search-history-item" });
      const info = row.createDiv({ cls: "vault-ai-search-history-info" });
      info.createDiv({
        cls: "vault-ai-search-history-title",
        text: meta.title,
      });
      info.createDiv({
        cls: "vault-ai-search-history-meta",
        text: `${this.formatHistoryDate(meta.created)} · ${meta.model} · ${meta.messageCount}개 메시지`,
      });
      row.addEventListener("click", () => {
        void this.loadSessionFromHistory(meta);
      });
      const del = row.createEl("button", {
        cls: "vault-ai-search-history-delete",
        attr: { type: "button", "aria-label": "삭제" },
      });
      del.setText("🗑");
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.deleteSessionFromHistory(meta);
      });
    }
  }

  private formatHistoryDate(created: string): string {
    const date = new Date(created);
    if (Number.isNaN(date.getTime())) return created;
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay
      ? `오늘 ${time}`
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
  }

  private async loadSessionFromHistory(meta: HistoryMeta): Promise<void> {
    const session = await loadHistory(this.app.vault, meta.file);
    if (!session) {
      new Notice("히스토리를 읽을 수 없습니다.");
      return;
    }
    this.restoreSession(session);
  }

  private restoreSession(session: HistorySession): void {
    this.clearPending();
    this.answerEl.empty();
    this.pendingEl = null;
    this.transcript = session.messages.map((message) => ({ ...message }));
    this.sessionCreated = session.created;
    this.sessionTitle = session.title;
    this.lastCitations = session.citations;
    for (const message of session.messages) {
      if (message.role === "user") {
        this.appendUserMessage(message.content);
      } else {
        const block = this.answerEl.createDiv({
          cls: "vault-ai-search-assistant",
        });
        const meta = block.createDiv({ cls: "vault-ai-search-thought" });
        meta.setText(`${session.provider} · ${session.model} · 히스토리`);
        const body = block.createDiv({ cls: "vault-ai-search-answer-body" });
        const renderer = new AnswerRenderer(body, {
          openCitation: (location) =>
            this.owner.openSearchResult(location, true),
        });
        renderer.render(message.content, session.citations, (text) =>
          this.copyAnswer(toNoteMarkdown(text, session.citations)),
        );
      }
    }
    this.session.restore(session.messages);
    this.lastQuery = "";
    this.hideHistoryPopover();
    this.scrollToBottom();
  }

  private async deleteSessionFromHistory(meta: HistoryMeta): Promise<void> {
    await deleteHistory(this.app.vault, meta.file);
    await this.renderHistoryList();
  }

  /** Snapshot the current panel conversation and write it to the history
   *  folder. `manual` shows a notice when there is nothing to save yet. */
  private async saveCurrentSession(manual = false): Promise<void> {
    if (this.transcript.length === 0) {
      if (manual) new Notice("저장할 대화가 없습니다.");
      return;
    }
    if (!this.sessionCreated) {
      this.sessionCreated = new Date().toISOString();
    }
    if (!this.sessionTitle) {
      const first = this.transcript.find((message) => message.role === "user");
      this.sessionTitle = first ? first.content : "대화";
    }
    const settings = this.owner.settings;
    const session: HistorySession = {
      title: this.sessionTitle,
      created: this.sessionCreated,
      provider: settings.answerProvider,
      model: settings.answerModel,
      reasoningEffort: settings.answerReasoningEffort,
      messages: this.transcript,
      citations: this.lastCitations ?? [],
    };
    await saveHistory(
      this.app.vault,
      settings.historyFolder,
      session,
      settings.historyMaxEntries,
    );
  }

  private renderBackendStatus(status: BackendStatus): void {
    if (status.state === "error") {
      this.statusEl.setText(
        status.error || "검색 서비스를 사용할 수 없습니다.",
      );
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "idle") {
      this.statusEl.setText("모델 대기 중 · 질문 시 모델을 로드합니다.");
    } else if (
      status.state === "starting" ||
      status.state === "loading_model"
    ) {
      this.statusEl.setText("검색 모델을 로드하고 있습니다…");
    }
  }

  private copyAnswer(text: string): void {
    const notify = (ok: boolean) =>
      new Notice(ok ? "답변을 복사했습니다." : "답변 복사에 실패했습니다.");
    if (navigator.clipboard && window.isSecureContext) {
      void navigator.clipboard
        .writeText(text)
        .then(() => notify(true))
        .catch(() => this.copyAnswerFallback(text, notify));
    } else {
      this.copyAnswerFallback(text, notify);
    }
  }

  private copyAnswerFallback(
    text: string,
    notify: (ok: boolean) => void,
  ): void {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    notify(ok);
  }
}
