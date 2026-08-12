import { Modal } from "obsidian";
import { SearchSession, type SearchSessionState } from "./search-session";
import { SearchResultView, type SearchResultLocation } from "./search-result-view";
import type { BackendStatus, SearchResult } from "./types";

export interface SearchModalOwner {
  app: Modal["app"];
  backend: {
    status: BackendStatus;
    ensureStarted(): Promise<void>;
    call<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  };
  openSearchResult(location: SearchResultLocation): Promise<void>;
  openSearchSettings(): void;
  searchModalClosed(modal: VaultSearchModal): void;
}

export class VaultSearchModal extends Modal {
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private resultView!: SearchResultView;
  private session!: SearchSession;

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
    this.resultsEl = this.contentEl.createDiv({ cls: "vault-search-results" });
    this.resultView = new SearchResultView(this.resultsEl,
      location => this.owner.openSearchResult(location));
    this.session = new SearchSession(query => this.search(query), state => this.renderState(state));
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

  private async search(query: string): Promise<SearchResult[]> {
    await this.owner.backend.ensureStarted();
    const response = await this.owner.backend.call<{ results: SearchResult[] }>(
      "search", { query, verbose: true }, 30_000);
    return response.results;
  }

  private renderState(state: SearchSessionState): void {
    if (state.kind === "idle") {
      this.resultsEl.empty();
      return;
    }
    if (state.kind === "loading") {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: "vault-search-empty", text: "검색 중…" });
      return;
    }
    if (state.kind === "results") {
      this.resultView.render(state.results);
      return;
    }
    this.resultsEl.empty();
    const unavailable = this.resultsEl.createDiv({ cls: "vault-search-unavailable" });
    unavailable.createDiv({ text: `검색 서비스를 사용할 수 없습니다: ${state.message}` });
    const button = unavailable.createEl("button", { text: "설정 열기" });
    button.addEventListener("click", () => this.owner.openSearchSettings());
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
