import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression for v0.1.60 user report: the transport selector rendered LAST
// because the stdio/http field wrappers were appended to the container before
// the dropdown. This test records the actual Setting creation order through a
// mocked obsidian module so the layout cannot silently regress again.

const h = vi.hoisted(() => ({ settingOrder: [] as string[] }));

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
      inputEl: { rows: 0 },
    };
    return component;
  }

  class FakeEl {
    children: FakeEl[] = [];
    classes: string[] = [];
    text = "";
    createDiv(options?: { cls?: string }) {
      const element = new FakeEl();
      if (options?.cls) element.classes.push(...options.cls.split(" "));
      this.children.push(element);
      return element;
    }
    createEl(_tag: string, options?: { text?: string; attr?: unknown }) {
      const element = new FakeEl();
      if (options?.text !== undefined) element.text = options.text;
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
    addEventListener() {}
    removeEventListener() {}
    empty() {
      this.children = [];
    }
    querySelectorAll() {
      return [];
    }
  }

  class Notice {
    constructor(public message: string) {}
  }

  class Setting {
    constructor(parent?: FakeEl) {
      parent?.children.push(this as unknown as FakeEl);
    }
    setName(name: string) {
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
      callback(makeComponent());
      return this;
    }
    addTextArea(
      callback: (component: ReturnType<typeof makeComponent>) => unknown,
    ) {
      callback(makeComponent());
      return this;
    }
    addDropdown(
      callback: (component: ReturnType<typeof makeComponent>) => unknown,
    ) {
      callback(makeComponent());
      return this;
    }
    addButton(
      callback: (button: Record<string, unknown>) => unknown,
    ) {
      const button = {
        setButtonText() {
          return button;
        },
        setCta() {
          return button;
        },
        setWarning() {
          return button;
        },
        setTooltip() {
          return button;
        },
        onClick() {
          return button;
        },
      };
      callback(button);
      return this;
    }
  }

  class Modal {
    app: unknown;
    contentEl = new FakeEl();
    modalEl = new FakeEl();
    titleEl = new FakeEl();
    constructor(app?: unknown) {
      this.app = app;
    }
    open() {}
    close() {}
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

type FakeElLike = { classes: string[]; children?: FakeElLike[] };

describe("MCP editor modal field order", () => {
  beforeEach(() => {
    h.settingOrder.length = 0;
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
  });

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
