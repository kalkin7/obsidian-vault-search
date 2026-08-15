import { describe, expect, it } from "vitest";
import { AnswerSession } from "../../src/answer-session";
import type { AnswerResult, AnswerState } from "../../src/types";

const answer = (text: string): AnswerResult => ({
  answer: text,
  citations: [],
  evidence: [],
  provider: "openai",
  model: "test",
  grounded: true,
  diagnostics: { retrieved_count: 1, context_chars: 1, answer_chars: text.length },
});

describe("AnswerSession", () => {
  it("keeps at most four turns and sends prior conversation", async () => {
    const requests: Array<{ query: string; conversation: unknown[] }> = [];
    const states: AnswerState[] = [];
    const session = new AnswerSession(async (query, conversation) => {
      requests.push({ query, conversation });
      return answer(`answer ${query}`);
    }, (state) => states.push(state));
    for (const query of ["one", "two", "three", "four", "five"]) {
      session.submit(query);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(requests.at(-1)?.conversation).toHaveLength(8);
    expect(session.conversation.at(0)).toEqual({ role: "user", content: "two" });
    expect(states.at(-1)?.kind).toBe("answer");
  });

  it("does not render a stale response after clear", async () => {
    let resolve!: (value: AnswerResult) => void;
    const states: AnswerState[] = [];
    const session = new AnswerSession(() => new Promise<AnswerResult>((r) => { resolve = r; }), (state) => states.push(state));
    session.submit("old");
    session.clear();
    resolve(answer("old answer"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ kind: "idle" });
  });
});
