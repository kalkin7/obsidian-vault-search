import type { SearchResult } from "./types";

export type SearchSessionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: SearchResult[] }
  | { kind: "unavailable"; message: string };

export function selectedTextQuery(editor: { getSelection(): string }): string {
  return editor.getSelection();
}

export class SearchSession {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(
    private readonly search: (query: string) => Promise<SearchResult[]>,
    private readonly stateChanged: (state: SearchSessionState) => void,
    private readonly debounceMs = 250
  ) {}

  setQuery(value: string): void {
    const query = value.trim();
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (query.length < 2) {
      this.stateChanged({ kind: "idle" });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.execute(query, generation);
    }, this.debounceMs);
  }

  dispose(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async execute(query: string, generation: number): Promise<void> {
    this.stateChanged({ kind: "loading" });
    try {
      const results = await this.search(query);
      if (generation !== this.generation) return;
      this.stateChanged({ kind: "results", results });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stateChanged({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
