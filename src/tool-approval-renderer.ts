import type { AnswerDecision } from "./answer-session";
import type { PendingToolCall, ToolActivityEntry } from "./types";

export interface ApprovalCardCallbacks {
  /** Called once per user action with exactly one decision. */
  onDecide(decision: AnswerDecision): void;
  onCancel(): void;
}

function formatArguments(arguments_: Record<string, unknown>): string {
  try {
    return JSON.stringify(arguments_, null, 2);
  } catch {
    return String(arguments_);
  }
}

/** One approval card per pending call (plan §12.2). Every button is keyboard
 *  reachable, labelled for screen readers, and disabled after the first
 *  click so a tool can never be executed twice from double clicks. */
export function renderToolApprovalCard(
  container: HTMLElement,
  call: PendingToolCall,
  callbacks: ApprovalCardCallbacks,
): void {
  const card = container.createDiv({ cls: "vault-tool-approval" });
  const head = card.createDiv({ cls: "vault-tool-approval-head" });
  const title = head.createDiv({ cls: "vault-tool-approval-title" });
  title.createEl("span", {
    text: `${call.server_name} · ${call.display_name}`,
    cls: "vault-tool-approval-name",
  });
  const badge = title.createEl("span", {
    text: "실행 승인 필요",
    cls: "vault-tool-approval-badge",
  });
  badge.setAttribute("aria-label", "도구 실행 승인 대기");

  if (call.description) {
    card.createDiv({
      cls: "vault-tool-approval-description",
      text: call.description,
    });
  }

  const details = card.createEl("details", {
    cls: "vault-tool-approval-args",
  });
  details.createEl("summary", { text: "인자 확인" });
  const pre = details.createEl("pre", {
    cls: "vault-tool-approval-args-body",
    attr: { "aria-label": "도구 호출 인자" },
  });
  pre.setText(formatArguments(call.arguments));

  const actions = card.createDiv({ cls: "vault-tool-approval-actions" });
  let settled = false;
  const guard = (button: HTMLButtonElement, decision: AnswerDecision) => {
    if (settled) return;
    settled = true;
    for (const child of Array.from(actions.querySelectorAll("button"))) {
      (child as HTMLButtonElement).disabled = true;
    }
    callbacks.onDecide(decision);
  };
  const once = actions.createEl("button", {
    text: "한 번 허용",
    cls: "mod-cta",
    attr: {
      type: "button",
      "aria-label": `${call.display_name} 도구를 한 번만 실행 허용`,
    },
  });
  once.addEventListener("click", () =>
    guard(once, { call_id: call.call_id, decision: "allow_once" }),
  );
  const session = actions.createEl("button", {
    text: "이 대화에서 허용",
    attr: {
      type: "button",
      "aria-label": `${call.display_name} 도구를 현재 대화 내내 허용`,
    },
  });
  session.addEventListener("click", () =>
    guard(session, { call_id: call.call_id, decision: "allow_session" }),
  );
  const reject = actions.createEl("button", {
    text: "거부",
    attr: {
      type: "button",
      "aria-label": `${call.display_name} 도구 실행 거부`,
    },
  });
  reject.addEventListener("click", () =>
    guard(reject, { call_id: call.call_id, decision: "reject" }),
  );
}

/** Running state with cancel — shown between approval and completion. */
export function renderToolRunning(
  container: HTMLElement,
  calls: PendingToolCall[],
  onCancel: () => void,
): HTMLElement {
  const block = container.createDiv({ cls: "vault-tool-running" });
  const label = block.createDiv({ cls: "vault-ai-search-thinking" });
  const names = calls.map((call) => call.display_name).join(", ");
  label.setText(`도구 실행 중… ${names}`);
  const cancel = block.createEl("button", {
    text: "취소",
    attr: { type: "button", "aria-label": "도구 실행 취소" },
  });
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    onCancel();
  });
  return block;
}

/** Safe activity metadata under an answer (never raw args/results). */
export function renderToolActivity(
  container: HTMLElement,
  entries: ToolActivityEntry[],
): void {
  if (!entries.length) return;
  const details = container.createEl("details", {
    cls: "vault-tool-activity",
  });
  details.createEl("summary", {
    text: `도구 사용 (${entries.length})`,
  });
  const list = details.createDiv({ cls: "vault-tool-activity-list" });
  for (const entry of entries) {
    const row = list.createDiv({ cls: "vault-tool-activity-row" });
    const statusLabel =
      entry.status === "success"
        ? "성공"
        : entry.status === "error"
          ? "오류"
          : entry.status === "rejected"
            ? "거부됨"
            : "취소됨";
    row.createEl("span", {
      text: `${entry.toolName}${entry.serverName ? ` · ${entry.serverName}` : ""} · ${statusLabel}`,
      cls: `vault-tool-activity-status vault-tool-activity-${entry.status}`,
    });
    if (typeof entry.durationMs === "number") {
      row.createEl("span", {
        text: `${entry.durationMs}ms`,
        cls: "vault-tool-activity-duration",
      });
    }
    if (entry.truncated) {
      row.createEl("span", {
        text: "잘림",
        cls: "vault-tool-activity-truncated",
      });
    }
  }
}
