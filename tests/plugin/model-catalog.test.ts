import { describe, expect, it } from "vitest";
import {
  chooseProviderModel,
  isSelectableAnswerModel,
  normalizeProviderModels,
} from "../../src/model-catalog";

describe("answer model catalog", () => {
  it("keeps OpenAI text/chat models and excludes non-chat models", () => {
    expect(isSelectableAnswerModel("openai", "gpt-live-transcribe")).toBe(
      false,
    );
    expect(
      normalizeProviderModels("openai", [
        { id: "gpt-live-transcribe", created: 999 },
        { id: "gpt-5.6", created: 100 },
        { id: "gpt-4.1", created: 200 },
        { id: "text-embedding-3-large", created: 300 },
        { id: "gpt-4o-realtime-preview", created: 400 },
        { id: "o5-mini", created: 150 },
      ]),
    ).toEqual(["gpt-4.1", "o5-mini", "gpt-5.6"]);
  });

  it("drops dated OpenAI snapshot ids in favor of the undated alias", () => {
    expect(isSelectableAnswerModel("openai", "gpt-4o-2024-08-06")).toBe(false);
    expect(isSelectableAnswerModel("openai", "gpt-4.1-2025-04-14")).toBe(false);
    expect(isSelectableAnswerModel("openai", "o3-2025-04-16")).toBe(false);
    expect(isSelectableAnswerModel("openai", "chatgpt-4o-latest")).toBe(true);
    expect(isSelectableAnswerModel("openai", "codex-mini-latest")).toBe(true);
    expect(isSelectableAnswerModel("openai", "gpt-4o")).toBe(true);
    expect(
      normalizeProviderModels("openai", [
        { id: "gpt-5-2025-05-22", created: 900 },
        { id: "gpt-4o-2024-08-06", created: 800 },
        { id: "o3-2025-04-16", created: 700 },
        { id: "chatgpt-4o-latest", created: 600 },
        { id: "gpt-4.1-2025-04-14", created: 500 },
        { id: "gpt-4o", created: 400 },
        { id: "o4-mini-2025-04-16", created: 300 },
      ]),
    ).toEqual(["chatgpt-4o-latest", "gpt-4o"]);
  });

  it("keeps provider-specific models for OpenCode Go and DeepSeek", () => {
    const data = [{ id: "deepseek-v4-flash", created: 10 }];
    expect(normalizeProviderModels("opencode-go", data)).toEqual([
      "deepseek-v4-flash",
    ]);
    expect(normalizeProviderModels("deepseek", data)).toEqual([
      "deepseek-v4-flash",
    ]);
  });

  it("does not carry a provider's model into another provider", () => {
    expect(
      chooseProviderModel(
        ["deepseek-v4-flash", "deepseek-v4-pro"],
        "gpt-4.1",
        "deepseek-v4-flash",
      ),
    ).toBe("deepseek-v4-flash");
    expect(chooseProviderModel([], undefined, "deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
    expect(chooseProviderModel(["gpt-4.1", "gpt-5"], "gpt-4.1", "gpt-5")).toBe(
      "gpt-4.1",
    );
  });
});
