import { BackendCallError } from "./backend-manager";
import type { AnswerResult, AnswerState } from "./types";

export type AnswerConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export class AnswerSession {
  private generation = 0;
  private disposed = false;
  private history: AnswerConversationMessage[] = [];

  constructor(
    private readonly answer: (
      query: string,
      conversation: AnswerConversationMessage[],
    ) => Promise<AnswerResult>,
    private readonly stateChanged: (state: AnswerState) => void,
  ) {}

  get conversation(): AnswerConversationMessage[] {
    return this.history.map((message) => ({ ...message }));
  }

  /** Replace the conversation with a previously saved transcript (loaded from
   *  history). Follow-up questions keep this as their context. */
  restore(messages: AnswerConversationMessage[]): void {
    this.history = messages.map((message) => ({ ...message }));
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  submit(value: string): void {
    const query = value.trim();
    if (query.length < 2 || this.disposed) {
      if (!this.disposed) this.stateChanged({ kind: "idle" });
      return;
    }
    const generation = ++this.generation;
    // Only the recent window goes to the backend; the full transcript is kept
    // in memory so history saving never truncates a conversation.
    const conversation = this.history
      .slice(-8)
      .map((message) => ({ ...message }));
    this.stateChanged({ kind: "retrieving" });
    const pending = this.answer(query, conversation);
    this.stateChanged({ kind: "answering" });
    void this.resolve(pending, query, generation);
  }

  clear(): void {
    this.generation++;
    this.history = [];
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  private async resolve(
    pending: Promise<AnswerResult>,
    query: string,
    generation: number,
  ): Promise<void> {
    try {
      const result = await pending;
      if (this.disposed || generation !== this.generation) return;
      this.history.push({ role: "user", content: query });
      this.history.push({ role: "assistant", content: result.answer });
      this.stateChanged({ kind: "answer", result });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const backendError =
        error instanceof BackendCallError ? error : undefined;
      const details = backendError?.details;
      const evidence =
        details &&
        typeof details === "object" &&
        "evidence" in details &&
        Array.isArray(details.evidence)
          ? (details.evidence as AnswerResult["evidence"])
          : undefined;
      this.stateChanged({
        kind: "unavailable",
        code: backendError?.code,
        message: error instanceof Error ? error.message : String(error),
        evidence,
      });
    }
  }
}
