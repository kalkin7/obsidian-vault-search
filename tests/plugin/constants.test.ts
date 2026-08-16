import { describe, expect, it } from "vitest";
import { reasoningEffortLevels } from "../../src/constants";

describe("reasoningEffortLevels", () => {
  it("returns curated levels for known models (official model catalogs)", () => {
    // GPT-5.6 Luna/Terra: none..max incl. xhigh (no minimal) — OpenAI model pages.
    expect(reasoningEffortLevels("opencode-go", "gpt-5.6-luna")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    // DeepSeek V4: none/low/high/max (low maps to high, no medium) — DeepSeek API docs.
    expect(reasoningEffortLevels("opencode-go", "deepseek-v4-flash")).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
    // Kimi K3 always reasons: low/high/max — Kimi docs.
    expect(reasoningEffortLevels("opencode-go", "kimi-k3")).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  it("falls back to the provider default for models not yet curated", () => {
    // A newly fetched model id gets the provider's default set until it is
    // added to the curated table (checked against the provider's docs).
    expect(reasoningEffortLevels("opencode-go", "brand-new-model")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(reasoningEffortLevels("openai", "brand-new-model")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(reasoningEffortLevels("deepseek", "brand-new-model")).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
  });
});
