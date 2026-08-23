import { randomUUID } from "crypto";

import { BackendCallError } from "./backend-manager";
import type {
  AnswerResult,
  AnswerState,
  AnswerStartResponse,
  PendingToolCall,
  ToolDecision,
} from "./types";

export type AnswerConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface AnswerDecision {
  call_id: string;
  decision: ToolDecision;
}

/** Transport over the stateful backend protocol (plan §11). */
export interface AnswerTransport {
  start(params: {
    query: string;
    conversation: AnswerConversationMessage[];
    max_context_chars?: number;
    session_allowed_tools?: string[];
    /** Client-generated run id (additive): lets cancel reach a first-turn
     *  run before answer_start has responded. */
    run_id?: string;
  }): Promise<AnswerStartResponse>;
  continue(
    runId: string,
    decisions: AnswerDecision[],
  ): Promise<AnswerStartResponse>;
  cancel(runId: string): Promise<unknown>;
}

export class AnswerSession {
  private generation = 0;
  private disposed = false;
  private history: AnswerConversationMessage[] = [];
  /** Live structured run awaiting completion or approval, if any. */
  private activeRunId: string | null = null;
  private pendingCalls: PendingToolCall[] = [];
  /** Tool aliases approved for THIS conversation only ("이 대화에서 허용").
   *  Never restored from history and cleared with the conversation. */
  private sessionAllowed = new Set<string>();
  private lastQuery = "";

  constructor(
    private readonly transport: AnswerTransport,
    private readonly stateChanged: (state: AnswerState) => void,
  ) {}

  get conversation(): AnswerConversationMessage[] {
    return this.history.map((message) => ({ ...message }));
  }

  get pendingApprovalCalls(): PendingToolCall[] {
    return this.pendingCalls.map((call) => ({ ...call }));
  }

  get activeRun(): string | null {
    return this.activeRunId;
  }

  /** Replace the conversation with a previously saved transcript (loaded
   *  from history). Follow-up questions keep this as their context.
   *  Invalidates any in-flight answer AND drops session approvals: a
   *  restored conversation never inherits tool grants. */
  restore(messages: AnswerConversationMessage[]): void {
    void this.cancelActive();
    this.generation++;
    this.history = messages.map((message) => ({ ...message }));
    this.sessionAllowed.clear();
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  submit(value: string): void {
    const query = value.trim();
    if (query.length < 2 || this.disposed) {
      if (!this.disposed) this.stateChanged({ kind: "idle" });
      return;
    }
    // A previous run may still be waiting on approval or execution — cancel
    // it so its side effects cannot land after the user moved on.
    void this.cancelActive();
    const generation = ++this.generation;
    this.lastQuery = query;
    // Only the recent window goes to the backend; the full transcript is kept
    // in memory so history saving never truncates a conversation.
    const conversation = this.history.slice(-8).map((m) => ({ ...m }));
    this.stateChanged({ kind: "retrieving" });
    void this.resolveStart(generation, query, conversation);
  }

  /** Apply user decisions for the pending approval batch. */
  decide(decisions: AnswerDecision[]): void {
    if (this.disposed || !this.activeRunId || this.pendingCalls.length === 0)
      return;
    const runId = this.activeRunId;
    const generation = this.generation;
    for (const decision of decisions) {
      if (decision.decision !== "allow_session") continue;
      const call = this.pendingCalls.find((c) => c.call_id === decision.call_id);
      if (call) this.sessionAllowed.add(call.tool_name);
    }
    this.stateChanged({
      kind: "tool-running",
      runId,
      calls: this.pendingApprovalCalls,
    });
    void (async () => {
      try {
        const response = await this.transport.continue(runId, decisions);
        if (
          this.disposed ||
          generation !== this.generation ||
          this.activeRunId !== runId
        ) {
          // Cancelled while the approved tools ran: discard the outcome.
          return;
        }
        await this.handleResponse(response, generation);
      } catch (error) {
        if (this.disposed || generation !== this.generation) return;
        this.activeRunId = null;
        this.pendingCalls = [];
        this.stateChanged(this.unavailableState(error));
      }
    })();
  }

  /** Cancel the active run (new question / clear / dispose / view close). */
  async cancelActive(): Promise<boolean> {
    const runId = this.activeRunId;
    this.activeRunId = null;
    this.pendingCalls = [];
    if (!runId) return false;
    try {
      await this.transport.cancel(runId);
    } catch {
      /* best effort: the run also expires via TTL */
    }
    return true;
  }

  clear(): void {
    void this.cancelActive();
    this.generation++;
    this.history = [];
    this.sessionAllowed.clear();
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  dispose(): void {
    void this.cancelActive();
    this.disposed = true;
    this.generation++;
  }

  private async resolveStart(
    generation: number,
    query: string,
    conversation: AnswerConversationMessage[],
  ): Promise<void> {
    // The run id is generated client-side (additive protocol, fix §3) and
    // tracked immediately so a cancel issued during the first turn — before
    // answer_start responds — reaches the right run.
    const runId = randomUUID();
    this.activeRunId = runId;
    try {
      const response = await this.transport.start({
        query,
        conversation,
        session_allowed_tools: [...this.sessionAllowed],
        run_id: runId,
      });
      if (
        this.disposed ||
        generation !== this.generation ||
        this.activeRunId !== runId
      ) {
        // Disposed, superseded by a newer question, or explicitly cancelled
        // while in flight: the late response must never surface.
        return;
      }
      await this.handleResponse(response, generation);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.activeRunId = null;
      this.stateChanged(this.unavailableState(error));
    }
  }

  private async handleResponse(
    response: AnswerStartResponse,
    generation: number,
  ): Promise<void> {
    if (response.status === "approval_required") {
      this.activeRunId = response.run_id;
      this.pendingCalls = response.calls;
      this.stateChanged({
        kind: "tool-approval",
        runId: response.run_id,
        calls: this.pendingApprovalCalls,
      });
      return;
    }
    this.activeRunId = null;
    this.pendingCalls = [];
    const result = response.result;
    this.history.push({ role: "user", content: this.lastQuery });
    this.history.push({ role: "assistant", content: result.answer });
    this.stateChanged({ kind: "answer", result });
  }

  private unavailableState(error: unknown): Extract<
    AnswerState,
    { kind: "unavailable" }
  > {
    const backendError = error instanceof BackendCallError ? error : undefined;
    const details = backendError?.details;
    const evidence =
      details &&
      typeof details === "object" &&
      "evidence" in details &&
      Array.isArray(details.evidence)
        ? (details.evidence as AnswerResult["evidence"])
        : undefined;
    return {
      kind: "unavailable",
      code: backendError?.code,
      message: error instanceof Error ? error.message : String(error),
      evidence,
    };
  }
}
