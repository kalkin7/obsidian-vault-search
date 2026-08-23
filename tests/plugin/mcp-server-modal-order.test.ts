import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression for v0.1.60 user report: the transport selector rendered LAST
// because the stdio/http field wrappers were appended to the container before
// the dropdown. This test records the actual Setting creation order through a
// mocked obsidian module so the layout cannot silently regress again.

const h = vi.hoisted(() => ({
  settingOrder: [] as string[],
  settings: [] as any[],
  buttons: [] as any[],
  notices: [] as string[],
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
    createDiv(options?: { cls?: string }) {
      const element = new FakeEl();
      if (options?.cls) element.classes.push(...options.cls.split(" "));
      this.children.push(element);
      return element;
    }
    createEl(
      _tag: string,
      options?: { text?: string; cls?: string; attr?: Record<string, unknown> },
    ) {
      const element = new FakeEl();
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
    addClass() {}
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
    removeEventListener() {}
    click() {
      for (const handler of this.listeners.click ?? []) handler();
    }
    empty() {
      this.children = [];
    }
    querySelectorAll() {
      return [];
    }
  }

  class Notice {
    constructor(public message: string) {
      h.notices.push(message);
    }
  }

  class Setting {
    name = "";
    components: any[] = [];
    buttons: any[] = [];
    constructor(parent?: FakeEl) {
      parent?.children.push(this as unknown as FakeEl);
      h.settings.push(this);
    }
    setName(name: string) {
      this.name = name;
      h.settingOrder.push(name);
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
    addButton(
      callback: (button: Record<string, unknown>) => unknown,
    ) {
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

  class Modal {
    app: unknown;
    isOpen = false;
    contentEl = new FakeEl();
    modalEl = new FakeEl();
    titleEl = new FakeEl();
    constructor(app?: unknown) {
      this.app = app;
    }
    open() {
      this.isOpen = true;
    }
    close() {
      this.isOpen = false;
    }
  }

  return { Notice, Setting, Modal };
});

import { McpServerEditorModal } from "../../src/mcp-server-modal";
import type { McpServerSettings } from "../../src/types";

function fixture(overrides: Partial<McpServerSettings> = {}): McpServerSettings {
  return {
    id: "srv-1",
    name: "Korean Law MCP",
    enabled: true,
    transport: "http",
    command: "",
    args: [],
    cwd: "vault",
    url: "https://mcp.gomdori.app/law?oc=x",
    envNames: [],
    toolPolicies: {},
    ...overrides,
  };
}

async function openModal(working: McpServerSettings) {
  const owner = {
    app: {},
    draftSettings: { mcpServers: [fixture()] },
    refreshMcpStatus: async () => ({
      enabled: true,
      servers: [],
      connected: 0,
    }),
  };
  const modal = new McpServerEditorModal(owner as never, working, {
    onSaved: () => undefined,
    hasEnvValue: () => false,
    saveEnvValue: async () => undefined,
    removeEnvValue: async () => undefined,
  });
  modal.onOpen();
  // DOM shape: contentEl → [basicsContainer, …]. Inside basicsContainer:
  // [표시명, 연결 방식, stdioFields, httpFields].
  const basics = (modal.contentEl as unknown as { children: FakeElLike[] })
    .children[0];
  const wrappers = basics.children;
  return { modal, wrappers };
}

beforeEach(() => {
  h.settingOrder.length = 0;
  h.settings.length = 0;
  h.buttons.length = 0;
  h.notices.length = 0;
  vi.stubGlobal("document", {
    createElement: () => ({
      type: "",
      value: "",
      placeholder: "",
      className: "",
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

type FakeElLike = { classes: string[]; children?: FakeElLike[] };

describe("MCP editor modal field order", () => {
  it("renders the transport selector directly below the display name", async () => {
    await openModal(fixture());
    expect(h.settingOrder[0]).toBe("표시명");
    expect(h.settingOrder[1]).toBe("연결 방식");
    expect(h.settingOrder.indexOf("실행 명령")).toBeGreaterThan(
      h.settingOrder.indexOf("연결 방식"),
    );
  });

  it("hides local command fields and shows the URL field for http servers", async () => {
    const { wrappers } = await openModal(fixture({ transport: "http" }));
    expect(wrappers[2]?.classes).toContain("is-hidden"); // stdio group
    expect(wrappers[3]?.classes).not.toContain("is-hidden"); // http group
    expect(h.settingOrder).toContain("서버 URL");
  });

  it("shows local fields after the selector for stdio servers", async () => {
    const { wrappers } = await openModal(fixture({ transport: "stdio" }));
    const transportAt = h.settingOrder.indexOf("연결 방식");
    expect(transportAt).toBe(1);
    expect(h.settingOrder.indexOf("실행 명령")).toBeGreaterThan(transportAt);
    expect(h.settingOrder.indexOf("인자")).toBeGreaterThan(transportAt);
    expect(h.settingOrder.indexOf("작업 폴더")).toBeGreaterThan(transportAt);
    expect(wrappers[3]?.classes).toContain("is-hidden"); // http group
  });
});

describe("MCP editor modal tool policy toggles", () => {
  type NodeLike = {
    children?: NodeLike[];
    attrs?: Record<string, string>;
  };
  function collect(node: NodeLike): NodeLike[] {
    const out: NodeLike[] = [node];
    for (const child of node.children ?? []) out.push(...collect(child));
    return out;
  }


  it("bulk row applies to every tool and single rows override one tool", async () => {
    const working = fixture({
      transport: "http",
      toolPolicies: { get_law_text: "deny" },
    });
    const owner = {
      app: {},
      draftSettings: { mcpServers: [working] },
      refreshMcpStatus: async () => ({
        enabled: true,
        servers: [
          {
            id: "srv-1",
            name: "Korean Law MCP",
            state: "connected" as const,
            enabled: true,
            command: "",
            tools: 2,
            tool_names: ["get_law_text", "search_law"],
            env_names: [],
            tool_policies: {},
          },
        ],
        connected: 1,
      }),
    };
    const modal = new McpServerEditorModal(
      owner as never,
      working,
      {
        onSaved: () => undefined,
        hasEnvValue: () => false,
        saveEnvValue: async () => undefined,
        removeEnvValue: async () => undefined,
      },
    );
    modal.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const contentEl = (modal as unknown as { contentEl: NodeLike }).contentEl;
    const buttons = collect(contentEl).filter(
      (node) => node.attrs?.["aria-label"]?.includes("자동 허용") || node.attrs?.["aria-label"]?.includes("거부"),
    );
    const byLabel = (label: string) =>
      buttons.find((button) => button.attrs["aria-label"] === label);

    // Bulk row: 모든 도구 (2개 도구) — apply allow everywhere.
    byLabel("2개 도구 자동 허용")!.click();
    expect(working.toolPolicies).toEqual({
      get_law_text: "allow",
      search_law: "allow",
    });

    // Single row: override exactly one tool back to deny.
    byLabel("search_law 거부")!.click();
    expect(working.toolPolicies["search_law"]).toBe("deny");
    expect(working.toolPolicies["get_law_text"]).toBe("allow");
  });
});

describe("MCP editor modal secret staging and lifecycle", () => {
  it("places actions bar at the very bottom after tools section in DOM", async () => {
    const working = fixture({ transport: "stdio" });
    const { modal } = await openModal(working);
    const children = (modal.contentEl as unknown as { children: FakeElLike[] })
      .children;
    const lastChild = children[children.length - 1];
    expect(lastChild.classes).toContain("vault-search-mcp-editor-actions");
  });

  it("stages secret edits in memory and only applies on save", async () => {
    const working = fixture({
      transport: "stdio",
      envNames: ["API_KEY"],
      command: "python",
    });
    let stagedResult: {
      envValues: Record<string, string>;
      removedEnvNames: string[];
      httpUrl?: string | null;
    } | null = null;
    let saved = false;

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({
          enabled: true,
          servers: [],
          connected: 0,
        }),
      } as never,
      working,
      {
        onSaved: () => {
          saved = true;
        },
        hasEnvValue: () => false,
        saveAllSecrets: async (staged) => {
          stagedResult = staged;
        },
      },
    );
    modal.onOpen();

    // Staged secret commit on save:
    (modal as unknown as { stagedEnvValues: Map<string, string | null> }).stagedEnvValues.set(
      "API_KEY",
      "staged-secret-value",
    );

    await (modal as unknown as { commitStagedSecrets: () => Promise<void> }).commitStagedSecrets();
    expect(stagedResult).toEqual({
      envValues: { API_KEY: "staged-secret-value" },
      removedEnvNames: [],
      httpUrl: undefined,
    });
  });

  it("dynamically toggles stdio fields, http fields, and env section upon dropdown change event", async () => {
    const working = fixture({ transport: "stdio", command: "python" });
    const { modal, wrappers } = await openModal(working);

    const stdioGroup = wrappers[2];
    const httpGroup = wrappers[3];
    const envSection = (modal as unknown as { envSectionEl: FakeElLike }).envSectionEl;

    // Initially stdio: stdio visible, http hidden, env visible
    expect(stdioGroup?.classes).not.toContain("is-hidden");
    expect(httpGroup?.classes).toContain("is-hidden");
    expect(envSection?.classes).not.toContain("is-hidden");

    // Simulate user selecting "http" in dropdown
    const applyVisibility = (modal as unknown as { applyVisibility: () => void }).applyVisibility;
    working.transport = "http";
    applyVisibility();

    // Now http: stdio hidden, http visible, env hidden
    expect(stdioGroup?.classes).toContain("is-hidden");
    expect(httpGroup?.classes).not.toContain("is-hidden");
    expect(envSection?.classes).toContain("is-hidden");

    // Switch back to stdio
    working.transport = "stdio";
    applyVisibility();
    expect(stdioGroup?.classes).not.toContain("is-hidden");
    expect(httpGroup?.classes).toContain("is-hidden");
    expect(envSection?.classes).not.toContain("is-hidden");
  });

  it("re-enables controls and does not close modal when onSave transaction fails", async () => {
    const working = fixture({ transport: "stdio", command: "python" });
    let onSaveCalls = 0;

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({
          enabled: true,
          servers: [],
          connected: 0,
        }),
      } as never,
      working,
      {
        hasEnvValue: () => false,
        onSave: async () => {
          onSaveCalls++;
          throw new Error("SecretStorage write failure");
        },
      },
    );
    const closeSpy = vi.spyOn(modal, "close");
    modal.open();
    modal.onOpen();

    const saveButton = h.buttons.find((b: any) => b.text === "저장");
    const cancelButton = h.buttons.find((b: any) => b.text === "취소");
    expect(saveButton).toBeDefined();
    expect(cancelButton).toBeDefined();

    // Click actual Save button handler and wait for rejected save action
    await saveButton.click();

    // Verify onSave was called exactly once
    expect(onSaveCalls).toBe(1);

    // Verify modal is not closed on failed save
    expect(closeSpy).not.toHaveBeenCalled();
    expect(modal.isOpen).toBe(true);

    // Verify Save and Cancel buttons were re-enabled
    expect(saveButton.disabled).toBe(false);
    expect(cancelButton.disabled).toBe(false);

    // Verify notice was shown
    expect(h.notices).toContain("SecretStorage write failure");
  });

  it("blocks all close pathways while save promise is pending, allowing close only after completion", async () => {
    const working = fixture({ transport: "http", url: "https://mcp.example.com" });
    let resolveSave!: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({ enabled: true, servers: [], connected: 0 }),
      } as never,
      working,
      {
        hasEnvValue: () => false,
        onSave: async () => {
          await savePromise;
        },
      },
    );
    const superCloseSpy = vi.spyOn(Object.getPrototypeOf(McpServerEditorModal.prototype), "close");
    modal.open();
    modal.onOpen();

    const saveButton = h.buttons.find((b: any) => b.text === "저장");
    const cancelButton = h.buttons.find((b: any) => b.text === "취소");
    expect(saveButton).toBeDefined();
    expect(cancelButton).toBeDefined();

    // 1. Trigger Save (pending)
    const runningSave = saveButton.click();

    // While saving is pending:
    // Try Cancel button
    await cancelButton.click();
    expect(superCloseSpy).not.toHaveBeenCalled();

    // Try direct modal.close() (Escape / backdrop / X button)
    modal.close();
    expect(superCloseSpy).not.toHaveBeenCalled();

    // 2. Resolve save promise
    resolveSave();
    await runningSave;

    // After successful save, modal close succeeded
    expect(superCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("restores originalSafeOrigin and un-stages secret replacement when input is cleared via event handler", () => {
    const working = fixture({ transport: "http", url: "https://initial.example.com" });
    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({ enabled: true, servers: [], connected: 0 }),
      } as never,
      working,
      { hasEnvValue: () => false },
    );
    modal.open();
    modal.onOpen();

    // Find the URL setting input component
    const urlSetting = h.settings.find((s: any) => s.name === "서버 URL");
    expect(urlSetting).toBeDefined();
    const urlComponent = urlSetting.components[0];
    expect(urlComponent).toBeDefined();

    // User types new full URL with token
    urlComponent.triggerChange("https://new.example.com/mcp?token=xyz");
    expect(working.url).toBe("https://new.example.com");

    // User clears the text input
    urlComponent.triggerChange("");
    expect(working.url).toBe("https://initial.example.com");
  });

  it("invokes onCancelledNew exactly once on modal close without double-calling across multiple close paths", () => {
    const working = fixture({ transport: "http", url: "https://new.example.com" });
    let cancelledCalls = 0;

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [] },
        refreshMcpStatus: async () => ({ enabled: true, servers: [], connected: 0 }),
      } as never,
      working,
      {
        hasEnvValue: () => false,
        onCancelledNew: () => {
          cancelledCalls++;
        },
      },
    );
    modal.open();
    modal.onOpen();

    // Initial close without save invokes onCancelledNew once
    modal.onClose();
    expect(cancelledCalls).toBe(1);

    // Subsequent close / unmount does not invoke onCancelledNew again
    modal.onClose();
    expect(cancelledCalls).toBe(1);
  });

  it("ensures short staged secrets (<4 chars) are not leaked in modal Notice on save failure", async () => {
    const working = fixture({ transport: "stdio", command: "python", envNames: ["SECRET_KEY"] });
    const shortCanary = "xyz";

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({ enabled: true, servers: [], connected: 0 }),
      } as never,
      working,
      {
        hasEnvValue: () => false,
        onSave: async () => {
          throw new Error("MCP_SECRET_COMMIT_FAILED: 서버(srv-1) 환경 변수(SECRET_KEY) 보안 저장소 저장에 실패했습니다.");
        },
      },
    );
    modal.open();
    modal.onOpen();

    (modal as unknown as { stagedEnvValues: Map<string, string | null> }).stagedEnvValues.set(
      "SECRET_KEY",
      shortCanary,
    );

    const saveButton = h.buttons.find((b: any) => b.text === "저장");
    await saveButton.click();

    expect(h.notices.length).toBeGreaterThan(0);
    const lastNotice = h.notices[h.notices.length - 1];
    expect(lastNotice).toContain("MCP_SECRET_COMMIT_FAILED");
    expect(lastNotice).not.toContain(shortCanary);
  });

  it("ensures legacy saveAllSecrets throwing error does not leak short canary in Notice", async () => {
    const working = fixture({ transport: "stdio", command: "python", envNames: ["SECRET_KEY"] });
    const shortCanary = "abc";

    const modal = new McpServerEditorModal(
      {
        app: {},
        draftSettings: { mcpServers: [working] },
        refreshMcpStatus: async () => ({ enabled: true, servers: [], connected: 0 }),
      } as never,
      working,
      {
        hasEnvValue: () => false,
        saveAllSecrets: async () => {
          throw new Error(`Legacy store failed with raw short: ${shortCanary}`);
        },
      },
    );
    modal.open();
    modal.onOpen();

    (modal as unknown as { stagedEnvValues: Map<string, string | null> }).stagedEnvValues.set(
      "SECRET_KEY",
      shortCanary,
    );

    const saveButton = h.buttons.find((b: any) => b.text === "저장");
    await saveButton.click();

    expect(h.notices.length).toBeGreaterThan(0);
    const lastNotice = h.notices[h.notices.length - 1];
    expect(lastNotice).toContain("MCP_SECRET_COMMIT_FAILED");
    expect(lastNotice).not.toContain(shortCanary);
  });
});
