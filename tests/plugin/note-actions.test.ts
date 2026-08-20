import { describe, expect, it, vi } from "vitest";
import type { App, Editor, MarkdownView, TFile } from "obsidian";
import {
  copyMarkdownToClipboard,
  createNoteFromMarkdown,
  extractCleanNoteTitleAndBody,
  formatSearchResultsMarkdown,
  getFormattedTimestamp,
  insertMarkdownToActiveNote,
  sanitizeNoteTitle,
} from "../../src/note-actions";
import type { SearchResult } from "../../src/types";

describe("note-actions", () => {
  it("extracts clean title from H1 and strips H1 line from body", () => {
    const input = "# 전기직무고시 점검 및 최근 변경사항 정리\n\n## 1. 핵심 결론\n내용입니다.";
    const result = extractCleanNoteTitleAndBody("기본 제목", input);
    expect(result.title).toBe("전기직무고시 점검 및 최근 변경사항 정리");
    expect(result.body).toBe("## 1. 핵심 결론\n내용입니다.");
  });

  it("uses fallback title when no H1 heading exists", () => {
    const input = "## 1. 섹션\n내용입니다.";
    const result = extractCleanNoteTitleAndBody("검색 결과: 테스트", input);
    expect(result.title).toBe("검색 결과 테스트");
    expect(result.body).toBe(input);
  });

  it("sanitizes note titles safely", () => {
    expect(sanitizeNoteTitle("질문: 이것은 무엇인가요?")).toBe("질문 이것은 무엇인가요");
    expect(sanitizeNoteTitle("   ")).toBe("검색 결과");
    expect(sanitizeNoteTitle("특수/문자\\테스트*<바꿔>")).toBe("특수 문자 테스트 바꿔");
  });

  it("formats timestamp as YYYY-MM-DD_HH-mm-ss", () => {
    const fixedDate = new Date(2026, 7, 20, 15, 30, 45); // August is month 7 (0-indexed)
    expect(getFormattedTimestamp(fixedDate)).toBe("2026-08-20_15-30-45");
  });

  it("formats search results into structured markdown list", () => {
    const results: SearchResult[] = [
      {
        file_path: "5_Wiki/issues/전기차_충전소.md",
        start_line: 10,
        heading_path: ["운영", "충전기 안내"],
        rank: 1,
        score: 0.95,
        content: "지상 충전소 안내 사항입니다.\n다음 줄 내용.",
      },
      {
        file_path: "Notes/simple.md",
        start_line: 1,
        heading_path: [],
        rank: 2,
        score: 0.85,
        content: "단순 노트 내용입니다.",
      },
    ];

    const md = formatSearchResultsMarkdown("전기차 충전소", results);
    expect(md).toContain("## 🔍 볼트 검색: 전기차 충전소");
    expect(md).toContain("총 2개 결과");
    expect(md).toContain("- [[5_Wiki/issues/전기차_충전소#운영#충전기 안내|전기차_충전소 › 운영 › 충전기 안내]]");
    expect(md).toContain("> 지상 충전소 안내 사항입니다. 다음 줄 내용.");
    expect(md).toContain("- [[Notes/simple|simple]]");
    expect(md).toContain("> 단순 노트 내용입니다.");
  });

  it("formats empty search results gracefully", () => {
    const md = formatSearchResultsMarkdown("없는 검색어", []);
    expect(md).toContain("## 🔍 볼트 검색: 없는 검색어");
    expect(md).toContain("검색 결과가 없습니다.");
  });

  it("creates a new note in vault and opens in new tab", async () => {
    const createdFiles: Record<string, string> = {};
    let openedFile: TFile | null = null;

    const fakeApp = {
      vault: {
        getAbstractFileByPath: vi.fn(() => null),
        createFolder: vi.fn(async () => undefined),
        create: vi.fn(async (path: string, content: string) => {
          createdFiles[path] = content;
          return { path, basename: path.split("/").pop()?.replace(/\.md$/, "") } as TFile;
        }),
      },
      workspace: {
        getLeaf: vi.fn(() => ({
          openFile: vi.fn(async (file: TFile) => {
            openedFile = file;
          }),
        })),
      },
    } as unknown as App;

    const file = await createNoteFromMarkdown(fakeApp, {
      title: "질문: 테스트 노트 정리해줘",
      content: "# 실제 생성된 제목\n\n내용입니다",
      folder: "AI Vault Search/Notes",
      openInNewTab: true,
    });

    expect(file).not.toBeNull();
    expect(fakeApp.vault.createFolder).toHaveBeenCalledWith("AI Vault Search/Notes");
    expect(fakeApp.vault.create).toHaveBeenCalled();
    expect(openedFile).toBe(file);
    const createdPath = Object.keys(createdFiles)[0];
    expect(createdPath).toBe("AI Vault Search/Notes/실제 생성된 제목.md");
    expect(createdFiles[createdPath]).toContain("---");
    expect(createdFiles[createdPath]).toContain("created:");
    expect(createdFiles[createdPath]).not.toContain('title: "실제 생성된 제목"');
    expect(createdFiles[createdPath]).not.toContain("# 실제 생성된 제목");
    expect(createdFiles[createdPath]).toContain("내용입니다");
  });

  it("uses Obsidian's configured new note folder from fileManager.getNewFileParent", async () => {
    const createdFiles: Record<string, string> = {};
    const fakeApp = {
      vault: {
        getAbstractFileByPath: vi.fn((p: string) => p === "0_Inbox" ? {} : null),
        createFolder: vi.fn(async () => undefined),
        create: vi.fn(async (path: string, content: string) => {
          createdFiles[path] = content;
          return { path, basename: path.split("/").pop()?.replace(/\.md$/, "") } as TFile;
        }),
      },
      fileManager: {
        getNewFileParent: vi.fn(() => ({ path: "0_Inbox" })),
      },
      workspace: {
        getActiveFile: vi.fn(() => null),
        getLeaf: vi.fn(() => ({
          openFile: vi.fn(async () => undefined),
        })),
      },
    } as unknown as App;

    const file = await createNoteFromMarkdown(fakeApp, {
      title: "인박스 노트",
      content: "# 인박스 내용\n\n본문입니다.",
    });

    expect(file).not.toBeNull();
    const createdPath = Object.keys(createdFiles)[0];
    expect(createdPath).toBe("0_Inbox/인박스 내용.md");
    expect(createdFiles[createdPath]).toContain("created:");
    expect(createdFiles[createdPath]).not.toContain("# 인박스 내용");
    expect(createdFiles[createdPath]).toContain("본문입니다.");
  });

  it("preserves selection and inserts markdown at selection end without overwriting", () => {
    let rangeInserted = "";
    let insertedPos = null;
    const fakeEditor = {
      getSelection: vi.fn(() => "선택된 원본 텍스트"),
      somethingSelected: vi.fn(() => true),
      getCursor: vi.fn((pos?: string) => pos === "to" ? { line: 1, ch: 10 } : { line: 0, ch: 0 }),
      getValue: vi.fn(() => "줄1\n선택된 원본 텍스트\n줄3"),
      getLine: vi.fn(() => "선택된 원본 텍스트"),
      replaceSelection: vi.fn(),
      replaceRange: vi.fn((text: string, pos: unknown) => {
        rangeInserted = text;
        insertedPos = pos;
      }),
    } as unknown as Editor;

    const fakeApp = {
      workspace: {
        getActiveViewOfType: vi.fn(() => ({
          editor: fakeEditor,
        } as unknown as MarkdownView)),
      },
    } as unknown as App;

    const result = insertMarkdownToActiveNote(fakeApp, "새로운 내용");
    expect(result).toBe(true);
    expect(fakeEditor.replaceSelection).not.toHaveBeenCalled();
    expect(fakeEditor.replaceRange).toHaveBeenCalled();
    expect(insertedPos).toEqual({ line: 1, ch: 10 });
    expect(rangeInserted).toContain("새로운 내용");
  });

  it("inserts markdown at cursor when nothing is selected", () => {
    let rangeInserted = "";
    const fakeEditor = {
      getSelection: vi.fn(() => ""),
      somethingSelected: vi.fn(() => false),
      getCursor: vi.fn(() => ({ line: 2, ch: 0 })),
      getValue: vi.fn(() => "줄1\n줄2\n줄3"),
      getLine: vi.fn(() => "줄3"),
      replaceRange: vi.fn((text: string) => {
        rangeInserted = text;
      }),
    } as unknown as Editor;

    const fakeApp = {
      workspace: {
        getActiveViewOfType: vi.fn(() => ({
          editor: fakeEditor,
        } as unknown as MarkdownView)),
      },
    } as unknown as App;

    const result = insertMarkdownToActiveNote(fakeApp, "삽입할 내용");
    expect(result).toBe(true);
    expect(fakeEditor.replaceRange).toHaveBeenCalled();
    expect(rangeInserted).toContain("삽입할 내용");
  });

  it("returns false when no active markdown editor exists", () => {
    const fakeApp = {
      workspace: {
        getActiveViewOfType: vi.fn(() => null),
      },
    } as unknown as App;

    const result = insertMarkdownToActiveNote(fakeApp, "삽입할 내용");
    expect(result).toBe(false);
  });

  it("copies markdown to clipboard using navigator.clipboard on success", async () => {
    let clipboardText = "";
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
    });

    let notifiedOk: boolean | null = null;
    const ok = await copyMarkdownToClipboard("복사 내용", (status) => {
      notifiedOk = status;
    });

    expect(ok).toBe(true);
    expect(clipboardText).toBe("복사 내용");
    expect(notifiedOk).toBe(true);
  });

  it("falls back to execCommand when navigator.clipboard fails and succeeds", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("Clipboard write permission denied");
        }),
      },
    });

    const fakeArea = {
      value: "",
      style: {} as Record<string, string>,
      select: vi.fn(),
      remove: vi.fn(),
    };
    const prevDoc = (globalThis as unknown as { document: unknown }).document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: vi.fn(() => fakeArea),
      body: {
        append: vi.fn(),
      },
      execCommand: vi.fn(() => true),
    };

    try {
      let notifiedOk: boolean | null = null;
      const ok = await copyMarkdownToClipboard("폴백 복사 내용", (status) => {
        notifiedOk = status;
      });

      expect(ok).toBe(true);
      expect(fakeArea.select).toHaveBeenCalled();
      expect(fakeArea.remove).toHaveBeenCalled();
      expect(notifiedOk).toBe(true);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });

  it("returns false and notifies failure when both navigator and fallback fail", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("Clipboard error");
        }),
      },
    });

    const fakeArea = {
      value: "",
      style: {} as Record<string, string>,
      select: vi.fn(),
      remove: vi.fn(),
    };
    const prevDoc = (globalThis as unknown as { document: unknown }).document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: vi.fn(() => fakeArea),
      body: {
        append: vi.fn(),
      },
      execCommand: vi.fn(() => false),
    };

    try {
      let notifiedOk: boolean | null = null;
      const ok = await copyMarkdownToClipboard("실패 내용", (status) => {
        notifiedOk = status;
      });

      expect(ok).toBe(false);
      expect(fakeArea.select).toHaveBeenCalled();
      expect(fakeArea.remove).toHaveBeenCalled();
      expect(notifiedOk).toBe(false);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });
});
