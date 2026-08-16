import { describe, expect, it } from "vitest";
import { WorkspaceLeaf, type ViewStateResult } from "obsidian";
import {
  DEFAULT_SETTINGS,
  VIEW_TYPE_VAULT_AI_SEARCH,
} from "../../src/constants";
import { ICON_LIGHTNING } from "../../src/icons";
import {
  type SearchItemViewOwner,
  VaultSearchItemView,
} from "../../src/search-item-view";

describe("VaultSearchItemView", () => {
  it("exposes a stable view identity and persisted query state", async () => {
    const owner = {
      app: {} as unknown as SearchItemViewOwner["app"],
      settings: { ...DEFAULT_SETTINGS },
      backend: {
        status: { state: "stopped" as const },
        call: async <T>(
          _method: string,
          _params?: Record<string, unknown>,
          _timeoutMs?: number,
        ): Promise<T> => ({}) as T,
      },
      ensureSearchStarted: async () => undefined,
      openSearchResult: async () => undefined,
      openSearchSettings: () => undefined,
      getAnswerModelOptions: () => [],
      setAnswerModel: async () => undefined,
      registerAiView: () => undefined,
      unregisterAiView: () => undefined,
    };
    const view = new VaultSearchItemView(new WorkspaceLeaf(), owner);
    expect(view.getViewType()).toBe(VIEW_TYPE_VAULT_AI_SEARCH);
    expect(view.getDisplayText()).toBe("AI Vault Search");
    expect(view.getIcon()).toBe(ICON_LIGHTNING);
    const result = { history: false } satisfies ViewStateResult;
    await view.setState({ query: "프로젝트 상태" }, result);
    expect(view.getState().query).toBe("프로젝트 상태");
  });
});
