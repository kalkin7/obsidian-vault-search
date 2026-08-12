import type { SearchResult } from "./types";

export interface SearchResultLocation {
  path: string;
  line: number;
}

export function resultLocation(result: SearchResult): SearchResultLocation {
  return { path: result.file_path, line: Math.max(1, result.start_line ?? 1) };
}

export class SearchResultView {
  constructor(
    private readonly containerEl: HTMLElement,
    private readonly openResult: (location: SearchResultLocation) => Promise<void>
  ) {}

  render(results: SearchResult[]): void {
    this.containerEl.empty();
    if (results.length === 0) {
      this.containerEl.createDiv({ cls: "vault-search-empty", text: "검색 결과가 없습니다." });
      return;
    }
    for (const result of results) {
      const location = resultLocation(result);
      const item = this.containerEl.createEl("button", { cls: "vault-search-result" });
      const header = item.createDiv({ cls: "vault-search-result-header" });
      header.createSpan({
        cls: "vault-search-result-file",
        text: result.file_path.split("/").pop()?.replace(/\.md$/i, "") || result.file_path
      });
      const badges = header.createSpan({ cls: "vault-search-result-badges" });
      for (const channel of result.channels ?? []) {
        badges.createSpan({ cls: "vault-search-channel", text: channel });
      }
      const heading = result.heading_path?.filter(Boolean).join(" › ");
      if (heading) item.createDiv({ cls: "vault-search-result-heading", text: heading });
      item.createDiv({ cls: "vault-search-result-snippet", text: result.content.replace(/\s+/g, " ").trim() });
      item.addEventListener("click", () => void this.openResult(location));
    }
  }
}
