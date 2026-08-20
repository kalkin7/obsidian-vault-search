import { describe, expect, it, vi } from "vitest";
import type { App, Editor, MarkdownView, TFile } from "obsidian";
import {
  copyMarkdownToClipboard,
  createNoteFromMarkdown,
  formatSearchResultsMarkdown,
  getFormattedTimestamp,
  insertMarkdownToActiveNote,
  sanitizeNoteTitle,
} from "../../src/note-actions";
import type { SearchResult } from "../../src/types";

describe("note-actions", () => {
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
      title: "테스트 노트",
      content: "# 내용입니다",
      folder: "AI Vault Search/Notes",
      openInNewTab: true,
    });

    expect(file).not.toBeNull();
    expect(fakeApp.vault.createFolder).toHaveBeenCalledWith("AI Vault Search/Notes");
    expect(fakeApp.vault.create).toHaveBeenCalled();
    expect(openedFile).toBe(file);
    const createdPath = Object.keys(createdFiles)[0];
    expect(createdPath).toMatch(/^AI Vault Search\/Notes\/테스트 노트@\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
    expect(createdFiles[createdPath]).toBe("# 내용입니다");
  });

  it("inserts markdown into active editor replacing selection", () => {
    let replacedText = "";
    const fakeEditor = {
      getSelection: vi.fn(() => "선택된 영역"),
      somethingSelected: vi.fn(() => true),
      replaceSelection: vi.fn((text: string) => {
        replacedText = text;
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
    expect(fakeEditor.replaceSelection).toHaveBeenCalledWith("새로운 내용");
    expect(replacedText).toBe("새로운 내용");
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

  it("copies markdown to clipboard using navigator.clipboard", async () => {
    let clipboardText = "";
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
    });

    let notifiedOk = false;
    const ok = await copyMarkdownToClipboard("복사 내용", (status) => {
      notifiedOk = status;
    });

    expect(ok).toBe(true);
    expect(clipboardText).toBe("복사 내용");
    expect(notifiedOk).toBe(true);
  });
});
