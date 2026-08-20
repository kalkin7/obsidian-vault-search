import { Modal } from "obsidian";
import { SearchSession, type SearchSessionState } from "./search-session";
import { SearchResultView, type SearchResultLocation } from "./search-result-view";
import type { BackendStatus, SearchResult } from "./types";
import { SearchApi } from "./search-api";
import {
  copyMarkdownToClipboard,
  createNoteFromMarkdown,
  formatSearchResultsMarkdown,
  insertMarkdownToActiveNote,
} from "./note-actions";

export interface SearchModalOwner {
  app: Modal["app"];
  backend: {
    status: BackendStatus;
    ensureStarted(): Promise<void>;
    call<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  };
  ensureSearchStarted(): Promise<void>;
  openSearchResult(location: SearchResultLocation): Promise<void>;
  openSearchSettings(): void;
  searchModalClosed(modal: VaultSearchModal): void;
}

export class VaultSearchModal extends Modal {
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private actionsBarEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private resultView!: SearchResultView;
  private session!: SearchSession;
  private searchApi!: SearchApi;

  constructor(private readonly owner: SearchModalOwner, private readonly initialQuery = "") {
    super(owner.app);
  }

  onOpen(): void {
    this.modalEl.addClass("vault-search-modal");
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Vault Search" });
    this.inputEl = this.contentEl.createEl("input", {
      cls: "vault-search-input",
      attr: { type: "search", placeholder: "볼트 검색", "aria-label": "Vault Search query" }
    });
    this.statusEl = this.contentEl.createDiv({ cls: "vault-search-modal-status" });
    this.actionsBarEl = this.contentEl.createDiv({ cls: "vault-search-modal-actions" });
    this.resultsEl = this.contentEl.createDiv({ cls: "vault-search-results" });
    this.resultView = new SearchResultView(this.resultsEl,
      location => this.owner.openSearchResult(location));
    this.searchApi = new SearchApi(this.owner);
    this.session = new SearchSession(query => this.searchApi.search(query), state => this.renderState(state));
    this.inputEl.addEventListener("input", () => this.session.setQuery(this.inputEl.value));
    this.inputEl.value = this.initialQuery;
    this.renderBackendStatus(this.owner.backend.status);
    this.session.setQuery(this.initialQuery);
    this.inputEl.focus();
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }

  onClose(): void {
    this.session?.dispose();
    this.contentEl.empty();
    this.owner.searchModalClosed(this);
  }

  updateBackendStatus(status: BackendStatus): void {
    if (this.statusEl) this.renderBackendStatus(status);
  }

  private renderState(state: SearchSessionState): void {
    if (state.kind === "idle") {
      this.actionsBarEl.empty();
      this.resultsEl.empty();
      return;
    }
    if (state.kind === "loading") {
      this.actionsBarEl.empty();
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: "vault-search-empty", text: "검색 중…" });
      return;
    }
    if (state.kind === "results") {
      this.renderActionsBar(state.results);
      this.resultView.render(state.results);
      return;
    }
    this.actionsBarEl.empty();
    this.resultsEl.empty();
    const unavailable = this.resultsEl.createDiv({ cls: "vault-search-unavailable" });
    unavailable.createDiv({ text: `검색 서비스를 사용할 수 없습니다: ${state.message}` });
    const button = unavailable.createEl("button", { text: "설정 열기" });
    button.addEventListener("click", () => this.owner.openSearchSettings());
  }

  private renderActionsBar(results: SearchResult[]): void {
    this.actionsBarEl.empty();
    if (results.length === 0) return;

    const countSpan = this.actionsBarEl.createSpan({
      cls: "vault-search-modal-count",
      text: `${results.length}개 결과`,
    });
    void countSpan;

    const buttons = this.actionsBarEl.createDiv({
      cls: "vault-search-modal-action-buttons",
    });

    const copyBtn = buttons.createEl("button", {
      text: "복사",
      cls: "vault-search-action-btn vault-search-action-copy",
      attr: { type: "button", "aria-label": "검색 결과 마크다운 복사" },
    });
    copyBtn.addEventListener("click", () => {
      const query = this.inputEl.value.trim() || "검색 결과";
      const md = formatSearchResultsMarkdown(query, results);
      void copyMarkdownToClipboard(md, (ok) => {
        copyBtn.setText(ok ? "복사됨 ✓" : "복사 실패");
        globalThis.setTimeout(() => copyBtn.setText("복사"), 1500);
      });
    });

    const newNoteBtn = buttons.createEl("button", {
      text: "새 노트",
      cls: "vault-search-action-btn vault-search-action-new-note",
      attr: { type: "button", "aria-label": "검색 결과를 새 노트로 생성" },
    });
    newNoteBtn.addEventListener("click", () => {
      void (async () => {
        const query = this.inputEl.value.trim() || "검색 결과";
        const md = formatSearchResultsMarkdown(query, results);
        await createNoteFromMarkdown(this.owner.app, {
          title: `검색 - ${query}`,
          content: md,
        });
        this.close();
      })();
    });

    const insertBtn = buttons.createEl("button", {
      text: "현재 노트에 삽입",
      cls: "vault-search-action-btn vault-search-action-insert",
      attr: { type: "button", "aria-label": "현재 열려 있는 노트에 결과 목록 추가" },
    });
    insertBtn.addEventListener("click", () => {
      const query = this.inputEl.value.trim() || "검색 결과";
      const md = formatSearchResultsMarkdown(query, results);
      const inserted = insertMarkdownToActiveNote(this.owner.app, md);
      if (inserted) {
        this.close();
      }
    });
  }

  private renderBackendStatus(status: BackendStatus): void {
    this.statusEl.removeClass("vault-search-error");
    if (status.state === "idle") {
      this.statusEl.setText("모델 대기 중 · 검색 시 모델을 로드합니다.");
    } else if (status.state === "loading_model" || status.state === "starting") {
      this.statusEl.setText("검색 모델을 로드하고 있습니다…");
    } else if (status.state === "error") {
      this.statusEl.setText(status.error || "검색 서비스를 사용할 수 없습니다.");
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "stopped") {
      this.statusEl.setText("검색 서비스가 중지되어 있습니다.");
    } else {
      this.statusEl.setText("");
    }
  }
}
