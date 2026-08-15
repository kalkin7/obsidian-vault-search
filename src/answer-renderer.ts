import type { Citation } from "./types";
import type { SearchResultLocation } from "./search-result-view";

export interface AnswerRendererOptions {
  openCitation: (location: SearchResultLocation) => Promise<void>;
}

/** Safe, DOM-only answer renderer. It never assigns innerHTML or renders raw HTML. */
export class AnswerRenderer {
  constructor(
    private readonly containerEl: HTMLElement,
    private readonly options: AnswerRendererOptions,
  ) {}

  render(answer: string, citations: Citation[]): void {
    this.containerEl.empty();
    const byId = new Map(citations.map((citation) => [citation.id, citation]));
    for (const line of answer.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const paragraph = this.containerEl.createDiv({ cls: "vault-answer-paragraph" });
      this.renderLine(paragraph, line, byId);
    }
  }

  private renderLine(
    parent: HTMLElement,
    line: string,
    citations: Map<string, Citation>,
  ): void {
    let cursor = 0;
    const pattern = /\[S\d+\]/g;
    for (const match of line.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) parent.createSpan({ text: line.slice(cursor, index) });
      const id = match[0].slice(1, -1);
      const citation = citations.get(id);
      if (citation) {
        const button = parent.createEl("button", {
          cls: "vault-answer-citation",
          text: match[0],
          attr: { type: "button", "aria-label": `${citation.file_path}:${citation.start_line}` },
        });
        button.addEventListener("click", () =>
          void this.options.openCitation({
            path: citation.file_path,
            line: Math.max(1, citation.start_line),
          }),
        );
      } else {
        parent.createSpan({ text: match[0] });
      }
      cursor = index + match[0].length;
    }
    if (cursor < line.length) parent.createSpan({ text: line.slice(cursor) });
  }
}
