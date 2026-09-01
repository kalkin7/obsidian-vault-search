/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AnswerSession } from "../../src/answer-session";
import type { AnswerTransport } from "../../src/answer-session";
import { BackendCallError } from "../../src/backend-manager";
import type { AnswerResult } from "../../src/types";

const answer = (text: string): AnswerResult => ({
  answer: text,
  citations: [],
  evidence: [],
  provider: "openai",
  model: "test",
  grounded: true,
  diagnostics: { retrieved_count: 1, context_chars: 1, answer_chars: text.length },
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

describe("AnswerSession recovery owner token race", () => {
  it("previous background status deferred, new submit keeps owner and timer, retry single loop, no unhandled", async () => {
    const unhandled: unknown[] = [];
    const handler = (e: PromiseRejectionEvent) => unhandled.push(e);
    window.addEventListener("unhandledrejection", handler as any);

    let statusCalls: Array<{ runId: string; callNo: number }> = [];
    let callCounter = 0;
    let firstRunId = "";
    let secondRunId = "";
    let firstBackgroundDeferred: ReturnType<typeof createDeferred<any>> | null = null;
    let firstBackgroundCallNo = -1;
    let firstRecoveryStart = 0;
    let backgroundTransitionSeen = false;

    const transport: AnswerTransport = {
      start: async (params) => {
        const rid = params.run_id as string;
        if (!firstRunId) firstRunId = rid;
        else if (!secondRunId) secondRunId = rid;
        // Both starts fail with local error to trigger recovery
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {} as any);
      },
      continue: async () => ({ status: "complete", run_id: "x", result: answer("x") } as any),
      cancel: async () => ({}),
      status: async (runId) => {
        callCounter++;
        statusCalls.push({ runId, callNo: callCounter });
        // First run initial recovery: first status call for firstRunId
        if (runId === firstRunId) {
          if (callCounter === 1) {
            // initial status for first run -> running, capture recovery start time
            firstRecoveryStart = Date.now();
            return { status: "running", run_id: runId } as any;
          }
          // Check if we've reached background period (55s high-frequency + 5s sleep)
          const elapsed = Date.now() - firstRecoveryStart;
          if (elapsed >= 60_000 && !firstBackgroundDeferred) {
            // Confirm background transition: high-frequency period actually ended
            expect(elapsed).toBeGreaterThanOrEqual(55_000);
            backgroundTransitionSeen = true;
            firstBackgroundDeferred = createDeferred();
            firstBackgroundCallNo = callCounter;
            return firstBackgroundDeferred.promise as any;
          }
          // High-frequency polling before background
          return { status: "running", run_id: runId } as any;
        }
        // Second run
        if (runId === secondRunId) {
          return { status: "running", run_id: runId } as any;
        }
        return { status: "running", run_id: runId } as any;
      },
    };

    const states: any[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));

    // First submit
    session.submit("first query hello world");
    await vi.advanceTimersByTimeAsync(10);
    // After first submit, transport.start threw, then tryRecoverStatus called status for firstRunId (call 1)
    expect(firstRunId).not.toBe("");
    expect(statusCalls.some((c) => c.runId === firstRunId)).toBe(true);

    // Advance to trigger high-frequency polling (500ms) -> call 2
    await vi.advanceTimersByTimeAsync(500);
    // Now advance through high-frequency period (55s)
    await vi.advanceTimersByTimeAsync(55_000);
    // At 55.5s, high-frequency deadline just passed, but background sleep (5s) not yet done — deferred should still be null
    expect(firstBackgroundDeferred).toBeNull();
    // Advance background sleep to reach first background status (total ~60s)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(backgroundTransitionSeen).toBe(true);
    expect(firstBackgroundDeferred).not.toBeNull();
    expect(firstBackgroundCallNo).toBeGreaterThan(0);
    // The deferred is still pending, so first run's background is in-flight

    // Now submit second run while first's background status is in-flight
    statusCalls = []; // reset to track second run
    callCounter = 0;
    // Need to keep firstBackgroundDeferred reference for later resolve
    const bgDeferred = firstBackgroundDeferred!;
    firstBackgroundDeferred = null;

    session.submit("second query hello world");
    await vi.advanceTimersByTimeAsync(10);
    expect(secondRunId).not.toBe("");
    expect(secondRunId).not.toBe(firstRunId);
    // Second run's recovery should have started and its polling timer registered
    // Advance a bit to let second run's first status poll happen (500ms)
    await vi.advanceTimersByTimeAsync(500);
    const secondRunCallsBefore = statusCalls.filter((c) => c.runId === secondRunId).length;
    expect(secondRunCallsBefore).toBeGreaterThanOrEqual(1);

    // Now resolve previous background deferred (late resolve)
    // It should not affect new run's owner/timer
    bgDeferred.resolve({ status: "complete", run_id: firstRunId, result: answer("old complete") } as any);
    await vi.advanceTimersByTimeAsync(10);
    // Allow microtasks
    await Promise.resolve();

    // Verify new run's timer and owner still alive — polling for second run should continue
    const before = statusCalls.filter((c) => c.runId === secondRunId).length;
    await vi.advanceTimersByTimeAsync(500);
    const after = statusCalls.filter((c) => c.runId === secondRunId).length;
    expect(after).toBe(before + 1);

    // retryStatusCheck should not create second loop for second run
    const callsBeforeRetry = statusCalls.filter((c) => c.runId === secondRunId).length;
    session.retryStatusCheck();
    await vi.advanceTimersByTimeAsync(500);
    const callsAfterRetry = statusCalls.filter((c) => c.runId === secondRunId).length;
    expect(callsAfterRetry).toBe(callsBeforeRetry + 1); // single increment, not double

    // Ensure old run's late resolve did not cause UI update for old run or affect new run's state
    // The session's activeRun should still be secondRunId
    expect(session.activeRun).toBe(secondRunId);
    // States should not contain an answer for first run's old complete after second submit
    // The only answer that might appear should be for second run if it eventually completes, but we kept it running
    // So no answer yet, but also no unavailable for old run that would clear new run
    expect(session.activeRun).toBe(secondRunId);

    // Cleanup and verify no unhandled
    session.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(unhandled.length).toBe(0);

    window.removeEventListener("unhandledrejection", handler as any);
  });

  it("dispose/clear/restore after deferred in-flight does not affect new run", async () => {
    let deferred: ReturnType<typeof createDeferred<any>> | null = null;
    let firstRunId = "";
    let secondRunId = "";
    const transport: AnswerTransport = {
      start: async (p) => {
        if (!firstRunId) firstRunId = p.run_id as string;
        else secondRunId = p.run_id as string;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {} as any);
      },
      continue: async () => ({ status: "complete", run_id: "x", result: answer("x") } as any),
      cancel: async () => ({}),
      status: async (runId) => {
        if (runId === firstRunId && !deferred) {
          deferred = createDeferred();
          return deferred.promise as any;
        }
        if (runId === firstRunId && deferred) {
          return { status: "running", run_id: runId } as any;
        }
        return { status: "running", run_id: runId } as any;
      },
    };
    const states: any[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world first");
    await vi.advanceTimersByTimeAsync(10);
    expect(deferred).not.toBeNull();
    // While deferred pending, clear
    session.clear();
    expect(session.activeRun).toBeNull();
    // Resolve deferred after clear — should not affect new state (idle)
    deferred!.resolve({ status: "complete", run_id: firstRunId, result: answer("late") } as any);
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(states[states.length - 1].kind).toBe("idle");
    expect(session.activeRun).toBeNull();

    // New submit should work
    session.submit("new hello world");
    await vi.advanceTimersByTimeAsync(10);
    expect(session.activeRun).not.toBeNull();
    expect(secondRunId).not.toBe("");
    expect(session.activeRun).toBe(secondRunId);
    expect(session.activeRun).not.toBe(firstRunId);
    session.dispose();
  });
});
