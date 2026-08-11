import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants";
import { cloneSettings, settingsImpact } from "../../src/settings";

describe("settings impact", () => {
  it("classifies hot, vector, and complete rebuild changes", () => {
    const current = cloneSettings(DEFAULT_SETTINGS);
    const hot = cloneSettings(current); hot.finalTopK = 40;
    expect(settingsImpact(current, hot)).toBe("hot");
    const diversity = cloneSettings(current); diversity.maxChunksPerFile = 2;
    expect(settingsImpact(current, diversity)).toBe("hot");
    const vector = cloneSettings(current); vector.queryPrefix = "";
    expect(settingsImpact(current, vector)).toBe("vectors");
    const all = cloneSettings(current); all.chunkChars = 500;
    expect(settingsImpact(current, all)).toBe("all");
  });

  it("does not alias glob arrays", () => {
    const copy = cloneSettings(DEFAULT_SETTINGS);
    copy.includeGlobs.push("extra/**");
    expect(DEFAULT_SETTINGS.includeGlobs).not.toContain("extra/**");
  });
});
