import { describe, expect, it } from "vitest";
import { AnswerSession } from "../../src/answer-session";
import type { AnswerTransport } from "../../src/answer-session";
import type {
  AnswerResult,
  AnswerState,
  AnswerStartResponse,
  PendingToolCall,
} from "../../src/types";

const answer = (text: string): AnswerResult => ({
  answer: text,
  citations: [],
  evidence: [],
  provider: "openai",
  model: "test",
  grounded: true,
  diagnostics: {
    retrieved_count: 1,
    context_chars: 1,
    answer_chars: text.length,
  },
});

const complete = (text: string): AnswerStartResponse => ({
  status: "complete",
  result: answer(text),
});

const approvalCall = (callId: string): PendingToolCall => ({
  call_id: callId,
  tool_name: `mcp__srv__tool_${callId}`,
  server_name: "srv",
  display_name: `tool_${callId}`,
  arguments: { title: callId },
});

const approval = (
  runId: string,
  calls: PendingToolCall[],
): AnswerStartResponse => ({
  status: "approval_required",
  run_id: runId,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  calls,
});

interface Harness {
  session: AnswerSession;
  states: AnswerState[];
  starts: Array<Record<string, unknown>>;
  continues: Array<{ runId: string; decisions: unknown[] }>;
  cancels: string[];
  /** Resolve the OLDEST pending start (FIFO), matching real request order. */
  settleStart(value: AnswerStartResponse): void;
}

function makeHarness(): Harness {
  const states: AnswerState[] = [];
  const starts: Array<Record<string, unknown>> = [];
  const continues: Array<{ runId: string; decisions: unknown[] }> = [];
  const cancels: string[] = [];
  const pendingStarts: Array<(value: AnswerStartResponse) => void> = [];
  const transport: AnswerTransport = {
    start: async (params) => {
      starts.push(params as Record<string, unknown>);
      return new Promise<AnswerStartResponse>((resolve) => {
        pendingStarts.push(resolve);
      });
    },
    continue: async (runId, decisions) => {
      continues.push({ runId, decisions });
      return complete(`continued ${runId}`);
    },
    cancel: async (runId) => {
      cancels.push(runId);
      return { cancelled: true };
    },
  };
  const session = new AnswerSession(transport, (state) =>
    states.push(state),
  );
  return {
    session,
    states,
    starts,
    continues,
    cancels,
    settleStart: (value) => {
      pendingStarts.shift()?.(value);
    },
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("AnswerSession", () => {
  it("keeps the full transcript and sends only the recent window", async () => {
    const harness = makeHarness();
    for (const query of ["one", "two", "three", "four", "five"]) {
      harness.session.submit(query);
      harness.settleStart(complete(`answer ${query}`));
      await flush();
    }
    // The backend gets the recent window (last 8 messages).
    expect(harness.starts.at(-1)?.conversation).toHaveLength(8);
    // The stored transcript is kept in full so history saving never truncates.
    expect(harness.session.conversation).toHaveLength(10);
    expect(harness.session.conversation.at(0)).toEqual({
      role: "user",
      content: "one",
    });
    expect(harness.states.at(-1)?.kind).toBe("answer");
  });

  it("does not render a stale response after clear", async () => {
    const harness = makeHarness();
    harness.session.submit("old");
    harness.session.clear();
    harness.settleStart(complete("old answer"));
    await flush();
    expect(harness.states.at(-1)).toEqual({ kind: "idle" });
  });

  it("restore invalidates an in-flight answer and drops approvals", async () => {
    const harness = makeHarness();
    harness.session.submit("old question");
    harness.settleStart(approval("run-1", [approvalCall("c1")]));
    await flush();
    expect(harness.states.at(-1)?.kind).toBe("tool-approval");
    harness.session.decide([
      { call_id: "c1", decision: "allow_session" },
    ]);
    await flush();
    // Restore while the continue round-trip would still be pending in real
    // usage; here the grant was recorded first.
    harness.session.restore([{ role: "user", content: "loaded" }]);
    harness.settleStart(complete("stale"));
    await flush();
    // The stale answer must not append into the restored conversation.
    expect(harness.session.conversation).toEqual([
      { role: "user", content: "loaded" },
    ]);
    expect(harness.states.at(-1)).toEqual({ kind: "idle" });
    // A follow-up question must NOT inherit the pre-restore tool grant.
    harness.session.submit("new conversation question");
    expect(harness.starts.at(-1)?.session_allowed_tools).toEqual([]);
  });

  it("surfaces approval_required and resumes with allow_once exactly once", async () => {
    const harness = makeHarness();
    harness.session.submit("도구 질문");
    harness.settleStart(
      approval("run-9", [approvalCall("c1"), approvalCall("c2")]),
    );
    await flush();
    const last = harness.states.at(-1);
    expect(last?.kind).toBe("tool-approval");
    if (last?.kind !== "tool-approval") return;
    expect(last.runId).toBe("run-9");
    expect(last.calls.map((c) => c.call_id)).toEqual(["c1", "c2"]);

    harness.session.decide([{ call_id: "c1", decision: "allow_once" }]);
    await flush();
    // Running state surfaced between decision and completion.
    expect(
      harness.states.some((state) => state.kind === "tool-running"),
    ).toBe(true);
    expect(harness.continues).toEqual([
      {
        runId: "run-9",
        decisions: [{ call_id: "c1", decision: "allow_once" }],
      },
    ]);
    expect(harness.states.at(-1)?.kind).toBe("answer");
    expect((harness.states.at(-1) as { result?: AnswerResult }).result?.answer).toBe(
      "continued run-9",
    );
  });

  it("allow_session persists the grant for later submits in the same conversation", async () => {
    const harness = makeHarness();
    harness.session.submit("첫 질문");
    harness.settleStart(approval("r1", [approvalCall("c1")]));
    await flush();
    harness.session.decide([
      { call_id: "c1", decision: "allow_session" },
    ]);
    await flush();
    harness.session.submit("다음 질문");
    expect(harness.starts.at(-1)?.session_allowed_tools).toContain(
      "mcp__srv__tool_c1",
    );
  });

  it("reject passes the rejection through and keeps the run alive", async () => {
    const harness = makeHarness();
    harness.session.submit("qq");
    harness.settleStart(approval("r2", [approvalCall("c1")]));
    await flush();
    harness.session.decide([{ call_id: "c1", decision: "reject" }]);
    await flush();
    expect(harness.continues[0].decisions).toEqual([
      { call_id: "c1", decision: "reject" },
    ]);
  });

  it("cancelActive notifies the backend and clears pending state", async () => {
    const harness = makeHarness();
    harness.session.submit("qq");
    harness.settleStart(approval("r3", [approvalCall("c1")]));
    await flush();
    const cancelled = await harness.session.cancelActive();
    expect(cancelled).toBe(true);
    expect(harness.cancels).toEqual(["r3"]);
    expect(harness.session.activeRun).toBeNull();
    const again = await harness.session.cancelActive();
    expect(again).toBe(false);
  });

  it("ignores a late start response from an older generation", async () => {
    const harness = makeHarness();
    harness.session.submit("first");
    harness.session.submit("second");
    harness.settleStart(complete("stale first"));
    await flush();
    harness.settleStart(complete("fresh second"));
    await flush();
    // Only the fresh answer landed.
    expect(harness.session.conversation.slice(-2)).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "fresh second" },
    ]);
  });

  it("dispose cancels a waiting run", async () => {
    const harness = makeHarness();
    harness.session.submit("qq");
    harness.settleStart(approval("r4", [approvalCall("c1")]));
    await flush();
    harness.session.dispose();
    await flush();
    expect(harness.cancels).toEqual(["r4"]);
  });

  it("clear resets the session approval set", async () => {
    const harness = makeHarness();
    harness.session.submit("qq");
    harness.settleStart(approval("r5", [approvalCall("c1")]));
    await flush();
    harness.session.decide([{ call_id: "c1", decision: "allow_session" }]);
    await flush();
    harness.session.clear();
    harness.session.submit("new conversation question");
    expect(harness.starts.at(-1)?.session_allowed_tools).toEqual([]);
  });
});

describe("AnswerSession client run id (fix §3)", () => {
  it("sends a client-generated run_id with every start", async () => {
    const harness = makeHarness();
    harness.session.submit("첫 질문");
    await flush();
    const runId = harness.starts[0]?.run_id;
    expect(typeof runId).toBe("string");
    expect(String(runId).length).toBeGreaterThanOrEqual(8);
    // The session tracks the run immediately so cancel can target it.
    expect(harness.session.activeRun).toBe(runId);
    harness.settleStart({ status: "approval_required", run_id: String(runId), calls: [], expires_at: "" });
    await flush();
    expect(harness.session.activeRun).toBe(runId);
  });

  it("cancels a first-turn run before answer_start responds", async () => {
    const harness = makeHarness();
    harness.session.submit("오래 걸리는 질문");
    await flush();
    const runId = String(harness.starts[0]?.run_id);
    await harness.session.cancelActive();
    expect(harness.cancels).toEqual([runId]);
    expect(harness.session.activeRun).toBeNull();
    // The late response of the cancelled generation is discarded.
    harness.settleStart(complete("늦은 답변"));
    await flush();
    const last = harness.states.at(-1);
    expect(last?.kind).not.toBe("answer");
  });
});
