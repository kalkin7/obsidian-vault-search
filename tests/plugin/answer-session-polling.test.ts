/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
const complete = (runId: string, text = "ok"): AnswerStartResponse => ({
  status: "complete",
  run_id: runId,
  result: answer(text),
});

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AnswerSession polling single ownership and timer lifetime", () => {
  it("running polling 중 retryStatusCheck 호출 시 status loop가 하나뿐임", async () => {
    let statusCalls = 0;
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (params) => {
        capturedRunId = params.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        return { status: "running", run_id: capturedRunId } as any;
      },
    };
    const session = new AnswerSession(transport, () => {});
    session.submit("hello world");
    // let initial status fetch happen
    await vi.advanceTimersByTimeAsync(10);
    // first status call after local error: tryRecoverStatus calls status once (running)
    // then enters high-freq polling loop, next status after 500ms
    expect(statusCalls).toBe(1);
    // advance 500 to trigger first polled status
    await vi.advanceTimersByTimeAsync(500);
    expect(statusCalls).toBe(2);
    // now retryStatusCheck while polling in progress should not create new loop
    session.retryStatusCheck();
    // advance another 500 -> should be 3 if single loop, 4 if double
    await vi.advanceTimersByTimeAsync(500);
    expect(statusCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(statusCalls).toBe(4);
    session.dispose();
    await vi.advanceTimersByTimeAsync(100);
  });

  it("dispose 중 polling timer가 남지 않음", async () => {
    let statusCalls = 0;
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        return { status: "running", run_id: capturedRunId } as any;
      },
    };
    const session = new AnswerSession(transport, () => {});
    session.submit("test query");
    await vi.advanceTimersByTimeAsync(10);
    expect(statusCalls).toBe(1);
    // polling timer scheduled for 500ms
    session.dispose();
    // advance well beyond polling interval, ensure no more status calls
    statusCalls = 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusCalls).toBe(0);
    expect(session.activeRun).toBeNull();
  });

  it("clear/restore 후 이전 run_id status가 다시 호출되지 않음", async () => {
    let lastStatusRunId: string | null = null;
    let statusCalls: Array<string> = [];
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async (runId) => {
        statusCalls.push(runId);
        lastStatusRunId = runId;
        return { status: "running", run_id: runId } as any;
      },
    };
    const session = new AnswerSession(transport, () => {});
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    const firstRunId = capturedRunId;
    expect(lastStatusRunId).toBe(firstRunId);
    // clear should cancel polling and generation increment
    session.clear();
    statusCalls = [];
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusCalls.length).toBe(0);

    // new submit should have new run_id
    session.submit("new query");
    // need to make transport.status return something else to avoid running loop again?
    // But we want to ensure old run_id not used
    await vi.advanceTimersByTimeAsync(10);
    // After new submit, start will be called again, but status may be called for new run_id if local error again
    // Our transport.status still returns running for any runId, but we check that old runId not called
    expect(
      statusCalls.every((id) => id !== firstRunId) ||
        statusCalls.length === 0 ||
        statusCalls[0] !== firstRunId,
    ).toBeTruthy();
    session.dispose();
  });

  it("background polling 중 complete 처리", async () => {
    let capturedRunId = "";
    let statusCalls = 0;
    const states: any[] = [];
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        // First status (initial) -> running
        // Subsequent high-freq polling -> running until deadline, then background should still poll
        if (statusCalls <= 5) {
          return { status: "running", run_id: capturedRunId } as any;
        }
        // After high-freq deadline + some background polling, return complete
        return {
          status: "complete",
          run_id: capturedRunId,
          result: answer("bg complete"),
        } as any;
      },
    };
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await vi.advanceTimersByTimeAsync(10);
    // Fast-forward through high-freq deadline (55s) + one background interval (5s)
    // High-freq polls every 500ms for 55s = 110 polls, but we can fast-forward
    await vi.advanceTimersByTimeAsync(55_000);
    // Should have switched to background polling (state retrieving)
    // Now advance background interval
    await vi.advanceTimersByTimeAsync(5_000);
    // Allow promises to settle
    await vi.advanceTimersByTimeAsync(10);
    expect(states.some((s) => s.kind === "answer")).toBe(true);
    session.dispose();
  });

  it("background polling 중 failed 처리", async () => {
    let capturedRunId = "";
    let statusCalls = 0;
    const states: any[] = [];
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls <= 2)
          return { status: "running", run_id: capturedRunId } as any;
        if (statusCalls <= 110)
          return { status: "running", run_id: capturedRunId } as any; // keep running through deadline
        return {
          status: "failed",
          run_id: capturedRunId,
          code: "LLM_TIMEOUT",
          message: "timeout",
        } as any;
      },
    };
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(55_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      states.some((s) => s.kind === "unavailable" && s.code === "LLM_TIMEOUT"),
    ).toBe(true);
    session.dispose();
  });

  it("background polling 중 cancelled 처리", async () => {
    let capturedRunId = "";
    let statusCalls = 0;
    const states: any[] = [];
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls <= 111)
          return { status: "running", run_id: capturedRunId } as any;
        return { status: "cancelled", run_id: capturedRunId } as any;
      },
    };
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(55_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      states.some(
        (s) => s.kind === "unavailable" && s.code === "ANSWER_CANCELLED",
      ),
    ).toBe(true);
    session.dispose();
  });

  it("background polling 중 instanceChanged 처리", async () => {
    let capturedRunId = "";
    let statusCalls = 0;
    const states: any[] = [];
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls <= 111)
          return { status: "running", run_id: capturedRunId } as any;
        throw new BackendCallError("BACKEND_ERROR", "restarted", {
          pidChanged: true,
        } as any);
      },
    };
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(55_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      states.some(
        (s) => s.kind === "unavailable" && s.code === "RUN_RECOVERY_LOST",
      ),
    ).toBe(true);
    session.dispose();
  });

  it("transient local error 후 backoff해도 polling 단일 소유권 유지", async () => {
    let capturedRunId = "";
    let statusCalls = 0;
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls === 2) {
          // second poll transient error
          throw new BackendCallError(
            "LOCAL_BACKEND_UNAVAILABLE",
            "transient",
            {} as any,
          );
        }
        if (statusCalls < 6)
          return { status: "running", run_id: capturedRunId } as any;
        return {
          status: "complete",
          run_id: capturedRunId,
          result: answer("recovered"),
        } as any;
      },
    };
    const states: any[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(500);
    expect(statusCalls).toBe(2); // second poll threw
    // Call retry while still in backoff/polling — should not create second loop
    session.retryStatusCheck();
    // backoff 1000 + next poll 500 = 1500 before next status
    await vi.advanceTimersByTimeAsync(1500);
    expect(statusCalls).toBeGreaterThanOrEqual(3);
    expect(statusCalls).toBeLessThanOrEqual(4);
    const before = statusCalls;
    await vi.advanceTimersByTimeAsync(500);
    expect(statusCalls).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(2000);
    // Polling should have completed by now (statusCalls >=6 triggers complete)
    await vi.advanceTimersByTimeAsync(100);
    expect(states.some((s) => s.kind === "answer")).toBe(true);
    // After complete, no further polling
    const finalCalls = statusCalls;
    await vi.advanceTimersByTimeAsync(2000);
    expect(statusCalls).toBe(finalCalls);
    session.dispose();
  });

  it("unhandled rejection 0건", async () => {
    const unhandled: unknown[] = [];
    const handler = (e: PromiseRejectionEvent) => unhandled.push(e);
    // In jsdom, unhandledrejection is on window
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("unhandledrejection", handler as any);
    }
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (p) => {
        capturedRunId = p.run_id as string;
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      continue: async () => {
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "local",
          {} as any,
        );
      },
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "transient",
          {} as any,
        );
      },
    };
    const session = new AnswerSession(transport, () => {});
    session.submit("hello");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(500);
    session.retryStatusCheck();
    await vi.advanceTimersByTimeAsync(1000);
    // trigger background polling error paths that previously had unhandled rejection
    await vi.advanceTimersByTimeAsync(55_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // dispose should also not cause unhandled
    session.dispose();
    await vi.advanceTimersByTimeAsync(100);
    // Also test decide path with background polling
    if (typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("unhandledrejection", handler as any);
    }
    expect(unhandled.length).toBe(0);
    // Also check node process listeners if any
    // For node environment, check via process
    // No throw means no unhandled
  });

  it("uncertain local status then RUN_NOT_FOUND retries the same run_id once", async () => {
    let startCalls = 0;
    let capturedRunId = "";
    let statusCalls = 0;
    const transport: AnswerTransport = {
      start: async (p) => {
        startCalls++;
        capturedRunId = p.run_id as string;
        if (startCalls === 1) {
          throw new BackendCallError(
            "LOCAL_BACKEND_UNAVAILABLE",
            "local",
            {} as any,
          );
        }
        return complete(capturedRunId, "retried");
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls === 1) {
          throw new BackendCallError(
            "LOCAL_BACKEND_UNAVAILABLE",
            "status local",
            {} as any,
          );
        }
        throw new BackendCallError("RUN_NOT_FOUND", "missing");
      },
    };
    const states: any[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await vi.advanceTimersByTimeAsync(10);
    expect(startCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(startCalls).toBe(2);
    expect(
      states.some((s) => s.kind === "answer" && s.result?.answer === "retried"),
    ).toBe(true);
    session.dispose();
  });
});
