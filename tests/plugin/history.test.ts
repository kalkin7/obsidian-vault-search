import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import {
  buildHistoryNote,
  deleteHistory,
  historyFileName,
  historyTitle,
  listHistory,
  loadHistory,
  normalizeHistoryFolder,
  parseHistoryNote,
  pruneHistory,
  saveHistory,
  type HistorySession,
} from "../../src/history";
import type { Citation } from "../../src/types";

/** In-memory Vault stand-in: folders + files keyed by normalized path. */
function fakeVault() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const vault = {
    getAbstractFileByPath(path: string) {
      const normalized = normalizeHistoryFolder(path);
      if (!folders.has(normalized)) return null;
      const children = [...files.keys()]
        .filter((file) => file.startsWith(`${normalized}/`))
        .map((file) => ({
          path: file,
          extension: file.split(".").pop(),
        }));
      return { children };
    },
    getFileByPath(path: string) {
      const normalized = normalizeHistoryFolder(path);
      return files.has(normalized) ? { path: normalized } : null;
    },
    async read(file: { path: string }) {
      return files.get(file.path) ?? "";
    },
    async create(path: string, content: string) {
      const normalized = normalizeHistoryFolder(path);
      files.set(normalized, content);
      return { path: normalized };
    },
    async process(file: { path: string }, fn: (data: string) => string) {
      files.set(file.path, fn(files.get(file.path) ?? ""));
    },
    async delete(file: { path: string }) {
      files.delete(file.path);
    },
    async createFolder(path: string) {
      folders.add(normalizeHistoryFolder(path));
    },
  };
  return { vault: vault as unknown as Vault, files, folders };
}

const sampleCitations: Citation[] = [
  {
    id: "S1",
    file_path: "5_Wiki/law/지상_화단_전기차충전소_용도변경_요건.md",
    start_line: 42,
    heading_path: ["요약"],
    rank: 1,
    score: 0.8,
  },
  {
    id: "S2",
    file_path: "5_Wiki/law/C#.md",
    start_line: 7,
    heading_path: [],
    rank: 2,
    score: 0.6,
  },
];

function sampleSession(): HistorySession {
  return {
    title: "지상 화단 전기차 충전소",
    created: "2025-01-28T14:30:00.000Z",
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    reasoningEffort: "none",
    messages: [
      {
        role: "user",
        content: "지상 화단에 전기차 충전소를 설치할 수 있나요?",
      },
      {
        role: "assistant",
        content: "공사 진행 [S1] [S2]\n\n## 참고\n- 요약 [S1]",
      },
    ],
    citations: sampleCitations,
  };
}

describe("historyTitle", () => {
  it("derives a readable fragment from the first words", () => {
    expect(historyTitle("지상 화단에 전기차 충전소를 설치할 수 있나요?")).toBe(
      "지상 화단에 전기차 충전소를 설치할 수 있나요",
    );
  });

  it("strips filename-hostile characters and collapses whitespace", () => {
    expect(historyTitle("질문/1: *특수* <문자>? [S1] #해시^캐럿|파이프")).toBe(
      "질문 1 특수 문자 S1 해시 캐럿 파이프",
    );
  });

  it("falls back to 대화 for empty input and caps at 60 chars", () => {
    expect(historyTitle("   ")).toBe("대화");
    expect(historyTitle("a".repeat(200))).toHaveLength(60);
  });
});

describe("normalizeHistoryFolder", () => {
  it("trims slashes and defaults", () => {
    expect(normalizeHistoryFolder(" history/ ")).toBe("history");
    expect(normalizeHistoryFolder("")).toBe("AI Vault Search/history");
    expect(normalizeHistoryFolder("  ")).toBe("AI Vault Search/history");
    expect(normalizeHistoryFolder("a\\b")).toBe("a/b");
  });
});

describe("historyFileName", () => {
  it("produces 제목@YYYY-MM-DD_HH-MM-SS.md", () => {
    const name = historyFileName("지상 화단 질문", "2025-01-28T14:30:45.000Z");
    // Local-time stamp; at least assert shape and extension.
    expect(name).toMatch(
      /^지상 화단 질문@\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/,
    );
  });
});

describe("buildHistoryNote / parseHistoryNote", () => {
  it("round-trips messages, multi-line content, and citations", () => {
    const session = sampleSession();
    const note = buildHistoryNote(session);
    expect(note.startsWith("---\n")).toBe(true);
    // Body shows the converted, note-ready answer (① wikilinks + 근거).
    expect(note).toContain("## Q");
    expect(note).toContain("## A");
    expect(note).toContain(
      "[[5_Wiki/law/지상_화단_전기차충전소_용도변경_요건|①]]",
    );
    expect(note).toContain("## 근거");
    expect(note).toContain("[[5_Wiki/law/C%23]]");

    const parsed = parseHistoryNote(note);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe(session.title);
    expect(parsed!.created).toBe(session.created);
    expect(parsed!.provider).toBe(session.provider);
    expect(parsed!.model).toBe(session.model);
    expect(parsed!.reasoningEffort).toBe(session.reasoningEffort);
    expect(parsed!.messages).toEqual(session.messages);
    expect(parsed!.citations).toEqual(session.citations);
  });

  it("preserves trailing newlines and hash/quote content in messages", () => {
    const session = sampleSession();
    session.messages[1].content = "답변\n\n# 제목\n```\n코드 [S1]\n```\n\n끝\n";
    const parsed = parseHistoryNote(buildHistoryNote(session));
    expect(parsed!.messages[1].content).toBe(session.messages[1].content);
  });

  it("returns null for non-history notes", () => {
    expect(parseHistoryNote("# 그냥 노트\n\n내용")).toBeNull();
    expect(parseHistoryNote("")).toBeNull();
  });
});

describe("vault I/O", () => {
  it("saves, lists (newest first), loads, and deletes", async () => {
    const { vault, folders } = fakeVault();
    const folder = "AI Vault Search/history";
    const older = {
      ...sampleSession(),
      title: "오래된 대화",
      created: "2025-01-27T09:00:00.000Z",
    };
    const newer = {
      ...sampleSession(),
      title: "최신 대화",
      created: "2025-01-28T18:00:00.000Z",
    };
    const oldPath = await saveHistory(vault, folder, older);
    const newPath = await saveHistory(vault, folder, newer);
    expect(folders.has("AI Vault Search/history")).toBe(true);
    expect(oldPath).not.toBe(newPath);

    const metas = await listHistory(vault, folder);
    expect(metas.map((meta) => meta.title)).toEqual([
      "최신 대화",
      "오래된 대화",
    ]);
    expect(metas[0].messageCount).toBe(2);

    const loaded = await loadHistory(vault, newPath);
    expect(loaded?.title).toBe("최신 대화");

    await deleteHistory(vault, newPath);
    const after = await listHistory(vault, folder);
    expect(after.map((meta) => meta.title)).toEqual(["오래된 대화"]);
  });

  it("upserts a session with the same created timestamp", async () => {
    const { vault, files } = fakeVault();
    const session = sampleSession();
    await saveHistory(vault, "h", session);
    const updated: HistorySession = {
      ...session,
      messages: [
        ...session.messages,
        { role: "user" as const, content: "추가 질문" },
      ],
    };
    const path = await saveHistory(vault, "h", updated);
    const loaded = await loadHistory(vault, path);
    expect(loaded!.messages).toHaveLength(3);
    expect(files.size).toBe(1);
  });

  it("prunes to maxEntries (0 = keep all)", async () => {
    const { vault } = fakeVault();
    const folder = "h";
    for (let index = 0; index < 4; index++) {
      await saveHistory(vault, folder, {
        ...sampleSession(),
        title: `대화 ${index}`,
        created: `2025-01-2${index}T09:00:00.000Z`,
      });
    }
    expect((await listHistory(vault, folder)).length).toBe(4);
    await pruneHistory(vault, folder, 2);
    const remaining = await listHistory(vault, folder);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((meta) => meta.title)).toEqual(["대화 3", "대화 2"]);
    await pruneHistory(vault, folder, 0);
    expect((await listHistory(vault, folder)).length).toBe(2);
  });
});
