import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    vi.stubGlobal("document", {
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      getAnswerReasoningEffortOptions: () => ["auto", "high", "max"],
      setAnswerReasoningEffort: async () => undefined,
      toggleFavoriteModel: async () => undefined,
      registerAiView: () => undefined,
      unregisterAiView: () => undefined,
    };
    const view = new VaultSearchItemView(new WorkspaceLeaf(), owner);
    expect(view.getViewType()).toBe(VIEW_TYPE_VAULT_AI_SEARCH);
    expect(view.getDisplayText()).toBe("AI Vault Search");
    expect(view.getIcon()).toBe(ICON_LIGHTNING);
    const result = { history: false } satisfies ViewStateResult;
    // The panel is session-scoped: state carries no query to restore.
    await view.setState({ query: "프로젝트 상태" }, result);
    expect(view.getState()).toEqual({});
  });

  it("handles setAnswerReasoningEffort rejection safely without unhandled rejection", async () => {
    let reasoningError: Error | null = null;
    const owner = {
      app: {} as unknown as SearchItemViewOwner["app"],
      settings: {
        ...DEFAULT_SETTINGS,
        answerProvider: "openai" as const,
        answerModel: "o3-mini",
        favoriteAnswerModels: [{ provider: "openai" as const, model: "o3-mini" }],
      },
      backend: {
        status: { state: "ready" as const },
        call: async <T>(): Promise<T> => ({}) as T,
      },
      ensureSearchStarted: async () => undefined,
      openSearchResult: async () => undefined,
      openSearchSettings: () => undefined,
      getAnswerModelOptions: () => [{ value: "openai::o3-mini", label: "o3-mini" }],
      setAnswerModel: async () => undefined,
      getAnswerReasoningEffortOptions: () => ["low", "medium", "high"],
      setAnswerReasoningEffort: async (_effort: string) => {
        throw new Error("Reasoning effort rejected by sidecar");
      },
      toggleFavoriteModel: async () => undefined,
      registerAiView: () => undefined,
      unregisterAiView: () => undefined,
    };

    const view = new VaultSearchItemView(new WorkspaceLeaf(), owner);
    await view.onOpen();

    const effortSelect = (view as any).effortSelect;
    expect(effortSelect).toBeDefined();

    effortSelect.value = "high";
    // Trigger change event
    effortSelect.dispatch?.("change");

    // Since handler is async, allow macrotask/microtask tick
    await new Promise((r) => setTimeout(r, 10));

    expect(effortSelect.disabled).toBe(false);
  });

  it("handles setAnswerModel rejection safely without unhandled rejection", async () => {
    const owner = {
      app: {} as unknown as SearchItemViewOwner["app"],
      settings: {
        ...DEFAULT_SETTINGS,
        answerProvider: "openai" as const,
        answerModel: "gpt-4o",
        favoriteAnswerModels: [
          { provider: "openai" as const, model: "gpt-4o" },
          { provider: "openai" as const, model: "o3-mini" },
        ],
      },
      backend: {
        status: { state: "ready" as const },
        call: async <T>(): Promise<T> => ({}) as T,
      },
      ensureSearchStarted: async () => undefined,
      openSearchResult: async () => undefined,
      openSearchSettings: () => undefined,
      getAnswerModelOptions: () => [
        { value: "openai::gpt-4o", label: "gpt-4o" },
        { value: "openai::o3-mini", label: "o3-mini" },
      ],
      setAnswerModel: async () => {
        throw new Error("Model change rejected by backend");
      },
      getAnswerReasoningEffortOptions: () => ["auto"],
      setAnswerReasoningEffort: async () => undefined,
      toggleFavoriteModel: async () => undefined,
      registerAiView: () => undefined,
      unregisterAiView: () => undefined,
    };

    const view = new VaultSearchItemView(new WorkspaceLeaf(), owner);
    await view.onOpen();

    const modelSelect = (view as any).modelSelect;
    expect(modelSelect).toBeDefined();

    modelSelect.value = "openai::o3-mini";
    modelSelect.dispatch?.("change");

    await new Promise((r) => setTimeout(r, 10));

    expect(modelSelect.disabled).toBe(false);
  });
});
