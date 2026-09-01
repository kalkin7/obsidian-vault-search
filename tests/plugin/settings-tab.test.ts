/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  notices: [] as string[],
  settings: [] as any[],
  buttons: [] as any[],
}));

vi.mock("obsidian", () => {
  function makeComponent() {
    const component = {
      value: "",
      options: [] as Array<{ value: string; label: string }>,
      cb: null as ((value: string) => void) | null,
      setValue(value: string) {
        this.value = value;
        return this;
      },
      getValue() {
        return this.value;
      },
      addOption(value: string, label: string) {
        this.options.push({ value, label });
        return this;
      },
      onChange(callback: (value: string) => void) {
        this.cb = callback;
        return this;
      },
      setPlaceholder() {
        return this;
      },
      setDisabled() {
        return this;
      },
      inputEl: {
        rows: 0,
        type: "text",
        setAttribute: vi.fn(),
      },
      triggerChange(val: string) {
        this.value = val;
        this.cb?.(val);
      },
    };
    return component;
  }

  class FakeEl {
    children: FakeEl[] = [];
    classes: string[] = [];
    text = "";
    attrs: Record<string, string> = {};
    listeners: Record<string, Array<() => void>> = {};
    disabled = false;
    tagName = "DIV";

    get textContent() {
      return this.text;
    }
    set textContent(v: string) {
      this.text = v;
    }

    createDiv(options?: { cls?: string; text?: string }) {
      const element = new FakeEl();
      element.tagName = "DIV";
      if (options?.cls) element.classes.push(...options.cls.split(" "));
      if (options?.text) element.text = options.text;
      this.children.push(element);
      return element;
    }
    createEl(
      tag: string,
      options?: { text?: string; cls?: string; attr?: Record<string, unknown> },
    ) {
      const element = new FakeEl();
      element.tagName = tag.toUpperCase();
      if (options?.text !== undefined) element.text = options.text;
      if (options?.cls) element.classes.push(...options.cls.split(" "));
      for (const [key, value] of Object.entries(options?.attr ?? {})) {
        element.attrs[key] = String(value);
      }
      this.children.push(element);
      return element;
    }
    appendChild(child: FakeEl) {
      this.children.push(child);
      return child;
    }
    addClass(cls: string) {
      if (!this.classes.includes(cls)) this.classes.push(cls);
    }
    removeClass(cls: string) {
      this.classes = this.classes.filter((c) => c !== cls);
    }
    toggleClass(cls: string, on: boolean) {
      if (on && !this.classes.includes(cls)) this.classes.push(cls);
      if (!on) this.classes = this.classes.filter((c) => c !== cls);
    }
    setText(text: string) {
      this.text = text;
      return this;
    }
    addEventListener(event: string, handler: () => void) {
      (this.listeners[event] ??= []).push(handler);
    }
    removeEventListener(event: string, handler: () => void) {
      this.listeners[event] = (this.listeners[event] || []).filter(
        (h) => h !== handler,
      );
    }
    async click() {
      for (const handler of [...(this.listeners.click ?? [])]) {
        await handler();
      }
    }
    empty() {
      this.children = [];
    }
    querySelectorAll(selector: string): FakeEl[] {
      const results: FakeEl[] = [];
      const search = (node: FakeEl) => {
        if (!node || !node.children) return;
        for (const child of node.children) {
          if (!child) continue;
          if (
            selector.startsWith(".") &&
            Array.isArray(child.classes) &&
            child.classes.includes(selector.slice(1))
          ) {
            results.push(child);
          }
          search(child);
        }
      };
      search(this);
      return results;
    }
    querySelector(selector: string): FakeEl | null {
      const all = this.querySelectorAll(selector);
      return all[0] || null;
    }
    remove() {
      // no-op
    }
  }

  class Notice {
    constructor(public message: string, public timeout?: number) {
      h.notices.push(message);
    }
  }

  class Setting {
    name = "";
    settingEl = new FakeEl();
    controlEl = new FakeEl();
    components: any[] = [];
    buttons: any[] = [];
    constructor(parent?: FakeEl) {
      this.settingEl.createEl("div", { cls: "setting-item-name", text: "" });
      this.settingEl.appendChild(this.controlEl);
      parent?.children.push(this.settingEl);
      h.settings.push(this);
    }
    setName(name: string) {
      this.name = name;
      const nameEl = this.settingEl.querySelector(".setting-item-name");
      if (nameEl) nameEl.text = name;
      return this;
    }
    setDesc() {
      return this;
    }
    setClass() {
      return this;
    }
    addText(callback: (component: ReturnType<typeof makeComponent>) => unknown) {
      const c = makeComponent();
      this.components.push(c);
      callback(c);
      return this;
    }
    addTextArea(
      callback: (component: ReturnType<typeof makeComponent>) => unknown,
    ) {
      const c = makeComponent();
      this.components.push(c);
      callback(c);
      return this;
    }
    addDropdown(
      callback: (component: ReturnType<typeof makeComponent>) => unknown,
    ) {
      const c = makeComponent();
      this.components.push(c);
      callback(c);
      return this;
    }
    addToggle(
      callback: (toggle: { setValue: (v: boolean) => any; onChange: (cb: (v: boolean) => void) => any }) => unknown,
    ) {
      const toggle = {
        value: false,
        setValue(v: boolean) {
          this.value = v;
          return this;
        },
        onChange(_cb: (v: boolean) => void) {
          return this;
        },
      };
      callback(toggle);
      return this;
    }
    addButton(callback: (button: Record<string, unknown>) => unknown) {
      const button = {
        disabled: false,
        text: "",
        isCta: false,
        isWarning: false,
        clickHandler: null as (() => Promise<void> | void) | null,
        setButtonText(text: string) {
          button.text = text;
          return button;
        },
        setCta() {
          button.isCta = true;
          return button;
        },
        setWarning() {
          button.isWarning = true;
          return button;
        },
        setTooltip() {
          return button;
        },
        setDisabled(disabled: boolean) {
          button.disabled = disabled;
          return button;
        },
        onClick(cb: () => Promise<void> | void) {
          button.clickHandler = cb;
          return button;
        },
        async click() {
          if (button.clickHandler) {
            await button.clickHandler();
          }
        },
      };
      this.buttons.push(button);
      h.buttons.push(button);
      callback(button);
      return this;
    }
  }

  class PluginSettingTab {
    containerEl = new FakeEl();
    constructor(public app: any, public plugin: any) {}
  }

  class Plugin {
    app: any = {};
    manifest: any = { id: "obsidian-vault-search", version: "0.1.64" };
    constructor(app?: any, manifest?: any) {
      this.app = app || {};
      if (manifest) this.manifest = manifest;
    }
    registerEvent() {}
    registerView() {}
    registerCommands() {}
    addSettingTab() {}
    addRibbonIcon() {
      return {};
    }
    addCommand() {}
  }

  class FileSystemAdapter {
    getBasePath() {
      return "C:/vault";
    }
  }

  class TFile {}

  class Modal {
    contentEl = new FakeEl();
    modalEl = new FakeEl();
    titleEl = new FakeEl();
    constructor(public app: any) {}
    open() {}
    close() {}
  }

  class SuggestModal extends Modal {}

  class ItemView {
    containerEl = new FakeEl();
    constructor(public leaf: any) {}
  }

  class WorkspaceLeaf {}

  return {
    Notice,
    Setting,
    PluginSettingTab,
    Plugin,
    FileSystemAdapter,
    TFile,
    requestUrl: () => Promise.resolve({ json: { data: [] } }),
    Modal,
    SuggestModal,
    ItemView,
    WorkspaceLeaf,
    setIcon: () => {},
    addIcon: () => {},
  };
});

import { FileSystemAdapter, Notice } from "obsidian";
import { VaultSearchSettingTab } from "../../src/settings-tab";
import { DEFAULT_SETTINGS } from "../../src/constants";
import VaultSearchPlugin from "../../src/main";
import { cloneSettings } from "../../src/settings";
import { BackendManager } from "../../src/backend-manager";

function createMockPlugin() {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.answerProvider = "openai";
  settings.answerModel = "gpt-4o";
  settings.favoriteAnswerModels = [{ provider: "openai", model: "gpt-4o" }];

  const draftSettings = cloneSettings(settings);
  const fetchedModels: Record<string, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    deepseek: ["deepseek-chat"],
  };

  const plugin = {
    app: {},
    settings,
    draftSettings,
    backend: {
      status: { state: "ready" as const },
    },
    backendInstall: { installed: true, version: "0.1.64", expected: "0.1.64" },
    runtimeSummary: "런타임: venv",
    runtimeWarning: null,
    agentIntegration: null,
    getProviderApiKey: () => "test-api-key",
    saveProviderApiKey: vi.fn(async () => undefined),
    fetchProviderModels: vi.fn(async (_p: string) => ["gpt-4o", "gpt-4o-mini", "o3-mini"]),
    getProviderModels: (p: string) => fetchedModels[p] || [],
    setProviderModels: vi.fn(async (provider: string, models: string[]) => {
      fetchedModels[provider] = models;
    }),
    setAnswerModel: vi.fn(async (provider: any, model: string) => {
      plugin.settings.answerProvider = provider;
      plugin.settings.answerModel = model;
    }),
    toggleFavoriteModel: vi.fn(async (provider: any, model: string) => {
      const favs = plugin.settings.favoriteAnswerModels || [];
      const idx = favs.findIndex((f) => f.provider === provider && f.model === model);
      if (idx >= 0) favs.splice(idx, 1);
      else favs.push({ provider, model });
    }),
    refreshMcpStatus: async () => ({ enabled: false, servers: [], connected: 0 }),
    refreshSkillsStatus: async () => ({ enabled: false, skills: [], roots: [] }),
  } as unknown as VaultSearchPlugin;

  return plugin;
}

beforeEach(() => {
  h.notices.length = 0;
  h.settings.length = 0;
  h.buttons.length = 0;
  vi.stubGlobal("document", {
    createElement: () => ({
      type: "",
      value: "",
      placeholder: "",
      className: "",
      rows: 0,
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VaultSearchSettingTab Promise safety and await handling (v0.1.64)", () => {
  it("awaits setProviderModels on model refresh and only displays success notice after resolution", async () => {
    const plugin = createMockPlugin();
    let resolveSetModels!: () => void;
    const setModelsGate = new Promise<void>((resolve) => {
      resolveSetModels = resolve;
    });

    plugin.setProviderModels = vi.fn(async () => {
      await setModelsGate;
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const refreshButton = h.buttons.find((b) => b.text === "모델 최신화");
    expect(refreshButton).toBeDefined();

    // 1. Click refresh button (in flight)
    const clickPromise = refreshButton.click();

    // While pending: button is disabled, no success notice displayed yet
    expect(refreshButton.disabled).toBe(true);
    expect(h.notices).toHaveLength(0);

    // 2. Resolve setProviderModels
    resolveSetModels();
    await clickPromise;

    // After resolve: success notice shown, button re-enabled
    expect(refreshButton.disabled).toBe(false);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("선택 가능한 모델 3개를 확인했습니다.");
    expect(plugin.setProviderModels).toHaveBeenCalledWith("openai", [
      "gpt-4o",
      "gpt-4o-mini",
      "o3-mini",
    ]);
  });

  it("handles setProviderModels rejection without displaying success notice and surfaces error via showError", async () => {
    const plugin = createMockPlugin();
    plugin.setProviderModels = vi.fn(async () => {
      throw new Error("Disk storage write failure");
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const refreshButton = h.buttons.find((b) => b.text === "모델 최신화");
    expect(refreshButton).toBeDefined();

    await refreshButton.click();

    // Success notice was not shown; error notice was shown
    expect(h.notices.some((n) => n.includes("확인했습니다"))).toBe(false);
    expect(h.notices.some((n) => n.includes("Vault Search 오류: Disk storage write failure"))).toBe(true);
    // Button is re-enabled in finally
    expect(refreshButton.disabled).toBe(false);
  });

  it("does not call display() or overwrite active provider UI when a previous provider model fetch resolves after switching provider", async () => {
    const plugin = createMockPlugin();
    let resolveOpenAiModels!: (models: string[]) => void;
    const openaiGate = new Promise<string[]>((resolve) => {
      resolveOpenAiModels = resolve;
    });

    plugin.fetchProviderModels = vi.fn(async (provider: string) => {
      if (provider === "openai") return await openaiGate;
      return ["claude-3-5-sonnet", "claude-3-7-sonnet"];
    });

    const tab = new VaultSearchSettingTab(plugin);
    const displaySpy = vi.spyOn(tab, "display");
    tab.display();
    displaySpy.mockClear();

    // 1. Start refresh for OpenAI (draft.answerProvider is openai)
    const refreshButton = h.buttons.find((b) => b.text === "모델 최신화");
    expect(refreshButton).toBeDefined();
    const clickPromise = refreshButton.click();

    // 2. User switches provider to anthropic in the draft
    plugin.draftSettings.answerProvider = "anthropic";
    plugin.draftSettings.answerModel = "claude-3-7-sonnet";

    // 3. OpenAI fetch resolves
    resolveOpenAiModels(["gpt-4o", "gpt-4o-mini", "o3-mini"]);
    await clickPromise;

    // OpenAI models were stored in cache
    expect(plugin.setProviderModels).toHaveBeenCalledWith("openai", [
      "gpt-4o",
      "gpt-4o-mini",
      "o3-mini",
    ]);
    // But tab.display() was NOT called because draft.answerProvider is anthropic
    expect(displaySpy).not.toHaveBeenCalled();
    // Active provider and model in draft remain Anthropic
    expect(plugin.draftSettings.answerProvider).toBe("anthropic");
    expect(plugin.draftSettings.answerModel).toBe("claude-3-7-sonnet");
  });
});

describe("VaultSearchPlugin production mutation helpers rollback and sidecar sync invariants", () => {
  function createRealProductionPlugin(options?: {
    failSave?: boolean;
    failSaveFirst?: boolean;
  }) {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.answerProvider = "openai";
    settings.answerModel = "gpt-4o";
    settings.answerReasoningEffort = "high";
    settings.favoriteAnswerModels = [{ provider: "openai", model: "gpt-4o" }];
    settings.fetchedProviderModels = { openai: ["gpt-4o"] };

    const draftTarget = cloneSettings(settings);
    const draftSettings = new Proxy(draftTarget, {
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    });

    const plugin = Object.create(VaultSearchPlugin.prototype) as any;
    plugin.app = {};
    plugin.settings = settings;
    plugin.draftSettings = draftSettings;
    plugin.providerModels = { openai: ["gpt-4o"] };
    plugin.settingsQueue = Promise.resolve();
    plugin.aiSearchViews = new Set([{ refreshModelSelector: vi.fn() }]);
    const backendCalls: Array<{ method: string; arg: any }> = [];
    plugin.backend = {
      status: { state: "ready" as const },
      call: vi.fn(async (method: string, arg: any) => {
        backendCalls.push({ method, arg });
      }),
      writeMachinePython: vi.fn().mockResolvedValue(undefined),
      persistServiceConfig: vi.fn().mockResolvedValue(undefined),
    };

    let saveCallCount = 0;
    plugin.saveData = vi.fn(async () => {
      saveCallCount++;
      if (options?.failSave) {
        throw new Error("Disk write permission denied");
      }
      if (options?.failSaveFirst && saveCallCount === 1) {
        throw new Error("Temporary save failure");
      }
    });

    return { plugin: plugin as VaultSearchPlugin, backendCalls };
  }

  it("real setAnswerModel updates state and sidecar on success and rolls back on save failure", async () => {
    // 1. Success case using real VaultSearchPlugin.prototype.setAnswerModel
    const { plugin: okPlugin, backendCalls } = createRealProductionPlugin();
    await okPlugin.setAnswerModel("openai", "gpt-4o-mini", { notify: false });
    expect(okPlugin.settings.answerProvider).toBe("openai");
    expect(okPlugin.settings.answerModel).toBe("gpt-4o-mini");
    expect(okPlugin.draftSettings.answerProvider).toBe("openai");
    expect(okPlugin.draftSettings.answerModel).toBe("gpt-4o-mini");
    expect(backendCalls.some((c) => c.method === "apply_search_config")).toBe(true);

    // 2. Failure rollback case using real prototype implementation
    const { plugin: failPlugin } = createRealProductionPlugin({ failSave: true });
    await expect(
      failPlugin.setAnswerModel("openai", "gpt-4o-mini", { notify: false }),
    ).rejects.toThrow("Disk write permission denied");
    expect(failPlugin.settings.answerProvider).toBe("openai");
    expect(failPlugin.settings.answerModel).toBe("gpt-4o");
    expect(failPlugin.draftSettings.answerProvider).toBe("openai");
    expect(failPlugin.draftSettings.answerModel).toBe("gpt-4o");
  });

  it("real setAnswerReasoningEffort updates state on success and rolls back on save failure", async () => {
    const { plugin: okPlugin } = createRealProductionPlugin();
    await okPlugin.setAnswerReasoningEffort("medium");
    expect(okPlugin.settings.answerReasoningEffort).toBe("medium");
    expect(okPlugin.draftSettings.answerReasoningEffort).toBe("medium");

    const { plugin: failPlugin } = createRealProductionPlugin({ failSave: true });
    await expect(failPlugin.setAnswerReasoningEffort("low")).rejects.toThrow(
      "Disk write permission denied",
    );
    expect(failPlugin.settings.answerReasoningEffort).toBe("high");
    expect(failPlugin.draftSettings.answerReasoningEffort).toBe("high");
  });

  it("real toggleFavoriteModel updates favorites on success and rolls back on save failure", async () => {
    const { plugin: okPlugin } = createRealProductionPlugin();
    await okPlugin.toggleFavoriteModel("openai", "o3-mini");
    expect(okPlugin.settings.favoriteAnswerModels).toContainEqual({
      provider: "openai",
      model: "o3-mini",
    });
    expect(okPlugin.draftSettings.favoriteAnswerModels).toContainEqual({
      provider: "openai",
      model: "o3-mini",
    });

    const { plugin: failPlugin } = createRealProductionPlugin({ failSave: true });
    const originalFavs = [{ provider: "openai", model: "gpt-4o" }];
    await expect(
      failPlugin.toggleFavoriteModel("openai", "o3-mini"),
    ).rejects.toThrow("Disk write permission denied");
    expect(failPlugin.settings.favoriteAnswerModels).toEqual(originalFavs);
    expect(failPlugin.draftSettings.favoriteAnswerModels).toEqual(originalFavs);
  });

  it("real setProviderModels updates model cache on success and rolls back on save failure", async () => {
    const { plugin: okPlugin } = createRealProductionPlugin();
    await okPlugin.setProviderModels("openai", ["gpt-4o", "gpt-4o-mini", "o3-mini"]);
    expect(okPlugin.getProviderModels("openai")).toEqual(["gpt-4o", "gpt-4o-mini", "o3-mini"]);
    expect(okPlugin.settings.fetchedProviderModels?.openai).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "o3-mini",
    ]);
    expect(okPlugin.draftSettings.fetchedProviderModels?.openai).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "o3-mini",
    ]);

    const { plugin: failPlugin } = createRealProductionPlugin({ failSave: true });
    await expect(
      failPlugin.setProviderModels("deepseek", ["deepseek-chat", "deepseek-reasoner"]),
    ).rejects.toThrow("Disk write permission denied");
    expect(failPlugin.getProviderModels("deepseek")).toEqual([]);
    expect(failPlugin.settings.fetchedProviderModels?.deepseek).toBeUndefined();
    expect(failPlugin.draftSettings.fetchedProviderModels?.deepseek).toBeUndefined();
  });

  it("FIFO serialization preserves order when concurrent mutation operations are enqueued", async () => {
    // Op 1 fails, Op 2 succeeds
    const { plugin: p1 } = createRealProductionPlugin({ failSaveFirst: true });
    const op1 = p1.setAnswerModel("openai", "o1", { notify: false });
    const op2 = p1.setAnswerModel("openai", "o3-mini", { notify: false });

    await expect(op1).rejects.toThrow("Temporary save failure");
    await expect(op2).resolves.toBeUndefined();

    // After Op 1 failure rollback and Op 2 success, Op 2 must be the active model
    expect(p1.settings.answerModel).toBe("o3-mini");
    expect(p1.draftSettings.answerModel).toBe("o3-mini");
  });
});

describe("Settings Tab optimistic model selection and favorite stale rollback", () => {
  it("A selection pending -> B selection succeeds -> A late failure preserves B in settings and draft", async () => {
    const plugin = createMockPlugin();
    let rejectModelA!: (err: Error) => void;
    const modelAGate = new Promise<void>((_, reject) => {
      rejectModelA = reject;
    });

    let callCount = 0;
    plugin.setAnswerModel = vi.fn(async (_p: any, model: string) => {
      callCount++;
      if (model === "gpt-4o-mini") {
        await modelAGate;
      } else if (model === "o3-mini") {
        plugin.settings.answerModel = "o3-mini";
      }
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const names = tab.containerEl.querySelectorAll(".vault-search-model-name");
    const btnA = names.find((b) => b.text === "gpt-4o-mini");
    const btnB = names.find((b) => b.text === "o3-mini");
    expect(btnA).toBeDefined();
    expect(btnB).toBeDefined();

    // 1. Click A (pending)
    const clickAPromise = btnA!.click();
    expect(plugin.draftSettings.answerModel).toBe("gpt-4o-mini");

    // 2. Click B (succeeds)
    const clickBPromise = btnB!.click();
    await clickBPromise;
    expect(plugin.draftSettings.answerModel).toBe("o3-mini");
    expect(plugin.settings.answerModel).toBe("o3-mini");

    // 3. A fails late
    rejectModelA(new Error("Network timeout"));
    await clickAPromise;

    // Final settings, draft, and selections must remain B
    expect(plugin.draftSettings.answerModel).toBe("o3-mini");
    expect(plugin.settings.answerModel).toBe("o3-mini");
    expect(h.notices.some((n) => n.includes("Network timeout"))).toBe(true);
  });

  it("A selection pending -> provider switched to P2 -> A failure does not affect P2 state", async () => {
    const plugin = createMockPlugin();
    let rejectModelA!: (err: Error) => void;
    const modelAGate = new Promise<void>((_, reject) => {
      rejectModelA = reject;
    });

    plugin.setAnswerModel = vi.fn(async () => {
      await modelAGate;
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const names = tab.containerEl.querySelectorAll(".vault-search-model-name");
    const btnA = names.find((b) => b.text === "gpt-4o-mini");
    expect(btnA).toBeDefined();

    // 1. Click A on OpenAI
    const clickAPromise = btnA!.click();
    expect(plugin.draftSettings.answerProvider).toBe("openai");
    expect(plugin.draftSettings.answerModel).toBe("gpt-4o-mini");

    // 2. Switch provider to deepseek
    plugin.draftSettings.answerProvider = "deepseek";
    plugin.draftSettings.answerModel = "deepseek-chat";

    // 3. A fails late
    rejectModelA(new Error("Save failed"));
    await clickAPromise;

    // P2 provider, model, and draft remain untouched
    expect(plugin.draftSettings.answerProvider).toBe("deepseek");
    expect(plugin.draftSettings.answerModel).toBe("deepseek-chat");
  });

  it("Model selection latest failure properly rolls back to previous snapshot", async () => {
    const plugin = createMockPlugin();
    plugin.setAnswerModel = vi.fn(async () => {
      throw new Error("Save error");
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    expect(plugin.draftSettings.answerModel).toBe("gpt-4o");

    const names = tab.containerEl.querySelectorAll(".vault-search-model-name");
    const btnA = names.find((b) => b.text === "gpt-4o-mini");
    expect(btnA).toBeDefined();

    await btnA!.click();

    // Rolled back to gpt-4o
    expect(plugin.draftSettings.answerModel).toBe("gpt-4o");
    expect(h.notices.some((n) => n.includes("Save error"))).toBe(true);
  });

  it("Favorite latest-intent FIFO: A ON pending -> new star button clicked for A OFF -> 1st ON fails -> latest OFF succeeds", async () => {
    let rejectSave1!: (err: Error) => void;
    const save1Gate = new Promise<void>((_, reject) => {
      rejectSave1 = reject;
    });

    let saveCallCount = 0;
    const plugin = Object.create(VaultSearchPlugin.prototype) as any;
    plugin.app = {};
    plugin.settings = cloneSettings(DEFAULT_SETTINGS);
    plugin.settings.answerProvider = "openai";
    plugin.settings.answerModel = "gpt-4o";
    plugin.settings.favoriteAnswerModels = [{ provider: "openai", model: "gpt-4o" }];
    plugin.draftTarget = cloneSettings(plugin.settings);
    plugin.draftSettings = new Proxy(plugin.draftTarget, {
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    });
    plugin.providerModels = { openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"] };
    plugin.getProviderModels = (p: string) => plugin.providerModels[p] || [];
    plugin.backendInstall = { installed: true, version: "0.1.64", expected: "0.1.64" };
    plugin.runtimeSummary = "런타임: venv";
    plugin.runtimeWarning = null;
    plugin.settingsQueue = Promise.resolve();
    plugin.aiSearchViews = new Set();
    plugin.backend = {
      status: { state: "ready" as const },
      call: vi.fn().mockResolvedValue(undefined),
      writeMachinePython: vi.fn().mockResolvedValue(undefined),
      persistServiceConfig: vi.fn().mockResolvedValue(undefined),
    };
    plugin.saveData = vi.fn(async () => {
      saveCallCount++;
      if (saveCallCount === 1) {
        await save1Gate;
      }
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const getStarButton = (modelName: string) => {
      const rows = tab.containerEl.querySelectorAll(".vault-search-model-row");
      const row = rows.find(
        (r) => r.querySelector(".vault-search-model-name")?.text === modelName,
      );
      return row?.querySelector(".vault-search-model-star");
    };

    // Initial state: gpt-4o-mini is not favorite
    const initialStar = getStarButton("gpt-4o-mini");
    expect(initialStar).toBeDefined();
    expect(initialStar?.classes.includes("is-favorite")).toBe(false);

    // 1. User clicks A to turn ON (pending in FIFO save 1)
    const click1Promise = initialStar!.click();
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(true);

    // 2. Query the newly rendered attached star button from DOM
    const attachedNewStar = getStarButton("gpt-4o-mini");
    expect(attachedNewStar).toBeDefined();
    expect(attachedNewStar).not.toBe(initialStar);
    expect(attachedNewStar?.classes.includes("is-favorite")).toBe(true);

    // User clicks the new star button to turn OFF (queued behind op 1 in FIFO)
    const click2Promise = attachedNewStar!.click();
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(false);

    // 3. First save fails and rejects
    rejectSave1(new Error("First save failed"));
    await Promise.allSettled([click1Promise, click2Promise]);

    // Final state: Latest user intent (OFF) must be preserved across settings, draft, and DOM
    expect(
      plugin.settings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(false);
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(false);

    const finalStar = getStarButton("gpt-4o-mini");
    expect(finalStar?.classes.includes("is-favorite")).toBe(false);
  });

  it("Favorite latest-intent FIFO: A OFF pending -> new star button clicked for A ON -> 1st OFF fails -> latest ON succeeds", async () => {
    let rejectSave1!: (err: Error) => void;
    const save1Gate = new Promise<void>((_, reject) => {
      rejectSave1 = reject;
    });

    let saveCallCount = 0;
    const plugin = Object.create(VaultSearchPlugin.prototype) as any;
    plugin.app = {};
    plugin.settings = cloneSettings(DEFAULT_SETTINGS);
    plugin.settings.answerProvider = "openai";
    plugin.settings.answerModel = "gpt-4o";
    plugin.settings.favoriteAnswerModels = [
      { provider: "openai", model: "gpt-4o" },
      { provider: "openai", model: "gpt-4o-mini" },
    ];
    plugin.draftTarget = cloneSettings(plugin.settings);
    plugin.draftSettings = new Proxy(plugin.draftTarget, {
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    });
    plugin.providerModels = { openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"] };
    plugin.getProviderModels = (p: string) => plugin.providerModels[p] || [];
    plugin.backendInstall = { installed: true, version: "0.1.64", expected: "0.1.64" };
    plugin.runtimeSummary = "런타임: venv";
    plugin.runtimeWarning = null;
    plugin.settingsQueue = Promise.resolve();
    plugin.aiSearchViews = new Set();
    plugin.backend = {
      status: { state: "ready" as const },
      call: vi.fn().mockResolvedValue(undefined),
      writeMachinePython: vi.fn().mockResolvedValue(undefined),
      persistServiceConfig: vi.fn().mockResolvedValue(undefined),
    };
    plugin.saveData = vi.fn(async () => {
      saveCallCount++;
      if (saveCallCount === 1) {
        await save1Gate;
      }
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const getStarButton = (modelName: string) => {
      const rows = tab.containerEl.querySelectorAll(".vault-search-model-row");
      const row = rows.find(
        (r) => r.querySelector(".vault-search-model-name")?.text === modelName,
      );
      return row?.querySelector(".vault-search-model-star");
    };

    // Initial state: gpt-4o-mini is favorite
    const initialStar = getStarButton("gpt-4o-mini");
    expect(initialStar?.classes.includes("is-favorite")).toBe(true);

    // 1. Click to turn OFF (pending in FIFO save 1)
    const click1Promise = initialStar!.click();
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(false);

    // 2. Query newly rendered star button
    const attachedNewStar = getStarButton("gpt-4o-mini");
    expect(attachedNewStar?.classes.includes("is-favorite")).toBe(false);

    // Click to turn ON (queued in FIFO)
    const click2Promise = attachedNewStar!.click();
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(true);

    // 3. First save fails
    rejectSave1(new Error("First save failed"));
    await Promise.allSettled([click1Promise, click2Promise]);

    // Final state: Latest user intent (ON) is preserved across settings, draft, and DOM
    expect(
      plugin.settings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(true);
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(true);

    const finalStar = getStarButton("gpt-4o-mini");
    expect(finalStar?.classes.includes("is-favorite")).toBe(true);
  });

  it("Model A favorite operation failure preserves interleaved Model B favorite success", async () => {
    let rejectSaveA!: (err: Error) => void;
    const saveAGate = new Promise<void>((_, reject) => {
      rejectSaveA = reject;
    });

    let saveCallCount = 0;
    const plugin = Object.create(VaultSearchPlugin.prototype) as any;
    plugin.app = {};
    plugin.settings = cloneSettings(DEFAULT_SETTINGS);
    plugin.settings.answerProvider = "openai";
    plugin.settings.answerModel = "gpt-4o";
    plugin.settings.favoriteAnswerModels = [{ provider: "openai", model: "gpt-4o" }];
    plugin.draftTarget = cloneSettings(plugin.settings);
    plugin.draftSettings = new Proxy(plugin.draftTarget, {
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    });
    plugin.providerModels = { openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"] };
    plugin.getProviderModels = (p: string) => plugin.providerModels[p] || [];
    plugin.backendInstall = { installed: true, version: "0.1.64", expected: "0.1.64" };
    plugin.runtimeSummary = "런타임: venv";
    plugin.runtimeWarning = null;
    plugin.settingsQueue = Promise.resolve();
    plugin.aiSearchViews = new Set();
    plugin.backend = {
      status: { state: "ready" as const },
      call: vi.fn().mockResolvedValue(undefined),
      writeMachinePython: vi.fn().mockResolvedValue(undefined),
      persistServiceConfig: vi.fn().mockResolvedValue(undefined),
    };
    plugin.saveData = vi.fn(async () => {
      saveCallCount++;
      if (saveCallCount === 1) {
        await saveAGate;
      }
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const getStarButton = (modelName: string) => {
      const rows = tab.containerEl.querySelectorAll(".vault-search-model-row");
      const row = rows.find(
        (r) => r.querySelector(".vault-search-model-name")?.text === modelName,
      );
      return row?.querySelector(".vault-search-model-star");
    };

    // Click A (gpt-4o-mini) -> ON (pending)
    const starA = getStarButton("gpt-4o-mini");
    const clickAPromise = starA!.click();

    // Click B (o3-mini) -> ON (queued in FIFO)
    const starB = getStarButton("o3-mini");
    const clickBPromise = starB!.click();

    // A fails
    rejectSaveA(new Error("A save failed"));
    await Promise.allSettled([clickAPromise, clickBPromise]);

    // A rolled back, B succeeded and is preserved in settings and draft
    expect(
      plugin.settings.favoriteAnswerModels?.some(
        (f: any) => f.model === "gpt-4o-mini",
      ),
    ).toBe(false);
    expect(
      plugin.settings.favoriteAnswerModels?.some(
        (f: any) => f.model === "o3-mini",
      ),
    ).toBe(true);
    expect(
      plugin.draftSettings.favoriteAnswerModels?.some(
        (f: any) => f.model === "o3-mini",
      ),
    ).toBe(true);

    const finalStarA = getStarButton("gpt-4o-mini");
    const finalStarB = getStarButton("o3-mini");
    expect(finalStarA?.classes.includes("is-favorite")).toBe(false);
    expect(finalStarB?.classes.includes("is-favorite")).toBe(true);
  });

  it("Favorite star on P1 pending -> switch provider to P2 -> P1 failure leaves P2 favorites intact", async () => {
    const plugin = createMockPlugin();
    let rejectFav!: (err: Error) => void;
    const favGate = new Promise<void>((_, reject) => {
      rejectFav = reject;
    });

    plugin.toggleFavoriteModel = vi.fn(async () => {
      await favGate;
    });

    const tab = new VaultSearchSettingTab(plugin);
    tab.display();

    const rows = tab.containerEl.querySelectorAll(".vault-search-model-row");
    const rowMini = rows.find(
      (r) => r.querySelector(".vault-search-model-name")?.text === "gpt-4o-mini",
    );
    const starMini = rowMini?.querySelector(".vault-search-model-star");
    expect(starMini).toBeDefined();

    // 1. Start favorite toggle on P1
    const togglePromise = starMini!.click();

    // 2. Switch provider to deepseek with its own favorites
    plugin.draftSettings.answerProvider = "deepseek";
    plugin.draftSettings.favoriteAnswerModels = [
      { provider: "deepseek", model: "deepseek-chat" },
    ];

    // 3. P1 toggle fails
    rejectFav(new Error("P1 error"));
    await togglePromise;

    // P2 favorites unaffected
    expect(plugin.draftSettings.answerProvider).toBe("deepseek");
    expect(plugin.draftSettings.favoriteAnswerModels).toEqual([
      { provider: "deepseek", model: "deepseek-chat" },
    ]);
  });
});

describe("Startup sanitized service-config fail-closed across production methods", () => {
  function createRealProductionStartupPlugin(
    loadPolicy: "vault-open" | "first-search" | "manual" = "vault-open",
  ) {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.loadPolicy = loadPolicy;

    let layoutReadyCb: (() => void) | null = null;
    const plugin = Object.create(VaultSearchPlugin.prototype) as any;
    plugin.manifest = { id: "obsidian-vault-search", version: "0.1.64" };
    plugin.settings = settings;
    plugin.providerModels = { openai: ["gpt-4o"] };
    plugin.backendInstall = { installed: true, version: "0.1.64", expected: "0.1.64" };
    plugin.runtimeSummary = "런타임: venv";
    plugin.runtimeWarning = null;
    plugin.aiSearchViews = new Set();
    plugin.settingsQueue = Promise.resolve();
    plugin.loadData = vi.fn(async () => settings);
    plugin.saveData = vi.fn(async () => undefined);
    plugin.registerEvent = vi.fn();
    plugin.registerView = vi.fn();
    plugin.registerCommands = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.addRibbonIcon = vi.fn(() => ({}));
    plugin.addCommand = vi.fn();

    const adapter = new (FileSystemAdapter as any)();
    plugin.app = {
      vault: {
        adapter,
        configDir: ".obsidian",
        on: vi.fn(() => ({})),
      },
      workspace: {
        onLayoutReady: vi.fn((cb: () => void) => {
          layoutReadyCb = cb;
        }),
      },
    };

    return { plugin: plugin as VaultSearchPlugin, getLayoutReadyCb: () => layoutReadyCb };
  }

  it("vault-open loadPolicy: real onload blocks backend startup when sanitized config write fails and prevents secret leaks", async () => {
    const persistSpy = vi
      .spyOn(BackendManager.prototype, "persistServiceConfig")
      .mockRejectedValue(
        new Error(
          "Filesystem write failed: CANARY_SECRET_PATH_CORRUPT_DISK_NO_PERMISSION",
        ),
      );
    const startSpy = vi.spyOn(BackendManager.prototype, "start").mockResolvedValue(undefined);
    const ensureStartedSpy = vi
      .spyOn(BackendManager.prototype, "ensureStarted")
      .mockResolvedValue(undefined);
    const restartSpy = vi.spyOn(BackendManager.prototype, "restart").mockResolvedValue(undefined);
    const callSpy = vi.spyOn(BackendManager.prototype, "call").mockResolvedValue({} as any);
    const sendMcpSecretsSpy = vi
      .spyOn(BackendManager.prototype, "sendMcpSecrets")
      .mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "ensureBackendProvisioned").mockResolvedValue({} as any);
    vi.spyOn(BackendManager.prototype, "readMachinePython").mockResolvedValue("python");
    vi.spyOn(BackendManager.prototype, "writeMachinePython").mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "inspectPython").mockResolvedValue({
      pythonPath: "python",
      isManaged: false,
      isValid: true,
      isVenv: false,
      hasModule: true,
      version: "3.13.0",
    } as any);
    vi.spyOn(BackendManager.prototype, "managedRuntime").mockResolvedValue(null);
    vi.spyOn(BackendManager.prototype, "backendVersion").mockResolvedValue("0.1.64");

    h.notices.length = 0;
    const { plugin, getLayoutReadyCb } = createRealProductionStartupPlugin("vault-open");

    // Execute actual VaultSearchPlugin.prototype.onload
    await plugin.onload();

    // Verify sanitized flag is false
    expect((plugin as any).startupConfigSanitized).toBe(false);

    // Notice has ONLY coded diagnostic SERVICE_CONFIG_WRITE_FAILED; canary and raw disk errors are blocked
    expect(h.notices.some((n) => n.includes("SERVICE_CONFIG_WRITE_FAILED"))).toBe(true);
    expect(
      h.notices.some(
        (n) =>
          n.includes("CANARY_SECRET_PATH") || n.includes("Filesystem write failed"),
      ),
    ).toBe(false);

    // When real onLayoutReady callback registered by onload is invoked, it must NOT start backend
    const layoutCb = getLayoutReadyCb();
    expect(layoutCb).toBeDefined();
    layoutCb!();

    expect(startSpy).not.toHaveBeenCalled();
    expect(ensureStartedSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    expect(callSpy).not.toHaveBeenCalled();
    expect(sendMcpSecretsSpy).not.toHaveBeenCalled();

    // Verify all lifecycle methods fail closed while unsanitized
    await expect(plugin.startBackend()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    await expect(plugin.startLazyBackend()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    await expect(plugin.ensureSearchStarted()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    await expect(plugin.provisionOnnx()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    await expect(plugin.provisionBackend()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    await expect(plugin.restartBackend()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");

    expect(startSpy).not.toHaveBeenCalled();
    expect(ensureStartedSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();

    // Retry succeeds: recovery works normally
    persistSpy.mockResolvedValue(undefined);
    await expect(plugin.ensureSanitizedConfig()).resolves.toBeUndefined();
    expect((plugin as any).startupConfigSanitized).toBe(true);

    await expect(plugin.startBackend()).resolves.toBeUndefined();
    expect(ensureStartedSpy).toHaveBeenCalled();
  });

  it("first-search loadPolicy: 0 auto starts on layout ready and fails closed on ensureSearchStarted", async () => {
    vi.spyOn(BackendManager.prototype, "persistServiceConfig").mockRejectedValue(
      new Error("Disk permission denied"),
    );
    const startSpy = vi.spyOn(BackendManager.prototype, "start").mockResolvedValue(undefined);
    const ensureStartedSpy = vi
      .spyOn(BackendManager.prototype, "ensureStarted")
      .mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "ensureBackendProvisioned").mockResolvedValue({} as any);
    vi.spyOn(BackendManager.prototype, "readMachinePython").mockResolvedValue("python");
    vi.spyOn(BackendManager.prototype, "writeMachinePython").mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "backendVersion").mockResolvedValue("0.1.64");

    const { plugin, getLayoutReadyCb } = createRealProductionStartupPlugin("first-search");
    await plugin.onload();

    getLayoutReadyCb()?.();
    expect(startSpy).not.toHaveBeenCalled();
    expect(ensureStartedSpy).not.toHaveBeenCalled();

    // Search attempt fails closed without starting backend
    await expect(plugin.ensureSearchStarted()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    expect(startSpy).not.toHaveBeenCalled();
    expect(ensureStartedSpy).not.toHaveBeenCalled();
  });

  it("manual loadPolicy: 0 auto starts and retries sanitation on explicit start", async () => {
    const persistSpy = vi
      .spyOn(BackendManager.prototype, "persistServiceConfig")
      .mockRejectedValue(new Error("Disk permission denied"));
    const startSpy = vi.spyOn(BackendManager.prototype, "start").mockResolvedValue(undefined);
    const ensureStartedSpy = vi
      .spyOn(BackendManager.prototype, "ensureStarted")
      .mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "ensureBackendProvisioned").mockResolvedValue({} as any);
    vi.spyOn(BackendManager.prototype, "readMachinePython").mockResolvedValue("python");
    vi.spyOn(BackendManager.prototype, "writeMachinePython").mockResolvedValue(undefined);
    vi.spyOn(BackendManager.prototype, "inspectPython").mockResolvedValue({
      pythonPath: "python",
      isManaged: false,
      isValid: true,
      isVenv: false,
      hasModule: true,
      version: "3.13.0",
    } as any);
    vi.spyOn(BackendManager.prototype, "managedRuntime").mockResolvedValue(null);
    vi.spyOn(BackendManager.prototype, "backendVersion").mockResolvedValue("0.1.64");

    const { plugin, getLayoutReadyCb } = createRealProductionStartupPlugin("manual");
    await plugin.onload();

    getLayoutReadyCb()?.();
    expect(startSpy).not.toHaveBeenCalled();
    expect(ensureStartedSpy).not.toHaveBeenCalled();

    // Explicit start fails closed
    await expect(plugin.startBackend()).rejects.toThrow("SERVICE_CONFIG_WRITE_FAILED");
    expect(startSpy).not.toHaveBeenCalled();

    // Retry succeeds on sanitation fix
    persistSpy.mockResolvedValue(undefined);
    await expect(plugin.startBackend()).resolves.toBeUndefined();
    expect(ensureStartedSpy).toHaveBeenCalled();
  });
});
