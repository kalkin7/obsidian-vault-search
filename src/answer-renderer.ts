import type { Citation } from "./types";
import type { SearchResultLocation } from "./search-result-view";

export interface AnswerRendererOptions {
  openCitation: (location: SearchResultLocation) => Promise<void>;
}

/** Markdown heading level → rendered element; 4-6 hashes all map to h6.
 *  index 0 = level 1. */
const HEADING_TAGS = ["h3", "h4", "h5", "h6", "h6", "h6"] as const;

/** Block-entry patterns shared by the render loop and the paragraph
 *  terminator. Every pattern requires real content, so a lone marker line
 *  (`#`, `-`, `>`) can never stop a paragraph without being consumed —
 *  which previously caused an infinite render loop. `(?!#)` rejects a
 *  seventh hash (Obsidian renders 7+ hashes as literal text). */
const HEADING_RE = /^(#{1,6})(?!#)[ \t]*(.+)$/;
const BULLET_RE = /^\s*[-*]\s+(.+)$/;
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.+)$/;
const HR_RE = /^\s*(?:---+|\*\*\*+)\s*$/;

function isBlockStart(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    BULLET_RE.test(line) ||
    NUMBERED_RE.test(line) ||
    QUOTE_RE.test(line) ||
    HR_RE.test(line) ||
    line.trim().startsWith("|")
  );
}

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
      const heading = HEADING_RE.exec(line);
      if (heading) {
        const level = heading[1].length;
        const tag = HEADING_TAGS[level - 1] ?? "h6";
        const element = container.createEl(tag, {
          cls: "vault-answer-heading",
        });
        this.renderInline(element, heading[2].trim(), byId, counts);
        index++;
        continue;
      }
      const bullet = BULLET_RE.exec(line);
      const numbered = NUMBERED_RE.exec(line);
      if (bullet || numbered) {
        index = this.renderList(container, lines, index, byId, counts);
        continue;
      }
      const quote = QUOTE_RE.exec(line);
      if (quote) {
        const block = container.createEl("blockquote", {
          cls: "vault-answer-quote",
        });
        this.renderInline(block, quote[1], byId, counts);
        index++;
        continue;
      }
      if (HR_RE.test(line)) {
        container.createEl("hr", { cls: "vault-answer-rule" });
        index++;
        continue;
      }
      if (line.trim().startsWith("|")) {
        index = this.renderTable(container, lines, index, byId, counts);
        continue;
      }
      const paragraph = container.createDiv({ cls: "vault-answer-paragraph" });
      // Always consume the first line (guarantees forward progress); later
      // lines break out only when they start a new block.
      let advanced = false;
      while (index < lines.length && lines[index].trim()) {
        if (advanced && isBlockStart(lines[index])) break;
        if (paragraph.children.length > 0) paragraph.createEl("br");
        this.renderInline(paragraph, lines[index].trim(), byId, counts);
        index++;
        advanced = true;
      }
    }
  }

  /** Leading whitespace width for list nesting: tabs count as 2 spaces so a
   *  tabbed level and a 2-space level compare equal. */
  private listIndent(line: string): number {
    let width = 0;
    for (const char of line) {
      if (char === " ") width += 1;
      else if (char === "\t") width += 2;
      else break;
    }
    return width;
  }

  /** Render a (possibly nested, mixed) list block. Consecutive ordered items
   *  at the same nesting level share ONE <ol>, so the browser numbers them
   *  1, 2, 3… continuously instead of restarting at 1 per item; deeper
   *  indents nest inside the parent item, matching how the markdown renders
   *  in an Obsidian note. */
  private renderList(
    container: HTMLElement,
    lines: string[],
    index: number,
    byId: Map<string, Citation>,
    counts: Map<string, number>,
  ): number {
    interface Frame {
      el: HTMLElement;
      indent: number;
      ordered: boolean;
      lastItem: HTMLElement;
    }
    const stack: Frame[] = [];
    while (index < lines.length) {
      const raw = lines[index];
      const trimmed = raw.trim();
      const bullet = BULLET_RE.exec(trimmed);
      const numbered = NUMBERED_RE.exec(trimmed);
      if (!bullet && !numbered) break;
      const ordered = Boolean(numbered);
      const content = ordered ? numbered![2] : bullet![1];
      const indent = this.listIndent(raw);
      // Leave frames nested deeper than this line.
      while (stack.length > 0 && indent < stack[stack.length - 1].indent) {
        stack.pop();
      }
      // A different marker type at the same level starts a sibling list.
      if (
        stack.length > 0 &&
        indent === stack[stack.length - 1].indent &&
        stack[stack.length - 1].ordered !== ordered
      ) {
        stack.pop();
      }
      if (stack.length > 0 && indent === stack[stack.length - 1].indent) {
        const frame = stack[stack.length - 1];
        const item = frame.el.createEl("li", {
          cls: "vault-answer-list-item",
        });
        this.renderInline(item, content, byId, counts);
        frame.lastItem = item;
      } else {
        const parent =
          stack.length > 0 ? stack[stack.length - 1].lastItem : container;
        const el = parent.createEl(ordered ? "ol" : "ul", {
          cls: "vault-answer-list",
        });
        const item = el.createEl("li", { cls: "vault-answer-list-item" });
        this.renderInline(item, content, byId, counts);
        stack.push({ el, indent, ordered, lastItem: item });
      }
      index++;
    }
    return index;
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

/** Circled endnote markers for the note copy: ①…⑳, then plain digits. */
const CIRCLED_NUMBERS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
  "⑪",
  "⑫",
  "⑬",
  "⑭",
  "⑮",
  "⑯",
  "⑰",
  "⑱",
  "⑲",
  "⑳",
];

/** Spans in which ``[S#]`` markers must never be rewritten: fenced/inline
 *  code and existing wikilinks / markdown links (labels may contain nested
 *  bracket pairs like ``[text [S1]](url)``). */
const PROTECTED_SPAN_RE =
  /(```[\s\S]*?```|`[^`\n]+`|\[\[[^\]]+\]\]|\[(?:[^[\]]|\[[^\]]*\])*\]\([^)]+\))/g;

/** Percent-encode characters that break Obsidian wikilink parsing (`#` starts
 *  a heading anchor, `]` closes the target, `|` starts the alias, `^` a block
 *  ref). Obsidian itself encodes these in the links it generates. */
function escapeWikilinkPath(path: string): string {
  return path
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D")
    .replace(/\|/g, "%7C")
    .replace(/\^/g, "%5E");
}

/** Turn a raw answer (with ``[S#]`` markers) into note-ready markdown: each
 *  known citation becomes an inline wikilink whose label is a circled
 *  endnote number (``[[file|①]]``) — clearly an annotation, and clicking it
 *  opens the source file directly (one hop; pure wikilink, no HTML). A
 *  deduplicated ``## 근거`` list maps each number to its file. Unknown
 *  ``[S#]`` markers are kept as-is, and markers inside code spans/blocks or
 *  existing links are never rewritten. */
export function toNoteMarkdown(answer: string, citations: Citation[]): string {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const fileToNumber = new Map<string, number>();
  const files: string[] = [];
  const numberFor = (citation: Citation): number => {
    let number = fileToNumber.get(citation.file_path);
    if (number === undefined) {
      number = files.length + 1;
      fileToNumber.set(citation.file_path, number);
      files.push(citation.file_path);
    }
    return number;
  };
  const marker = (number: number): string =>
    CIRCLED_NUMBERS[number - 1] ?? String(number);
  const rewriteMarkers = (segment: string): string =>
    segment.replace(/\[S(\d+)\]/g, (match, id: string) => {
      const citation = byId.get(`S${id}`);
      if (!citation) return match;
      const number = numberFor(citation);
      const path = escapeWikilinkPath(citation.file_path.replace(/\.md$/i, ""));
      return `[[${path}|${marker(number)}]]`;
    });
  // Split keeps protected spans at odd indices (the regex captures them), so
  // only the plain-text segments between them get their markers rewritten.
  const inline = answer
    .split(PROTECTED_SPAN_RE)
    .map((segment, segmentIndex) =>
      segmentIndex % 2 === 1 ? segment : rewriteMarkers(segment),
    )
    .join("");
  if (files.length === 0) return inline;
  const list = files.map(
    (file, index) =>
      `- ${marker(index + 1)} [[${escapeWikilinkPath(file.replace(/\.md$/i, ""))}]]`,
  );
  return `${inline}\n\n## 근거\n${list.join("\n")}`;
}
