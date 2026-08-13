import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants";
import { cloneSettings, defaultLoadPolicy, settingsImpact } from "../../src/settings";

describe("default load policy", () => {
  it("follows the engine: onnx -> first-search, pytorch -> vault-open", () => {
    expect(defaultLoadPolicy("onnx")).toBe("first-search");
    expect(defaultLoadPolicy("pytorch")).toBe("vault-open");
  });

  it("defaults to first-search for the default onnx engine", () => {
    expect(DEFAULT_SETTINGS.engine).toBe("onnx");
    expect(DEFAULT_SETTINGS.loadPolicy).toBe("first-search");
  });
});

describe("settings impact", () => {
  it("classifies hot, vector, and complete rebuild changes", () => {
    const current = cloneSettings(DEFAULT_SETTINGS);
    const hot = cloneSettings(current); hot.finalTopK = 40;
    expect(settingsImpact(current, hot)).toBe("hot");
    const diversity = cloneSettings(current); diversity.maxChunksPerFile = 2;
    expect(settingsImpact(current, diversity)).toBe("hot");
    const vector = cloneSettings(current); vector.queryPrefix = "";
    expect(settingsImpact(current, vector)).toBe("vectors");
    const providerOnnx = cloneSettings(current); providerOnnx.engine = "onnx";
    providerOnnx.provider = "tensorrt";
    expect(settingsImpact(current, providerOnnx)).toBe("vectors");
    const pytorchWithProvider = cloneSettings(current);
    pytorchWithProvider.engine = "pytorch";
    pytorchWithProvider.provider = "tensorrt";
    const providerIgnoredForPytorch = cloneSettings(pytorchWithProvider);
    providerIgnoredForPytorch.provider = "auto";
    expect(settingsImpact(pytorchWithProvider, providerIgnoredForPytorch)).toBe("hot");
    const all = cloneSettings(current); all.chunkChars = 500;
    expect(settingsImpact(current, all)).toBe("all");
    const strategy = cloneSettings(current); strategy.chunkingStrategy = "markdown-v2";
    expect(settingsImpact(current, strategy)).toBe("all");
  });

  it("does not alias glob arrays", () => {
    const copy = cloneSettings(DEFAULT_SETTINGS);
    copy.includeGlobs.push("extra/**");
    expect(DEFAULT_SETTINGS.includeGlobs).not.toContain("extra/**");
  });
});
