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

  it("renders nested bullet sublists inside one continuous numbered list", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    renderer.render(
      [
        "1. 일반 차량 불법주차",
        "   - 지상 충전소 앞 단속을 계속하고 있습니다.",
        "   - 전기차만 들어오도록 하는 방안이 검토됐습니다.",
        "1. 후문 주변 주차관리",
        "   - 후문 충전소 주변의 임시주차구역 설정을 검토 중입니다.",
        "1. 보험",
        "   - 사고배상책임보험 가입을 확인했습니다.",
      ].join("\n"),
      [],
    );
    const lists = find(container, (node) => node.tag === "ol");
    // One <ol>: the browser numbers the items 1, 2, 3 continuously.
    expect(lists).toHaveLength(1);
    const topItems = lists[0].children.filter((node) => node.tag === "li");
    expect(topItems).toHaveLength(3);
    for (const item of topItems) {
      const nested = item.children.filter((node) => node.tag === "ul");
      expect(nested).toHaveLength(1);
    }
  });

  it("keeps consecutive 1. items in one list so numbering continues", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    renderer.render("1. a\n1. b\n1. c", []);
    const lists = find(container, (node) => node.tag === "ol");
    expect(lists).toHaveLength(1);
    expect(lists[0].children.filter((node) => node.tag === "li")).toHaveLength(
      3,
    );
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

  it("turns [S#] citations into clickable circled-number links and a mapped 근거 list", () => {
    const first: Citation = {
      id: "S1",
      file_path: "5_Wiki/law/지상_화단_전기차충전소_용도변경_요건.md",
      start_line: 42,
      heading_path: ["요약"],
      rank: 1,
      score: 0.8,
    };
    const second: Citation = {
      id: "S2",
      file_path: "5_Wiki/law/지상_화단_전기차충전소_용도변경_요건.md",
      start_line: 45,
      heading_path: ["요약"],
      rank: 2,
      score: 0.7,
    };
    const note = toNoteMarkdown("공사 진행 [S1] 완료 [S2] [S99]", [
      first,
      second,
    ]);
    // Direct one-hop links: inline wikilinks labeled ① (same file deduped).
    expect(note.match(/\|①\]\]/g) ?? []).toHaveLength(2);
    expect(note).not.toContain("②");
    expect(note).toContain("[S99]"); // unknown marker kept as-is
    expect(note).toContain("## 근거");
    expect(note).toContain(
      "- ① [[5_Wiki/law/지상_화단_전기차충전소_용도변경_요건]]",
    );
  });

  it("assigns distinct circled numbers to distinct source files", () => {
    const first: Citation = {
      id: "S1",
      file_path: "5_Wiki/law/a.md",
      start_line: 1,
      heading_path: [],
      rank: 1,
      score: 0.8,
    };
    const second: Citation = {
      id: "S2",
      file_path: "5_Wiki/issues/b.md",
      start_line: 1,
      heading_path: [],
      rank: 2,
      score: 0.7,
    };
    const note = toNoteMarkdown("A [S1] B [S2]", [first, second]);
    expect(note).toContain("[[5_Wiki/law/a|①]]");
    expect(note).toContain("[[5_Wiki/issues/b|②]]");
    expect(note).toContain("- ② [[5_Wiki/issues/b]]");
  });

  it("terminates and renders lone heading markers and 7+ hashes as text", () => {
    const container = makeEl();
    const renderer = new AnswerRenderer(container as unknown as HTMLElement, {
      openCitation: async () => undefined,
    });
    // Regression: "#" alone previously matched the paragraph terminator but
    // not the heading branch, so index never advanced — an infinite loop.
    // The renderer clears the container per call, so render once with
    // blank-line separators.
    renderer.render("#\n\n####\n\n####### text", []);
    const paragraphs = find(
      container,
      (node) => node.cls === "vault-answer-paragraph",
    );
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(
      find(container, (node) => node.textContent === "#").length,
    ).toBeGreaterThan(0);
    expect(
      find(container, (node) => node.textContent === "####").length,
    ).toBeGreaterThan(0);
    expect(
      find(container, (node) => node.textContent === "####### text").length,
    ).toBeGreaterThan(0);
  });

  it("keeps [S#] markers inside code and existing links untouched", () => {
    const citation: Citation = {
      id: "S1",
      file_path: "5_Wiki/law/a.md",
      start_line: 1,
      heading_path: [],
      rank: 1,
      score: 0.8,
    };
    const answer = [
      "코드: `[S1]` 안 건드림",
      "```",
      "[S1]",
      "```",
      "위키링크: [[existing [S1]]]",
      "마크다운 링크: [텍스트 [S1]](https://example.com)",
      "본문 [S1]",
    ].join("\n");
    const note = toNoteMarkdown(answer, [citation]);
    expect(note).toContain("`[S1]`");
    expect(note).toContain("```\n[S1]\n```");
    expect(note).toContain("[[existing [S1]]]");
    expect(note).toContain("[텍스트 [S1]](https://example.com)");
    expect(note).toContain("본문 [[5_Wiki/law/a|①]]");
    expect(note).toContain("## 근거");
  });

  it("escapes Obsidian link metacharacters in citation paths", () => {
    const citation: Citation = {
      id: "S1",
      file_path: "5_Wiki/law/C#.md",
      start_line: 1,
      heading_path: [],
      rank: 1,
      score: 0.8,
    };
    const note = toNoteMarkdown("본문 [S1]", [citation]);
    expect(note).toContain("[[5_Wiki/law/C%23|①]]");
    expect(note).toContain("- ① [[5_Wiki/law/C%23]]");
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
