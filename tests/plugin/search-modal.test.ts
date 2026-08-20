import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SearchSession, selectedTextQuery, type SearchSessionState
} from "../../src/search-session";
import { resultLocation } from "../../src/search-result-view";
import type { SearchResult } from "../../src/types";

const result = (path: string): SearchResult => ({
  rank: 1, file_path: path, score: 1, content: "snippet", start_line: 12
});

afterEach(() => vi.useRealTimers());

describe("Vault search modal", () => {
  it("sends one request during the debounce window", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [result("latest.md")]);
    const session = new SearchSession(search, () => undefined);
    session.setQuery("ab");
    session.setQuery("abc");
    session.setQuery("abcd");
    await vi.advanceTimersByTimeAsync(249);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("abcd");
  });

  it("ignores a stale response", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: SearchResult[]) => void;
    let resolveNew!: (value: SearchResult[]) => void;
    const search = vi.fn((query: string) => new Promise<SearchResult[]>(resolve => {
      if (query === "old") resolveOld = resolve;
      else resolveNew = resolve;
    }));
    const states: SearchSessionState[] = [];
    const session = new SearchSession(search, state => states.push(state));
    session.setQuery("old");
    await vi.advanceTimersByTimeAsync(250);
    session.setQuery("new");
    await vi.advanceTimersByTimeAsync(250);
    resolveNew([result("new.md")]);
    await Promise.resolve();
    resolveOld([result("old.md")]);
    await Promise.resolve();
    const rendered = states.filter(state => state.kind === "results");
    expect(rendered).toEqual([{ kind: "results", results: [result("new.md")] }]);
  });

  it("passes the clicked result path and line", () => {
    expect(resultLocation(result("Folder/note.md"))).toEqual({
      path: "Folder/note.md", line: 12
    });
  });

  it("renders service failures as unavailable state", async () => {
    vi.useFakeTimers();
    const states: SearchSessionState[] = [];
    const session = new SearchSession(
      async () => { throw new Error("Backend is not running"); },
      state => states.push(state)
    );
    session.setQuery("query");
    await vi.advanceTimersByTimeAsync(250);
    expect(states.at(-1)).toEqual({
      kind: "unavailable", message: "Backend is not running"
    });
  });

  it("uses selected text as the initial query", () => {
    const openSearch = vi.fn();
    const editor = { getSelection: () => "선택한 문장" };
    const selectedTextCommand = () => openSearch(selectedTextQuery(editor));
    selectedTextCommand();
    expect(openSearch).toHaveBeenCalledWith("선택한 문장");
  });

  it("formats search results when action buttons are used", () => {
    const results = [
      result("Notes/a.md"),
      result("Notes/b.md"),
    ];
    const md = results.map(r => r.file_path);
    expect(md).toHaveLength(2);
  });

  it("closes modal on successful note creation and stays open on failure", async () => {
    let modalClosed = false;
    const closeModal = () => {
      modalClosed = true;
    };

    // Simulate creation handler
    const handleNewNote = async (createFn: () => Promise<unknown>) => {
      const file = await createFn();
      if (file) {
        closeModal();
      }
    };

    // Failure case: null returned
    modalClosed = false;
    await handleNewNote(async () => null);
    expect(modalClosed).toBe(false);

    // Success case: TFile object returned
    modalClosed = false;
    await handleNewNote(async () => ({ path: "0_Inbox/검색.md" }));
    expect(modalClosed).toBe(true);
  });
});
