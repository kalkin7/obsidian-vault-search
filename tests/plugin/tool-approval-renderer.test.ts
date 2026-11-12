import { describe, expect, it, vi } from "vitest";
import {
  isTurnBudgetCall,
  renderToolApprovalCard,
  renderTurnBudgetCard,
} from "../../src/tool-approval-renderer";
import type { PendingToolCall } from "../../src/types";

/** Obsidian augments HTMLElement with createDiv/createEl; this fake mirrors the
 *  subset the approval cards use (same convention as answer-renderer.test.ts). */
interface FakeEl {
  children: FakeEl[];
  textContent: string;
  tag: string;
  cls: string;
  attrs: Record<string, string>;
  disabled: boolean;
  handlers: Record<string, () => void>;
  createDiv(options?: Record<string, unknown>): FakeEl;
  createEl(tag: string, options?: Record<string, unknown>): FakeEl;
  setText(value: string): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: () => void): void;
  querySelectorAll(selector: string): FakeEl[];
}

function makeEl(tag = "div"): FakeEl {
  const element: FakeEl = {
    children: [],
    textContent: "",
    tag,
    cls: "",
    attrs: {},
    disabled: false,
    handlers: {},
    createDiv(options?: Record<string, unknown>): FakeEl {
      return this.createEl("div", options);
    },
    createEl(tag: string, options?: Record<string, unknown>): FakeEl {
      const child = makeEl(tag);
      child.textContent = String(options?.text ?? "");
      child.cls = String(options?.cls ?? "");
      child.attrs = {
        ...((options?.attr as Record<string, string> | undefined) ?? {}),
      };
      this.children.push(child);
      return child;
    },
    setText(value: string): void {
      this.textContent = value;
    },
    setAttribute(name: string, value: string): void {
      this.attrs[name] = value;
    },
    addEventListener(type: string, handler: () => void): void {
      this.handlers[type] = handler;
    },
    querySelectorAll(selector: string): FakeEl[] {
      const wanted = selector.trim().toLowerCase();
      return this.children.filter((child) => child.tag === wanted);
    },
  };
  return element;
}

function collectText(el: FakeEl): string {
  return [
    el.textContent,
    ...el.children.map((child) => collectText(child)),
  ].join(" ");
}

function buttons(el: FakeEl): FakeEl[] {
  const hits: FakeEl[] = [];
  for (const child of el.children) {
    if (child.tag === "button") hits.push(child);
    hits.push(...buttons(child));
  }
  return hits;
}

function asHtml(el: FakeEl): HTMLElement {
  return el as unknown as HTMLElement;
}

function budgetCall(overrides: Partial<PendingToolCall> = {}): PendingToolCall {
  return {
    call_id: "turn_budget",
    tool_name: "turn_budget",
    server_name: "",
    display_name: "조사 한도",
    description:
      "조사 한도에 도달했습니다. 조사를 더 할까요, 아니면 지금까지 모은 자료로 답변할까요?",
    arguments: { turns: 10, max_turns: 10, tool_calls: 14, sources: 6 },
    annotations: { kind: "turn_budget" },
    ...overrides,
  };
}

describe("renderTurnBudgetCard", () => {
  it("offers continue / answer-now / cancel and reports one decision", () => {
    const container = makeEl();
    const onDecide = vi.fn();
    const onCancel = vi.fn();
    renderTurnBudgetCard(asHtml(container), budgetCall(), { onDecide, onCancel });

    const text = collectText(container);
    expect(text).toContain("조사 한도 도달");
    expect(text).toContain("지금까지 조사 10턴 · 근거 6건");

    const actions = buttons(container);
    expect(actions.map((button) => button.textContent)).toEqual([
      "계속 조사",
      "지금 답변",
      "취소",
    ]);

    actions[0].handlers.click();
    expect(onDecide).toHaveBeenCalledWith({
      call_id: "turn_budget",
      decision: "extend",
    });
    // Every button is disabled after the first click, so a double click can
    // never send two decisions for one pause.
    actions[1].handlers.click();
    actions[2].handlers.click();
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(actions.every((button) => button.disabled)).toBe(true);
  });

  it("answers now when the user declines more research", () => {
    const container = makeEl();
    const onDecide = vi.fn();
    renderTurnBudgetCard(asHtml(container), budgetCall(), {
      onDecide,
      onCancel: vi.fn(),
    });
    buttons(container)[1].handlers.click();
    expect(onDecide).toHaveBeenCalledWith({
      call_id: "turn_budget",
      decision: "answer_now",
    });
  });

  it("cancels through the cancel callback without a decision", () => {
    const container = makeEl();
    const onDecide = vi.fn();
    const onCancel = vi.fn();
    renderTurnBudgetCard(asHtml(container), budgetCall(), { onDecide, onCancel });
    buttons(container)[2].handlers.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("never shows MCP tool decisions for the reserved call id", () => {
    const container = makeEl();
    renderTurnBudgetCard(asHtml(container), budgetCall(), {
      onDecide: vi.fn(),
      onCancel: vi.fn(),
    });
    const labels = buttons(container).map((button) => button.textContent);
    expect(labels).not.toContain("한 번 허용");
    expect(labels).not.toContain("이 대화에서 허용");
    expect(labels).not.toContain("거부");
  });
});

describe("isTurnBudgetCall", () => {
  it("recognizes the reserved id and annotation", () => {
    expect(isTurnBudgetCall(budgetCall())).toBe(true);
    expect(
      isTurnBudgetCall(budgetCall({ annotations: { kind: "turn_budget" } })),
    ).toBe(true);
    expect(
      isTurnBudgetCall({
        call_id: "abc",
        tool_name: "create_issue",
        server_name: "srv",
        display_name: "create_issue",
        arguments: {},
      }),
    ).toBe(false);
  });
});

describe("renderToolApprovalCard", () => {
  it("keeps the MCP decision vocabulary for real tool calls", () => {
    const container = makeEl();
    const onDecide = vi.fn();
    renderToolApprovalCard(
      asHtml(container),
      {
        call_id: "c1",
        tool_name: "create_issue",
        server_name: "srv",
        display_name: "create_issue",
        arguments: { title: "x" },
      },
      { onDecide, onCancel: vi.fn() },
    );
    const actions = buttons(container);
    expect(actions.map((button) => button.textContent)).toEqual([
      "한 번 허용",
      "이 대화에서 허용",
      "거부",
    ]);
    actions[2].handlers.click();
    expect(onDecide).toHaveBeenCalledWith({
      call_id: "c1",
      decision: "reject",
    });
  });
});
