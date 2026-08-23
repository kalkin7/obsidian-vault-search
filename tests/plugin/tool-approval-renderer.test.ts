import { describe, expect, it } from "vitest";
import { StubElement } from "./obsidian-stub";
import {
  renderToolApprovalCard,
  renderToolActivity,
} from "../../src/tool-approval-renderer";
import type { PendingToolCall, ToolActivityEntry } from "../../src/types";

const call: PendingToolCall = {
  call_id: "c1",
  tool_name: "mcp__github__create_issue",
  server_name: "github",
  display_name: "create_issue",
  description: "Creates an issue",
  arguments: { title: "hello" },
};

function renderCard(decisions: string[]) {
  const container = new StubElement();
  renderToolApprovalCard(
    container as unknown as HTMLElement,
    call,
    {
      onDecide: (decision) => decisions.push(decision.decision),
      onCancel: () => undefined,
    },
  );
  return container;
}

describe("tool approval card", () => {
  it("labels every action for keyboards and screen readers", () => {
    const decisions: string[] = [];
    const container = renderCard(decisions);
    const buttons = (container as unknown as StubElement).querySelectorAll(
      "button",
    );
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      const label =
        button.attributes["aria-label"] || button.attributes["type"];
      expect(label).toBeDefined();
    }
    // The arguments block is collapsible and carries the call arguments.
    const stub = container as unknown as StubElement;
    const findTag = (node: StubElement, tag: string): StubElement | null => {
      for (const child of node.children) {
        if (child.tag === tag) return child;
        const deeper = findTag(child, tag);
        if (deeper) return deeper;
      }
      return null;
    };
    expect(findTag(stub, "details")).not.toBeNull();
    expect(stub.flattenedText).toContain("title");
  });

  it("executes exactly once despite double clicks", () => {
    const decisions: string[] = [];
    const card = renderCard(decisions);
    const buttons = (card as unknown as StubElement).querySelectorAll("button");
    const once = buttons[0];
    once.dispatch("click");
    expect(decisions).toEqual(["allow_once"]);
    // Every button is disabled after the first click; further clicks must
    // not produce additional decisions.
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      button.dispatch("click");
    }
    expect(decisions).toEqual(["allow_once"]);
  });

  it("passes reject decisions through", () => {
    const decisions: string[] = [];
    const card = renderCard(decisions);
    const buttons = (card as unknown as StubElement).querySelectorAll("button");
    buttons[2].dispatch("click");
    expect(decisions).toEqual(["reject"]);
  });
});

describe("tool activity rendering", () => {
  it("renders nothing without entries", () => {
    const container = new StubElement();
    renderToolActivity(container as unknown as HTMLElement, []);
    expect(container.children).toHaveLength(0);
  });

  it("lists status labels for every entry", () => {
    const container = new StubElement();
    const entries: ToolActivityEntry[] = [
      {
        toolName: "mcp__a__b",
        serverName: "a",
        status: "success",
        durationMs: 42,
      },
      { toolName: "vault_read", status: "rejected" },
    ];
    renderToolActivity(container as unknown as HTMLElement, entries);
    const text = (container as unknown as StubElement).flattenedText;
    expect(text).toContain("도구 사용 (2)");
    expect(text).toContain("성공");
    expect(text).toContain("거부됨");
  });
});
