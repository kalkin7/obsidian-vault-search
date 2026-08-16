import { describe, expect, it } from "vitest";
import {
  chooseProviderModel,
  isSelectableAnswerModel,
  normalizeProviderModels,
} from "../../src/model-catalog";

describe("answer model catalog", () => {
  it("keeps OpenAI text/chat models and excludes non-chat models", () => {
    expect(isSelectableAnswerModel("openai", "gpt-live-transcribe")).toBe(false);
    expect(normalizeProviderModels("openai", [
      { id: "gpt-live-transcribe", created: 999 },
      { id: "gpt-5.6", created: 100 },
      { id: "gpt-4.1", created: 200 },
      { id: "text-embedding-3-large", created: 300 },
      { id: "gpt-4o-realtime-preview", created: 400 },
      { id: "o5-mini", created: 150 },
    ])).toEqual(["gpt-4.1", "o5-mini", "gpt-5.6"]);
  });

  it("keeps provider-specific models for OpenCode Go and DeepSeek", () => {
    const data = [{ id: "deepseek-v4-flash", created: 10 }];
    expect(normalizeProviderModels("opencode-go", data)).toEqual(["deepseek-v4-flash"]);
    expect(normalizeProviderModels("deepseek", data)).toEqual(["deepseek-v4-flash"]);
  });

  it("does not carry a provider's model into another provider", () => {
    expect(chooseProviderModel(
      ["deepseek-v4-flash", "deepseek-v4-pro"],
      "gpt-4.1",
      "deepseek-v4-flash",
    )).toBe("deepseek-v4-flash");
    expect(chooseProviderModel([], undefined, "deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(chooseProviderModel(
      ["gpt-4.1", "gpt-5"],
      "gpt-4.1",
      "gpt-5",
    )).toBe("gpt-4.1");
  });
});
