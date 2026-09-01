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
const complete = (text: string): AnswerStartResponse => ({
  status: "complete",
  result: answer(text),
});

describe("AnswerSession RPC recovery", () => {
  it("recovers complete via status after local ECONNRESET on same PID", async () => {
    let capturedRunId = "";
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async (params) => {
        capturedRunId = params.run_id as string;
        startCalls++;
        if (startCalls === 1)
          throw new BackendCallError(
            "LOCAL_BACKEND_UNAVAILABLE",
            "local fail",
            { pidChanged: false } as unknown as Record<string, unknown>,
          );
        return complete("retry");
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async (runId) => {
        expect(runId).toBe(capturedRunId);
        return {
          status: "complete",
          run_id: runId,
          result: answer("recovered"),
        } as unknown as AnswerStartResponse;
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(startCalls).toBe(1);
    expect(
      states.some((s: unknown) => (s as { kind: string }).kind === "answer"),
    ).toBe(true);
  });

  it("does not auto-retry when PID changed", async () => {
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
          pidChanged: true,
          oldPid: 1,
          newPid: 2,
        } as unknown as Record<string, unknown>);
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError("RUN_NOT_FOUND", "not found");
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(startCalls).toBe(1);
    expect(
      states.some(
        (s: unknown) =>
          (s as { kind: string }).kind === "unavailable" &&
          (s as { code?: string }).code === "RUN_RECOVERY_LOST",
      ),
    ).toBe(true);
  });

  it("polls running status and recovers complete", async () => {
    let statusCalls = 0;
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (params) => {
        capturedRunId = params.run_id as string;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
          pidChanged: false,
        } as unknown as Record<string, unknown>);
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        statusCalls++;
        if (statusCalls <= 2)
          return {
            status: "running",
            run_id: capturedRunId,
          } as unknown as AnswerStartResponse;
        return {
          status: "complete",
          run_id: capturedRunId,
          result: answer("polled"),
        } as unknown as AnswerStartResponse;
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 1800));
    expect(statusCalls).toBeGreaterThanOrEqual(3);
    expect(
      states.some((s: unknown) => (s as { kind: string }).kind === "answer"),
    ).toBe(true);
  });

  it("recovers failed without retry", async () => {
    let capturedRunId = "";
    const transport: AnswerTransport = {
      start: async (params) => {
        capturedRunId = params.run_id as string;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
          pidChanged: false,
        } as unknown as Record<string, unknown>);
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () =>
        ({
          status: "failed",
          run_id: capturedRunId,
          code: "LLM_TIMEOUT",
          message: "timeout",
        }) as unknown as AnswerStartResponse,
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(
      states.some(
        (s: unknown) =>
          (s as { kind: string }).kind === "unavailable" &&
          (s as { code?: string }).code === "LLM_TIMEOUT",
      ),
    ).toBe(true);
  });

  it("does not expose raw ECONNRESET", async () => {
    const transport: AnswerTransport = {
      start: async () => {
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "read ECONNRESET",
          {},
        );
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "read ECONNRESET",
          {},
        );
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    for (const state of states) {
      const msg = (state as { message?: string }).message || "";
      expect(msg).not.toMatch(/ECONNRESET/i);
      expect(msg).not.toMatch(/WinError/i);
    }
  });

  it("status local error does not trigger blind start retry", async () => {
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        if (startCalls === 1)
          throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
            pidChanged: false,
          } as unknown as Record<string, unknown>);
        return complete("should not be called yet");
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError(
          "LOCAL_BACKEND_UNAVAILABLE",
          "status local fail",
          {},
        );
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(startCalls).toBe(1);
    expect(
      states.some((s: unknown) => (s as { kind: string }).kind === "answer"),
    ).toBe(false);
    session.dispose();
  });

  it("late complete after a new submit does not overwrite the new run", async () => {
    let firstResolve: ((value: AnswerStartResponse) => void) | null = null;
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        if (startCalls === 1) {
          return await new Promise<AnswerStartResponse>((resolve) => {
            firstResolve = resolve;
          });
        }
        return complete("second-answer");
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () =>
        ({ status: "running", run_id: "x" }) as unknown as AnswerStartResponse,
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("first query hello");
    await new Promise((r) => setTimeout(r, 30));
    session.submit("second query hello");
    await new Promise((r) => setTimeout(r, 30));
    firstResolve?.(complete("stale-first"));
    await new Promise((r) => setTimeout(r, 50));
    const answers = states.filter(
      (s: unknown) => (s as { kind: string }).kind === "answer",
    ) as Array<{ result: { answer: string } }>;
    expect(answers.some((s) => s.result.answer === "stale-first")).toBe(false);
    expect(answers.some((s) => s.result.answer === "second-answer")).toBe(true);
    session.dispose();
  });

  it("does not retry start when status is RUN_EXPIRED", async () => {
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
          pidChanged: false,
        } as unknown as Record<string, unknown>);
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError("RUN_EXPIRED", "expired");
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(startCalls).toBe(1);
    expect(
      states.some(
        (s: unknown) =>
          (s as { kind: string; code?: string }).kind === "unavailable" &&
          (s as { code?: string }).code === "RUN_EXPIRED",
      ),
    ).toBe(true);
    session.dispose();
  });

  it("does not retry start when the original request likely reached the server", async () => {
    let startCalls = 0;
    const transport: AnswerTransport = {
      start: async () => {
        startCalls++;
        throw new BackendCallError("LOCAL_BACKEND_UNAVAILABLE", "local", {
          pidChanged: false,
          stage: "read",
        } as unknown as Record<string, unknown>);
      },
      continue: async () => complete("x"),
      cancel: async () => ({}),
      status: async () => {
        throw new BackendCallError("RUN_NOT_FOUND", "missing");
      },
    };
    const states: unknown[] = [];
    const session = new AnswerSession(transport, (s) => states.push(s));
    session.submit("hello world");
    await new Promise((r) => setTimeout(r, 200));
    expect(startCalls).toBe(1);
    expect(
      states.some((s: unknown) => (s as { kind: string }).kind === "answer"),
    ).toBe(false);
    session.dispose();
  });
});
