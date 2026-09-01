/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock("obsidian", () => {
  class FakeEl {
    children: any[] = [];
    createDiv() { return new FakeEl(); }
    createEl() { return new FakeEl(); }
    empty() {}
    setText() {}
    appendChild() {}
    addClass() {}
    removeClass() {}
    setAttr() {}
  }
  class Notice {
    constructor(public message: string, public timeout?: number) {
      h.notices.push(message);
    }
  }
  class Setting {
    controlEl = new FakeEl();
    settingEl = new FakeEl();
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
    addTextArea() { return this; }
    addDropdown() { return this; }
    addToggle() { return this; }
    addButton() { return this; }
  }
  class PluginSettingTab { constructor(public app: any, public plugin: any) {} containerEl = new FakeEl(); }
  class Plugin {
    app: any = {};
    manifest: any = { id: "obsidian-vault-search", version: "0.1.67" };
    registerEvent() {}
    registerView() {}
    addSettingTab() {}
    addRibbonIcon() { return {}; }
    addCommand() {}
    loadData = vi.fn(async () => ({}));
    saveData = vi.fn(async () => {});
  }
  class FileSystemAdapter { getBasePath() { return "C:/vault"; } }
  class TFile {}
  class Modal { contentEl = new FakeEl(); modalEl = new FakeEl(); titleEl = new FakeEl(); constructor(public app: any) {} open() {} close() {} }
  class SuggestModal extends Modal {}
  class ItemView { containerEl = new FakeEl(); constructor(public leaf: any) {} }
  class WorkspaceLeaf {}
  return {
    Notice,
    Setting,
    PluginSettingTab,
    Plugin,
    FileSystemAdapter,
    TFile,
    Modal,
    SuggestModal,
    ItemView,
    WorkspaceLeaf,
    requestUrl: vi.fn(() => Promise.resolve({ json: { data: [] } })),
    setIcon: vi.fn(),
    addIcon: vi.fn(),
  };
});

import VaultSearchPlugin from "../../src/main";
import * as agentIntegration from "../../src/agent-integration";

function createPlugin() {
  const plugin = Object.create(VaultSearchPlugin.prototype) as any;
  plugin.manifest = { id: "obsidian-vault-search", version: "0.1.67" };
  plugin.backend = { vaultPath: "C:/vault", pluginDir: "C:/vault/.obsidian/plugins/obsidian-vault-search" };
  plugin.settingTab = { display: vi.fn() };
  plugin.app = {};
  plugin._unloaded = false;
  plugin._agentIntegrationTask = null;
  return plugin as VaultSearchPlugin & { _unloaded: boolean; settingTab: { display: ReturnType<typeof vi.fn> } };
}

describe("refreshAgentIntegration async lifetime", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deferred status: unload 후 resolve 시 display 호출되지 않고 unhandled rejection 없음", async () => {
    let resolveDeferred!: (v: any) => void;
    const deferred = new Promise<any>((res) => {
      resolveDeferred = res;
    });
    vi.spyOn(agentIntegration, "agentIntegrationStatus").mockImplementation(() => deferred as any);

    const plugin: any = createPlugin();
    const unhandled: unknown[] = [];
    const handler = (e: PromiseRejectionEvent) => unhandled.push(e);
    window.addEventListener("unhandledrejection", handler as any);

    plugin._agentIntegrationTask = plugin.refreshAgentIntegration().catch((e: unknown) => {
      console.warn("[vault-search] refreshAgentIntegration failed", e);
    });

    plugin._unloaded = true;

    resolveDeferred({ agentsFile: "absent", claudeFile: "absent", wrapper: false, skill: "absent", agentsSkill: false });

    await plugin._agentIntegrationTask;
    await new Promise((r) => setTimeout(r, 10));

    expect(plugin.settingTab.display).not.toHaveBeenCalled();
    expect(unhandled.length).toBe(0);

    window.removeEventListener("unhandledrejection", handler as any);
  });

  it("deferred rejection도 unhandled 없이 catch로 처리되고 display 호출 안 함", async () => {
    let rejectDeferred!: (e: any) => void;
    const deferred = new Promise<any>((_, rej) => {
      rejectDeferred = rej;
    });
    vi.spyOn(agentIntegration, "agentIntegrationStatus").mockImplementation(() => deferred as any);

    const plugin: any = createPlugin();
    const unhandled: unknown[] = [];
    const handler = (e: PromiseRejectionEvent) => unhandled.push(e);
    window.addEventListener("unhandledrejection", handler as any);

    plugin._agentIntegrationTask = plugin.refreshAgentIntegration().catch((e: unknown) => {
      console.warn("[vault-search] refreshAgentIntegration failed", e);
    });

    plugin._unloaded = true;
    rejectDeferred(new Error("status failed"));

    await plugin._agentIntegrationTask;
    await new Promise((r) => setTimeout(r, 10));

    expect(plugin.settingTab.display).not.toHaveBeenCalled();
    expect(unhandled.length).toBe(0);
    expect(console.warn).toHaveBeenCalled();

    window.removeEventListener("unhandledrejection", handler as any);
  });

  it("unload 전 resolve 시 display 호출됨", async () => {
    vi.spyOn(agentIntegration, "agentIntegrationStatus").mockImplementation(async () => ({ agentsFile: "managed", claudeFile: "managed", wrapper: true, skill: "managed", agentsSkill: true } as any));
    const plugin: any = createPlugin();
    await plugin.refreshAgentIntegration();
    expect(plugin.settingTab.display).toHaveBeenCalledTimes(1);
  });

  it("document/ReferenceError 를 삼키지 않고 throw 함", async () => {
    vi.spyOn(agentIntegration, "agentIntegrationStatus").mockImplementation(async () => ({ agentsFile: "absent", claudeFile: "absent", wrapper: false, skill: "absent", agentsSkill: false } as any));
    const plugin: any = createPlugin();
    plugin.settingTab.display = vi.fn(() => {
      throw new ReferenceError("document is not defined");
    });
    await expect(plugin.refreshAgentIntegration()).rejects.toThrow(ReferenceError);
    const plugin2: any = createPlugin();
    plugin2._unloaded = true;
    plugin2.settingTab.display = vi.fn(() => {
      throw new ReferenceError("document is not defined");
    });
    vi.spyOn(agentIntegration, "agentIntegrationStatus").mockImplementation(async () => ({ agentsFile: "absent", claudeFile: "absent", wrapper: false, skill: "absent", agentsSkill: false } as any));
    await expect(plugin2.refreshAgentIntegration()).resolves.toBeUndefined();
    expect(plugin2.settingTab.display).not.toHaveBeenCalled();
  });
});
