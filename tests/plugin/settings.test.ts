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
      favoriteAnswerModels: [{ provider: "openai", model: "gpt-5.6" }],
    });
    copy.favoriteAnswerModels.push({
      provider: "openai",
      model: "o4-mini",
    });
    expect(DEFAULT_SETTINGS.favoriteAnswerModels).toHaveLength(0);
    const cloned = cloneSettings(copy);
    cloned.favoriteAnswerModels.pop();
    expect(copy.favoriteAnswerModels).toHaveLength(2);
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

describe("agent extension settings", () => {
  const serverFixture = () => ({
    id: "srv-1",
    name: "Test",
    enabled: true,
    transport: "stdio" as const,
    command: "python",
    args: ["-x"],
    cwd: "vault",
    url: "",
    envNames: ["TOKEN"],
    toolPolicies: { tool_a: "ask" as const },
  });

  it("defaults keep MCP and skills off", () => {
    expect(DEFAULT_SETTINGS.mcpEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.mcpServers).toEqual([]);
    expect(DEFAULT_SETTINGS.skillsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.skillRoots).toEqual([]);
    expect(DEFAULT_SETTINGS.enabledSkills).toEqual([]);
    expect(DEFAULT_SETTINGS.answerProjectRules).toBe("");
    expect(DEFAULT_SETTINGS.answerProjectRulesSource).toBe("custom");
  });

  it("deep-clones nested MCP structures without aliasing", () => {
    const source = cloneSettings({
      ...DEFAULT_SETTINGS,
      mcpServers: [serverFixture()],
      skillRoots: [{ id: "r1", path: ".claude/skills", enabled: true }],
      enabledSkills: ["project:.claude:x"],
    });
    source.mcpServers[0].args.push("--extra");
    source.mcpServers[0].envNames.push("EXTRA");
    source.mcpServers[0].toolPolicies.tool_b = "allow";
    source.skillRoots[0].enabled = false;
    source.enabledSkills.push("another");
    expect(DEFAULT_SETTINGS.mcpServers).toHaveLength(0);
    expect(source.mcpServers[0].args).toEqual(["-x", "--extra"]);
    // Mutating the clone's nested objects must not affect the original
    // object passed in either.
    const original = {
      ...DEFAULT_SETTINGS,
      mcpServers: [serverFixture()],
    };
    const copy = cloneSettings(original);
    copy.mcpServers[0].toolPolicies.tool_a = "deny";
    expect(original.mcpServers[0].toolPolicies.tool_a).toBe("ask");
  });

  it("classifies MCP/skills structural changes as restart and rules as hot", () => {
    const current = cloneSettings(DEFAULT_SETTINGS);
    const withServer = cloneSettings(current);
    withServer.mcpServers = [serverFixture()];
    expect(settingsImpact(current, withServer)).toBe("restart");

    const toggleEnabled = cloneSettings(current);
    toggleEnabled.mcpEnabled = true;
    expect(settingsImpact(current, toggleEnabled)).toBe("restart");

    const skillsToggle = cloneSettings(current);
    skillsToggle.skillsEnabled = true;
    expect(settingsImpact(current, skillsToggle)).toBe("restart");

    const skillEnable = cloneSettings(current);
    skillEnable.enabledSkills = ["project:.claude:x"];
    expect(settingsImpact(current, skillEnable)).toBe("restart");

    const rules = cloneSettings(current);
    rules.answerProjectRules = "한국어로 답한다";
    expect(settingsImpact(current, rules)).toBe("hot");
  });

  it("migrates a v2 data.json by filling agent defaults without enabling anything", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      settingsVersion: 2,
    };
    delete (legacy as Partial<typeof legacy>).answerProjectRules;
    delete (legacy as Partial<typeof legacy>).mcpServers;
    delete (legacy as Partial<typeof legacy>).skillRoots;
    delete (legacy as Partial<typeof legacy>).enabledSkills;
    delete (legacy as Partial<typeof legacy>).mcpEnabled;
    delete (legacy as Partial<typeof legacy>).skillsEnabled;
    const changed = migrateSettings(legacy);
    expect(changed).toBe(true);
    expect(legacy.settingsVersion).toBe(SETTINGS_VERSION);
    expect(legacy.mcpEnabled).toBe(false);
    expect(legacy.skillsEnabled).toBe(false);
    expect(legacy.mcpServers).toEqual([]);
    expect(legacy.skillRoots).toEqual([]);
    expect(legacy.enabledSkills).toEqual([]);
    expect(legacy.answerProjectRules).toBe("");
  });

  it("reports no changes for an already-current data.json", () => {
    const current = { ...DEFAULT_SETTINGS, settingsVersion: SETTINGS_VERSION };
    expect(migrateSettings(current)).toBe(false);
  });
});
