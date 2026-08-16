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
  children: StubElement[] = [];
  textContent = "";
  value = "";
  classList = {
    add: (..._names: string[]) => undefined,
    remove: (..._names: string[]) => undefined,
  };
  createEl(_tag: string, options?: { text?: string }): StubElement {
    const child = new StubElement();
    child.textContent = options?.text || "";
    this.children.push(child);
    return child;
  }
  createDiv(options?: { text?: string }): StubElement {
    return this.createEl("div", options);
  }
  createSpan(options?: { text?: string }): StubElement {
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
  addEventListener(): void {}
  removeEventListener(): void {}
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
