import { describe, expect, it } from "vitest";
import { WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, VIEW_TYPE_VAULT_AI_SEARCH } from "../../src/constants";
import { VaultSearchItemView } from "../../src/search-item-view";

describe("VaultSearchItemView", () => {
  it("exposes a stable view identity and persisted query state", async () => {
    const owner = {
      app: {},
      settings: { ...DEFAULT_SETTINGS },
      backend: { status: { state: "stopped" as const }, call: async () => ({}) },
      ensureSearchStarted: async () => undefined,
      openSearchResult: async () => undefined,
      openSearchSettings: () => undefined,
      lightningIconSrc: () => "assets/lightning search.png",
      registerAiView: () => undefined,
      unregisterAiView: () => undefined,
    };
    const view = new VaultSearchItemView(new WorkspaceLeaf(), owner);
    expect(view.getViewType()).toBe(VIEW_TYPE_VAULT_AI_SEARCH);
    expect(view.getDisplayText()).toBe("AI Vault Search");
    expect(view.getIcon()).toBe("search");
    await view.setState({ query: "프로젝트 상태" }, {});
    expect(view.getState().query).toBe("프로젝트 상태");
  });
});
