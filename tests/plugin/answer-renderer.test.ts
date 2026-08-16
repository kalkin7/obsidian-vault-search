import { describe, expect, it } from "vitest";
import { AnswerRenderer, toNoteMarkdown } from "../../src/answer-renderer";
import type { Citation } from "../../src/types";

interface FakeEl {
  children: FakeEl[];
  textContent: string;
  tag: string;
  cls: string;
  handlers: Record<string, () => void>;
  createDiv(options?: Record<string, unknown>): FakeEl;
  createSpan(options?: Record<string, unknown>): FakeEl;
  createEl(tag: string, options?: Record<string, unknown>): FakeEl;
  empty(): void;
  setText(value: string): void;
  addEventListener(type: string, handler: () => void): void;
}

function makeEl(): FakeEl {
  const element: FakeEl = {
    children: [],
    textContent: "",
    tag: "",
    cls: "",
    handlers: {},
    createDiv(options?: Record<string, unknown>): FakeEl {
      return this.createEl("div", options);
    },
    createSpan(options?: Record<string, unknown>): FakeEl {
      return this.createEl("span", options);
    },
    createEl(tag: string, options?: Record<string, unknown>): FakeEl {
      const child = makeEl();
      child.tag = tag;
      child.textContent = String(options?.text ?? "");
      child.cls = String(options?.cls ?? "");
      this.children.push(child);
      return child;
    },
    empty(): void {
      this.children = [];
      this.textContent = "";
    },
    setText(value: string): void {
      this.textContent = value;
    },
    addEventListener(type: string, handler: () => void): void {
      this.handlers[type] = handler;
    },
  };
  return element;
}

function find(el: FakeEl, predicate: (node: FakeEl) => boolean): FakeEl[] {
  const hits: FakeEl[] = [];
  const walk = (node: FakeEl) => {
    if (predicate(node)) hits.push(node);
    for (const child of node.children) walk(child);
  };
  walk(el);
  return hits;
}

describe("AnswerRenderer", () => {
  it("renders markdown blocks, bold, and Google-style citation pills", () => {
    const container = makeEl();
    const citation: Citation = {
      id: "S1",
      file_path: "Notes/state.md",
      start_line: 42,
      heading_path: ["현재 상태"],
      rank: 1,
      score: 0.82,
    };
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    renderer.render("# 제목\n\n**굵게** [S1]\n\n- 항목1\n- 항목2\n\n끝 [S9]", [
      citation,
    ]);

    const headings = find(container, (node) => node.tag === "h3");
    expect(headings).toHaveLength(1);
    // Inline content is rendered into child spans of the block element.
    expect(headings[0].children[0].textContent).toBe("제목");

    const strong = find(container, (node) => node.tag === "strong");
    expect(strong[0].textContent).toBe("굵게");

    const pills = find(
      container,
      (node) => node.cls === "vault-answer-citation",
    );
    expect(pills).toHaveLength(1);
    // Label comes from the heading path; the unknown [S9] stays as plain text.
    expect(pills[0].textContent).toBe("현재 상태");

    const items = find(container, (node) => node.tag === "li");
    expect(items.map((item) => item.children[0].textContent)).toEqual([
      "항목1",
      "항목2",
    ]);
  });

  it("renders markdown tables with a header row", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    renderer.render(
      "| 단계 | 공사 |\n| --- | --- |\n| 1단계 | 조경 변경 |\n| 2단계 | 충전기 설치 |",
      [],
    );
    const table = find(container, (node) => node.tag === "table");
    expect(table).toHaveLength(1);
    const th = find(table[0], (node) => node.tag === "th");
    expect(th.map((cell) => cell.children[0].textContent)).toEqual([
      "단계",
      "공사",
    ]);
    const td = find(table[0], (node) => node.tag === "td");
    expect(td).toHaveLength(4);
  });

  it("renders 4+-hash headings (with or without a space) as h6", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    renderer.render("####지상 설치와 용도변경", []);
    const headings = find(container, (node) => node.tag === "h6");
    expect(headings).toHaveLength(1);
    expect(headings[0].children[0].textContent).toBe("지상 설치와 용도변경");
  });

  it("turns [S#] citations into note-ready wikilinks and appends a 근거 list", () => {
    const citation: Citation = {
      id: "S1",
      file_path: "5_Wiki/issues/apt/지상_전기차충전소_설치_행위허가.md",
      start_line: 42,
      heading_path: ["행위허가"],
      rank: 1,
      score: 0.8,
    };
    const note = toNoteMarkdown("공사가 진행되었습니다. [S1] [S99]", [citation]);
    expect(note).toContain(
      "[[5_Wiki/issues/apt/지상_전기차충전소_설치_행위허가|행위허가]]",
    );
    expect(note).toContain("[S99]"); // unknown marker kept as-is
    expect(note).toContain("## 근거");
    expect(note).toContain(
      "- [[5_Wiki/issues/apt/지상_전기차충전소_설치_행위허가]]",
    );
  });

  it("copy button calls back with the raw answer", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    const answer = "복사할 답변 [S1]";
    let copied = "";
    renderer.render(answer, [], (text) => {
      copied = text;
    });
    const copyButton = find(
      container,
      (node) => node.cls === "vault-answer-copy",
    );
    expect(copyButton).toHaveLength(1);
    copyButton[0].handlers.click?.();
    expect(copied).toBe(answer);
  });
});
