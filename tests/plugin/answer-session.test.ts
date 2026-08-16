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
  diagnostics: {
    retrieved_count: 1,
    context_chars: 1,
    answer_chars: text.length,
  },
});

describe("AnswerSession", () => {
  it("keeps the full transcript and sends only the recent window", async () => {
    const requests: Array<{ query: string; conversation: unknown[] }> = [];
    const states: AnswerState[] = [];
    const session = new AnswerSession(
      async (query, conversation) => {
        requests.push({ query, conversation });
        return answer(`answer ${query}`);
      },
      (state) => states.push(state),
    );
    for (const query of ["one", "two", "three", "four", "five"]) {
      session.submit(query);
      await Promise.resolve();
      await Promise.resolve();
    }
    // The backend gets the recent window (last 8 messages).
    expect(requests.at(-1)?.conversation).toHaveLength(8);
    // The stored transcript is kept in full so history saving never truncates.
    expect(session.conversation).toHaveLength(10);
    expect(session.conversation.at(0)).toEqual({
      role: "user",
      content: "one",
    });
    expect(states.at(-1)?.kind).toBe("answer");
  });

  it("does not render a stale response after clear", async () => {
    let resolve!: (value: AnswerResult) => void;
    const states: AnswerState[] = [];
    const session = new AnswerSession(
      () =>
        new Promise<AnswerResult>((r) => {
          resolve = r;
        }),
      (state) => states.push(state),
    );
    session.submit("old");
    session.clear();
    resolve(answer("old answer"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ kind: "idle" });
  });

  it("restore invalidates an in-flight answer", async () => {
    let resolve!: (value: AnswerResult) => void;
    const states: AnswerState[] = [];
    const session = new AnswerSession(
      () =>
        new Promise<AnswerResult>((r) => {
          resolve = r;
        }),
      (state) => states.push(state),
    );
    session.submit("old");
    session.restore([{ role: "user", content: "loaded" }]);
    resolve(answer("stale"));
    await Promise.resolve();
    await Promise.resolve();
    // The stale answer must not append into the restored conversation.
    expect(session.conversation).toEqual([
      { role: "user", content: "loaded" },
    ]);
    expect(states.at(-1)).toEqual({ kind: "idle" });
  });
});
