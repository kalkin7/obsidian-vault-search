import { BackendCallError } from "./backend-manager";
import type { BackendStatus, SearchResult } from "./types";

export interface SearchApiBackend {
  status: BackendStatus;
  call<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

export interface SearchApiOwner {
  backend: SearchApiBackend;
  ensureSearchStarted(): Promise<void>;
}

/** Shared backend-facing search API for the modal and AI item view. */
export class SearchApi {
  constructor(private readonly owner: SearchApiOwner) {}

  async search(query: string): Promise<SearchResult[]> {
    await this.owner.ensureSearchStarted();
    try {
      return await this.runSearch(query);
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.runSearch(query);
      }
      throw error;
    }
  }

  private async runSearch(query: string): Promise<SearchResult[]> {
    const response = await this.owner.backend.call<{ results: SearchResult[] }>(
      "search",
      { query, verbose: true },
      30_000,
    );
    return response.results;
  }
}
