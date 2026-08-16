import type { Citation } from "./types";
import type { SearchResultLocation } from "./search-result-view";

export interface AnswerRendererOptions {
  openCitation: (location: SearchResultLocation) => Promise<void>;
}

/** Markdown heading level → rendered element; 4-6 hashes all map to h6.
 *  index 0 = level 1. */
const HEADING_TAGS = ["h3", "h4", "h5", "h6", "h6", "h6"] as const;

/** Google-AI-mode-style renderer: lightweight markdown (headings, lists,
 *  bold, inline code, quotes) with clickable citation pills (source name,
 *  "+N" when the same file is cited several times). DOM-only — never assigns
 *  innerHTML. Answer text stays fully selectable. */
export class AnswerRenderer {
  constructor(
    private readonly containerEl: HTMLElement,
    private readonly options: AnswerRendererOptions,
  ) {}

  render(
    answer: string,
    citations: Citation[],
    onCopy?: (text: string) => void,
  ): void {
    this.containerEl.empty();
    const byId = new Map(citations.map((citation) => [citation.id, citation]));
    const counts = this.fileCounts(citations);
    const toolbar = this.containerEl.createDiv({
      cls: "vault-answer-toolbar",
    });
    if (onCopy) {
      const copy = toolbar.createEl("button", {
        text: "답변 복사",
        cls: "vault-answer-copy",
        attr: { type: "button", "aria-label": "답변 전체 텍스트 복사" },
      });
      copy.addEventListener("click", () => {
        onCopy(answer);
        copy.setText("복사됨 ✓");
        globalThis.setTimeout(() => copy.setText("답변 복사"), 1500);
      });
    }
    const body = this.containerEl.createDiv({ cls: "vault-answer-body" });
    this.renderBlocks(body, answer, byId, counts);
  }

  private renderBlocks(
    container: HTMLElement,
    answer: string,
    byId: Map<string, Citation>,
    counts: Map<string, number>,
  ): void {
    const lines = answer.split(/\r?\n/);
    let index = 0;
    while (index < lines.length) {
      const line = lines[index].trimEnd();
      if (!line.trim()) {
        index++;
        continue;
      }
      const heading = /^(#{1,6})[ \t]?(.+)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const tag = HEADING_TAGS[level - 1] ?? "h5";
        const element = container.createEl(tag, {
          cls: "vault-answer-heading",
        });
        this.renderInline(element, heading[2].trim(), byId, counts);
        index++;
        continue;
      }
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      const numbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        const list = container.createEl(ordered ? "ol" : "ul", {
          cls: "vault-answer-list",
        });
        while (index < lines.length) {
          const nextBullet = /^\s*[-*]\s+(.+)$/.exec(lines[index]);
          const nextNumbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(lines[index]);
          const itemMatch = ordered ? nextNumbered : nextBullet;
          if (!itemMatch) break;
          const item = list.createEl("li", { cls: "vault-answer-list-item" });
          // ordered captures the number in group 1 and the content in group 2.
          this.renderInline(
            item,
            ordered ? itemMatch[2] : itemMatch[1],
            byId,
            counts,
          );
          index++;
        }
        continue;
      }
      const quote = /^\s*>\s?(.+)$/.exec(line);
      if (quote) {
        const block = container.createEl("blockquote", {
          cls: "vault-answer-quote",
        });
        this.renderInline(block, quote[1], byId, counts);
        index++;
        continue;
      }
      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
        container.createEl("hr", { cls: "vault-answer-rule" });
        index++;
        continue;
      }
      if (line.trim().startsWith("|")) {
        index = this.renderTable(container, lines, index, byId, counts);
        continue;
      }
      const paragraph = container.createDiv({ cls: "vault-answer-paragraph" });
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(?:#{1,6})[ \t]?|^\s*[-*]\s+|^\s*\d+[.)]\s+|^\s*>\s?|^\s*\|/.test(
          lines[index],
        )
      ) {
        if (paragraph.children.length > 0) paragraph.createEl("br");
        this.renderInline(paragraph, lines[index].trim(), byId, counts);
        index++;
      }
    }
  }

  private renderTable(
    container: HTMLElement,
    lines: string[],
    index: number,
    byId: Map<string, Citation>,
    counts: Map<string, number>,
  ): number {
    const rows: string[][] = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      const parts = lines[index].trim().split("|");
      // Drop only the empty edge segments (leading "" before the first | and
      // trailing "" after the last |) so rows without a trailing pipe keep
      // their final cell.
      let start = 0;
      let end = parts.length;
      if (parts.length > 1 && parts[0].trim() === "") start = 1;
      if (parts.length > 1 && parts.at(-1)?.trim() === "") end -= 1;
      rows.push(parts.slice(start, end).map((cell) => cell.trim()));
      index++;
    }
    const isSeparator = (cells: string[]) =>
      cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
    const header = rows.length >= 2 && isSeparator(rows[1]) ? rows[0] : null;
    const body = header ? rows.slice(2) : rows;
    const table = container.createEl("table", { cls: "vault-answer-table" });
    if (header) {
      const thead = table.createEl("thead");
      const row = thead.createEl("tr");
      for (const cell of header) {
        const th = row.createEl("th");
        this.renderInline(th, cell, byId, counts);
      }
    }
    const tbody = table.createEl("tbody");
    for (const cells of body) {
      const row = tbody.createEl("tr");
      for (const cell of cells) {
        const td = row.createEl("td");
        this.renderInline(td, cell, byId, counts);
      }
    }
    return index;
  }

  private renderInline(
    parent: HTMLElement,
    text: string,
    byId: Map<string, Citation>,
    counts: Map<string, number>,
  ): void {
    const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
    let cursor = 0;
    for (const match of text.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      if (index > cursor)
        parent.createSpan({ text: text.slice(cursor, index) });
      const token = match[0];
      if (token.startsWith("**")) {
        parent.createEl("strong", { text: token.slice(2, -2) });
      } else if (token.startsWith("`")) {
        parent.createEl("code", { text: token.slice(1, -1) });
      } else {
        const id = token.slice(1, -1);
        const citation = byId.get(id);
        if (citation) {
          parent
            .createEl("button", {
              cls: "vault-answer-citation",
              text: this.citationLabel(citation, counts),
              attr: {
                type: "button",
                "aria-label": `${citation.file_path}:${citation.start_line}`,
              },
            })
            .addEventListener(
              "click",
              () =>
                void this.options.openCitation({
                  path: citation.file_path,
                  line: Math.max(1, citation.start_line),
                }),
            );
        } else {
          parent.createSpan({ text: token });
        }
      }
      cursor = index + token.length;
    }
    if (cursor < text.length) parent.createSpan({ text: text.slice(cursor) });
  }

  private citationLabel(
    citation: Citation,
    counts: Map<string, number>,
  ): string {
    const name =
      citation.heading_path.length > 0
        ? citation.heading_path[0]
        : this.fileStem(citation.file_path);
    const count = counts.get(citation.file_path) ?? 1;
    return count > 1 ? `${name} +${count}` : name;
  }

  private fileStem(filePath: string): string {
    const base = filePath.split("/").pop() ?? filePath;
    return base.replace(/\.md$/i, "");
  }

  private fileCounts(citations: Citation[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const citation of citations) {
      counts.set(citation.file_path, (counts.get(citation.file_path) ?? 0) + 1);
    }
    return counts;
  }
}

/** Turn a raw answer (with ``[S#]`` markers) into note-ready markdown:
 *  every known citation becomes an Obsidian wikilink to its vault file, and a
 *  deduplicated ``## 근거`` list of the cited files is appended. Unknown
 *  ``[S#]`` markers are kept as-is. */
export function toNoteMarkdown(answer: string, citations: Citation[]): string {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const wikilink = (citation: Citation): string => {
    const path = citation.file_path.replace(/\.md$/i, "");
    const rawLabel =
      citation.heading_path.length > 0
        ? citation.heading_path[0]
        : (path.split("/").pop() ?? path);
    return `[[${path}|${rawLabel.replace(/\|/g, "·")}]]`;
  };
  const text = answer.replace(/\[S(\d+)\]/g, (match, id: string) => {
    const citation = byId.get(`S${id}`);
    return citation ? wikilink(citation) : match;
  });
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const citation of citations) {
    if (seen.has(citation.file_path)) continue;
    seen.add(citation.file_path);
    sources.push(`- [[${citation.file_path.replace(/\.md$/i, "")}]]`);
  }
  if (sources.length === 0) return text;
  return `${text}\n\n## 근거\n${sources.join("\n")}`;
}
