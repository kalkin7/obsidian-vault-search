import { describe, expect, it } from "vitest";
import { AnswerRenderer } from "../../src/answer-renderer";
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
    const renderer = new AnswerRenderer(
      container as unknown as HTMLElement,
      { openCitation: async () => undefined },
    );
    renderer.render(
      "# 제목\n\n**굵게** [S1]\n\n- 항목1\n- 항목2\n\n끝 [S9]",
      [citation],
    );

    const headings = find(container, (node) => node.tag === "h3");
    expect(headings).toHaveLength(1);
    // Inline content is rendered into child spans of the block element.
    expect(headings[0].children[0].textContent).toBe("제목");

    const strong = find(container, (node) => node.tag === "strong");
    expect(strong[0].textContent).toBe("굵게");

    const pills = find(container, (node) => node.cls === "vault-answer-citation");
    expect(pills).toHaveLength(1);
    // Label comes from the heading path; the unknown [S9] stays as plain text.
    expect(pills[0].textContent).toBe("현재 상태");

    const items = find(container, (node) => node.tag === "li");
    expect(items.map((item) => item.children[0].textContent)).toEqual([
      "항목1",
      "항목2",
    ]);
  });

  it("copy button calls back with the raw answer", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(
      container as unknown as HTMLElement,
      { openCitation: async () => undefined },
    );
    const answer = "복사할 답변 [S1]";
    let copied = "";
    renderer.render(answer, [], (text) => {
      copied = text;
    });
    const copyButton = find(container, (node) => node.cls === "vault-answer-copy");
    expect(copyButton).toHaveLength(1);
    copyButton[0].handlers.click?.();
    expect(copied).toBe(answer);
  });
});
