import { describe, expect, it } from "vitest";
import { AnswerSession } from "../../src/answer-session";
import type { AnswerTransport } from "../../src/answer-session";
import type { AnswerResult, AnswerStartResponse } from "../../src/types";
import { BackendCallError } from "../../src/backend-manager";

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
const completeFor = (runId: string, text: string): AnswerStartResponse => ({
  status: "complete",
  run_id: runId,
  result: answer(text),
});
const approvalFor = (runId: string): AnswerStartResponse => ({
  status: "approval_required",
  run_id: runId,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  calls: [
    {
      call_id: "c1",
      tool_name: "grep_vault",
      server_name: "srv",
      display_name: "grep_vault",
      arguments: {},
    },
  ],
});

type DeliveryState = {
  startDelivered: boolean;
  startDeliveredRunId: string | null;
};

/** Read the session's single bounded delivery state (private, for assertions). */
function delivery(session: AnswerSession): DeliveryState {
  const s = session as unknown as DeliveryState;
  return {
    startDelivered: s.startDelivered,
    startDeliveredRunId: s.startDeliveredRunId,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sessionWith(transport: AnswerTransport): AnswerSession {
  return new AnswerSession(transport, () => {});
}

describe("AnswerSession start-delivery marker bounding", () => {
  it("keeps zero delivery markers after repeated normal completes", async () => {
    const transport: AnswerTransport = {
      // The real backend echoes the client-supplied run_id, which is what the
      // session relies on for marker ownership.
      start: async ({ run_id }) => completeFor(run_id as string, "ok"),
      continue: async () => completeFor("x", "ok"),
      cancel: async () => ({}),
      status: async () => completeFor("x", "ok") as unknown as never,
    };
    const session = sessionWith(transport);
    for (let i = 0; i < 5; i++) {
      session.submit(`question ${i}`);
      await wait(50);
    }
    // After every terminal transition the single delivery slot is cleared —
    // no marker accumulates across repeated completes.
    const state = delivery(session);
    expect(state.startDelivered).toBe(false);
    expect(state.startDeliveredRunId).toBeNull();
    session.dispose();
    // dispose also clears.
    expect(delivery(session).startDelivered).toBe(false);
  });

  it("keeps the delivery marker while approval_required is active", async () => {
    let startCalls = 0;
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async ({ run_id }) => {
        startCalls++;
        capturedRunId = run_id as string;
        return approvalFor(capturedRunId);
      },
      continue: async () => completeFor("x", "ok"),
      cancel: async () => ({}),
      status: async () => ({ status: "running", run_id: "x" }),
    };
    const session = sessionWith(transport);
    session.submit("needs approval");
    await wait(60);
    expect(startCalls).toBe(1);
    const state = delivery(session);
    // During approval the start-delivery fact is retained (needed by continue).
    expect(state.startDelivered).toBe(true);
    expect(state.startDeliveredRunId).toBe(capturedRunId);
    session.dispose();
  });

  it("clears the marker after failed / cancelled / RUN_EXPIRED / recovery-lost statuses", async () => {
    const scenarios: Array<{
      name: string;
      status: (runId: string) => Promise<unknown>;
    }> = [
      {
        name: "failed",
        status: async () => ({
          status: "failed",
          run_id: "run-x",
          code: "LLM_TIMEOUT",
          message: "timeout",
        }),
      },
      {
        name: "cancelled",
        status: async () => ({
          status: "cancelled",
          run_id: "run-x",
        }),
      },
      {
        name: "expired",
        status: async () => {
          throw new BackendCallError("RUN_EXPIRED", "expired");
        },
      },
      {
        name: "recovery-lost",
        status: async () => {
          throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "restart", {
            pidChanged: true,
          } as unknown as Record<string, unknown>);
        },
      },
    ];
    for (const scenario of scenarios) {
      const transport: AnswerTransport = {
        // Return running first (marks delivery), then the terminal status.
        start: async ({ run_id }) => ({
          status: "running",
          run_id: run_id as string,
        }),
        continue: async () => completeFor("x", "ok"),
        cancel: async () => ({}),
        status: scenario.status as AnswerTransport["status"],
      };
      const session = sessionWith(transport);
      session.submit("recover me");
      await wait(200);
      const state = delivery(session);
      // After a terminal/unavailable status the delivery marker must be gone.
      expect(state.startDelivered, scenario.name).toBe(false);
      expect(state.startDeliveredRunId, scenario.name).toBeNull();
      session.dispose();
    }
  });

  it("clears the marker when start itself returns RUN_EXPIRED", async () => {
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        if (startCalls === 1)
          throw new BackendCallError("RUN_EXPIRED", "expired");
        return completeFor("x", "ok");
      },
      continue: async () => completeFor("x", "ok"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError("RUN_NOT_FOUND", "gone");
      },
    };
    const session = sessionWith(transport);
    session.submit("expired immediately");
    await wait(80);
    expect(startCalls).toBe(1);
    expect(delivery(session).startDelivered).toBe(false);
    session.dispose();
  });

  it("a stale run's late start resolution never erases the new run marker", async () => {
    let resolveFirst: ((value: AnswerStartResponse) => void) | null = null;
    let startCalls = 0;
    let secondRunId = "";
    const transport: AnswerTransport = {
      start: async ({ run_id }) => {
        startCalls++;
        if (startCalls === 1) {
          return await new Promise<AnswerStartResponse>((resolve) => {
            resolveFirst = resolve;
          });
        }
        secondRunId = run_id as string;
        return approvalFor(secondRunId);
      },
      continue: async () => completeFor("x", "ok"),
      cancel: async () => ({}),
      status: async () => ({ status: "running", run_id: "x" }),
    };
    const session = sessionWith(transport);
    session.submit("first question");
    await wait(30);
    // A new submit supersedes the first run (its start is still in flight).
    session.submit("second question");
    await wait(60);
    // The new run's start resolved → its delivery marker is set.
    expect(delivery(session).startDelivered).toBe(true);
    expect(delivery(session).startDeliveredRunId).toBe(secondRunId);
    // Now the STALE first start resolves late. Its cleanup must not clear the
    // new run's marker (generation/runId ownership check).
    resolveFirst?.(approvalFor("stale-first-run"));
    await wait(60);
    expect(delivery(session).startDelivered).toBe(true);
    expect(delivery(session).startDeliveredRunId).toBe(secondRunId);
    session.dispose();
  });

  it("at most one delivery slot exists while tests accumulate runs", async () => {
    const transport: AnswerTransport = {
      start: async ({ run_id }) => completeFor(run_id as string, "ok"),
      continue: async () => completeFor("x", "ok"),
      cancel: async () => ({}),
      status: async () => completeFor("x", "ok") as unknown as never,
    };
    const session = sessionWith(transport);
    session.submit("q1");
    await wait(40);
    session.submit("q2");
    await wait(40);
    session.submit("q3");
    await wait(40);
    // The design replaced the unbounded Set with a single boolean + one run id:
    // there is never more than one marker, and after terminal transitions the
    // slot is empty.
    expect(delivery(session).startDeliveredRunId).toBeNull();
    session.dispose();
  });
});
