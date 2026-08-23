/** Minimal runtime stand-in for the `obsidian` module in vitest.
 *
 * The published `obsidian` package is types-only (no JS entry), so vite cannot
 * resolve it as a runtime module. Tests that exercise src modules importing
 * obsidian symbols alias it to this stub; `vi.mock("obsidian")` then overrides
 * the specific functions under test.
 */
export function requestUrl(): never {
  throw new Error("obsidian.requestUrl was not mocked");
}

/** Minimal Obsidian-compatible path normalization (used by history.ts). */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

class StubElement {
  tag = "div";
  children: StubElement[] = [];
  parent: StubElement | null = null;
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  textContent = "";
  value = "";
  disabled = false;
  classList = {
    add: (..._names: string[]) => undefined,
    remove: (..._names: string[]) => undefined,
  };
  createEl(tag: string, options?: { text?: string; cls?: string; attr?: Record<string, string | number> }): StubElement {
    const child = new StubElement();
    child.tag = tag;
    child.parent = this;
    if (options?.text !== undefined) child.textContent = options.text;
    if (options?.cls) child.classList.add(options.cls);
    for (const [key, val] of Object.entries(options?.attr || {})) {
      child.attributes[key] = String(val);
    }
    if (tag === "button") {
      // Mirror the disabled semantics real buttons need for the approval
      // double-click guard.
      let currentDisabled = false;
      Object.defineProperty(child, "disabled", {
        get: () => currentDisabled,
        set: (value: boolean) => {
          currentDisabled = value;
        },
      });
    }
    this.children.push(child);
    return child;
  }
  createDiv(options?: { text?: string; cls?: string }): StubElement {
    return this.createEl("div", options);
  }
  createSpan(options?: { text?: string; cls?: string }): StubElement {
    return this.createEl("span", options);
  }
  empty(): void {
    this.children = [];
    this.textContent = "";
  }
  setText(value: string): void {
    this.textContent = value;
  }
  addClass(...names: string[]): void {
    this.classList.add(...names);
  }
  removeClass(...names: string[]): void {
    this.classList.remove(...names);
  }
  addEventListener(type: string, handler: () => void): void {
    (this.listeners[type] ||= []).push(handler);
  }
  removeEventListener(type: string, handler: () => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter(
      (entry) => entry !== handler,
    );
  }
  /** Test helper: fire registered handlers without a real DOM event. */
  dispatch(type: string): void {
    for (const handler of [...(this.listeners[type] || [])]) handler();
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  /** Recursive text content (mirrors DOM textContent aggregation). */
  get flattenedText(): string {
    const parts: string[] = [this.textContent];
    for (const child of this.children) parts.push(child.flattenedText);
    return parts.join("");
  }
  querySelectorAll(selector: string): StubElement[] {
    const found: StubElement[] = [];
    const walk = (node: StubElement): void => {
      for (const child of node.children) {
        if (selector === "button" && child.tag === "button") found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  focus(): void {}
  setSelectionRange(): void {}
}

export class WorkspaceLeaf {
  view: unknown = null;
  private state: Record<string, unknown> = {};
  getViewState(): Record<string, unknown> {
    return this.state;
  }
  async setViewState(state: Record<string, unknown>): Promise<void> {
    this.state = state;
  }
}

export class ItemView {
  app: unknown;
  contentEl = new StubElement() as unknown as HTMLElement;
  leaf: WorkspaceLeaf;
  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.app = {};
  }
  async setState(_state: unknown, _result: unknown): Promise<void> {}
}

/** Exposed for DOM-behavior tests of pure renderer modules. */
export { StubElement };
