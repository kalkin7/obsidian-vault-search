import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/constants";
import {
  SETTINGS_VERSION,
  cloneSettings,
  defaultLoadPolicy,
  migrateSettings,
  settingsImpact,
} from "../../src/settings";

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
    const hot = cloneSettings(current);
    hot.rrfK = 80;
    expect(settingsImpact(current, hot)).toBe("hot");
    const diversity = cloneSettings(current);
    diversity.maxChunksPerFile = 2;
    expect(settingsImpact(current, diversity)).toBe("hot");
    const vector = cloneSettings(current);
    vector.queryPrefix = "";
    expect(settingsImpact(current, vector)).toBe("vectors");
    const providerOnnx = cloneSettings(current);
    providerOnnx.engine = "onnx";
    providerOnnx.provider = "tensorrt";
    expect(settingsImpact(current, providerOnnx)).toBe("vectors");
    const pytorchWithProvider = cloneSettings(current);
    pytorchWithProvider.engine = "pytorch";
    pytorchWithProvider.provider = "tensorrt";
    const providerIgnoredForPytorch = cloneSettings(pytorchWithProvider);
    providerIgnoredForPytorch.provider = "auto";
    expect(settingsImpact(pytorchWithProvider, providerIgnoredForPytorch)).toBe(
      "hot",
    );
    const all = cloneSettings(current);
    all.chunkChars = 500;
    expect(settingsImpact(current, all)).toBe("all");
    const strategy = cloneSettings(current);
    strategy.chunkingStrategy = "markdown-v2";
    expect(settingsImpact(current, strategy)).toBe("all");
  });

  it("classifies wiki folder changes as hot (no rebuild needed)", () => {
    const current = cloneSettings(DEFAULT_SETTINGS);
    const next = cloneSettings(current);
    next.wikiFolders = ["Notes/Entities"];
    expect(settingsImpact(current, next)).toBe("hot");
    const cleared = cloneSettings(current);
    cleared.wikiFolders = [];
    expect(settingsImpact(current, cleared)).toBe("hot");
  });

  it("does not alias glob arrays", () => {
    const copy = cloneSettings(DEFAULT_SETTINGS);
    copy.includeGlobs.push("extra/**");
    expect(DEFAULT_SETTINGS.includeGlobs).not.toContain("extra/**");
  });

  it("does not alias favorite models", () => {
    const copy = cloneSettings({
      ...DEFAULT_SETTINGS,
      favoriteAnswerModels: ["gpt-5.6"],
    });
    copy.favoriteAnswerModels.push("o4-mini");
    expect(DEFAULT_SETTINGS.favoriteAnswerModels).not.toContain("o4-mini");
    const cloned = cloneSettings(copy);
    cloned.favoriteAnswerModels.pop();
    expect(copy.favoriteAnswerModels).toContain("gpt-5.6");
  });
});

describe("settings migration", () => {
  it("migrates untouched legacy defaults to benchmarked defaults", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      bm25TopK: 30,
      vectorTopK: 30,
      finalTopK: 20,
    };
    delete (legacy as { settingsVersion?: number }).settingsVersion;
    migrateSettings(legacy);
    expect(legacy.bm25TopK).toBe(80);
    expect(legacy.vectorTopK).toBe(80);
    expect(legacy.finalTopK).toBe(40);
    expect(legacy.settingsVersion).toBe(SETTINGS_VERSION);
  });

  it("preserves user-customized candidate widths", () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      bm25TopK: 60,
      vectorTopK: 60,
      finalTopK: 30,
    };
    delete (custom as { settingsVersion?: number }).settingsVersion;
    migrateSettings(custom);
    expect(custom.bm25TopK).toBe(60);
    expect(custom.vectorTopK).toBe(60);
    expect(custom.finalTopK).toBe(30);
  });

  it("is idempotent once versioned", () => {
    const migrated = {
      ...DEFAULT_SETTINGS,
      bm25TopK: 30,
      vectorTopK: 30,
      finalTopK: 20,
    };
    delete (migrated as { settingsVersion?: number }).settingsVersion;
    migrateSettings(migrated);
    const stamped = cloneSettings(migrated);
    migrateSettings(stamped);
    expect(stamped.bm25TopK).toBe(80);
    expect(stamped.settingsVersion).toBe(SETTINGS_VERSION);
  });

  it("migrates the legacy 0 idle timeout to 300 seconds", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      modelIdleTimeoutSeconds: 0,
    };
    delete (legacy as { settingsVersion?: number }).settingsVersion;
    migrateSettings(legacy);
    expect(legacy.modelIdleTimeoutSeconds).toBe(300);
    expect(legacy.settingsVersion).toBe(SETTINGS_VERSION);
  });

  it("keeps a non-default idle timeout untouched", () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      modelIdleTimeoutSeconds: 120,
    };
    delete (custom as { settingsVersion?: number }).settingsVersion;
    migrateSettings(custom);
    expect(custom.modelIdleTimeoutSeconds).toBe(120);
  });
});
