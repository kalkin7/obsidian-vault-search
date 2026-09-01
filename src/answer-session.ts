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

export type AnswerStatusResponse =
  | { status: "complete"; run_id: string; result: AnswerResult }
  | {
      status: "approval_required";
      run_id: string;
      expires_at: string;
      calls: PendingToolCall[];
    }
  | { status: "running"; run_id: string }
  | { status: "failed"; run_id: string; code: string; message: string }
  | { status: "cancelled"; run_id: string };

/** Transport over the stateful backend protocol (plan §11). */
export interface AnswerTransport {
  start(params: {
    query: string;
    conversation: AnswerConversationMessage[];
    max_context_chars?: number;
    session_allowed_tools?: string[];
    run_id?: string;
  }): Promise<AnswerStartResponse>;
  continue(
    runId: string,
    decisions: AnswerDecision[],
  ): Promise<AnswerStartResponse>;
  cancel(runId: string): Promise<unknown>;
  status(runId: string): Promise<AnswerStatusResponse>;
}

type RecoveryOwner = {
  epoch: number;
  generation: number;
  runId: string;
};

export class AnswerSession {
  private generation = 0;
  private disposed = false;
  private history: AnswerConversationMessage[] = [];
  private activeRunId: string | null = null;
  private pendingCalls: PendingToolCall[] = [];
  private sessionAllowed = new Set<string>();
  private lastQuery = "";
  /** Delivery certainty for the start RPC of the CURRENT active run.
   *
   * A single boolean bound to the active run id (instead of a Set of run_ids):
   * only the current run's recovery needs this knowledge, and the run_id
   * ownership check guarantees a late cleanup of a previous run can never
   * erase the new run's state. Kept while a run is approval_required (its
   * continue may still need it) and cleared on every terminal or abandoned
   * transition (complete / failed / cancelled / RUN_EXPIRED /
   * RUN_RECOVERY_LOST / clear / restore / dispose).
   */
  private startDelivered = false;
  private startDeliveredRunId: string | null = null;
  // Owner-token based recovery — not a shared boolean
  private recoveryEpochCounter = 0;
  private recoveryOwner: RecoveryOwner | null = null;
  // Per-epoch timer/sleep state — previous owner's cleanup must not affect new owner's timer
  private sleepStates = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout> | null;
      resolve: (() => void) | null;
    }
  >();

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

  restore(messages: AnswerConversationMessage[]): void {
    void this.cancelActive();
    this.generation++;
    this.resetRecovery();
    this.history = messages.map((message) => ({ ...message }));
    this.sessionAllowed.clear();
    this.clearStartDelivered();
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  submit(value: string): void {
    const query = value.trim();
    if (query.length < 2 || this.disposed) {
      if (!this.disposed) this.stateChanged({ kind: "idle" });
      return;
    }
    void this.cancelActive();
    this.resetRecovery();
    const generation = ++this.generation;
    this.lastQuery = query;
    const conversation = this.history.slice(-8).map((m) => ({ ...m }));
    this.stateChanged({ kind: "retrieving" });
    void this.resolveStart(generation, query, conversation).catch(() => {
      // Prevent unhandled rejection from submit background task
    });
  }

  decide(decisions: AnswerDecision[]): void {
    if (this.disposed || !this.activeRunId || this.pendingCalls.length === 0)
      return;
    const runId = this.activeRunId;
    const generation = this.generation;
    for (const decision of decisions) {
      if (decision.decision !== "allow_session") continue;
      const call = this.pendingCalls.find(
        (c) => c.call_id === decision.call_id,
      );
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
          return;
        }
        await this.handleResponse(response, generation);
      } catch (error) {
        if (this.disposed || generation !== this.generation) return;
        if (this.isInstanceChanged(error)) {
          this.activeRunId = null;
          this.pendingCalls = [];
          this.clearStartDelivered(runId);
          this.stateChanged({
            kind: "unavailable",
            code: "RUN_RECOVERY_LOST",
            message:
              "백엔드가 재시작되어 이전 실행을 복구할 수 없습니다. 다시 시도해 주세요.",
          });
          return;
        }
        if (this.isLocalBackendError(error)) {
          const recovered = await this.tryRecoverStatus(runId, generation);
          if (recovered) return;
          if (recovered === null) {
            try {
              const retry = await this.transport.continue(runId, decisions);
              if (
                this.disposed ||
                generation !== this.generation ||
                this.activeRunId !== runId
              )
                return;
              await this.handleResponse(retry, generation);
              return;
            } catch (retryError) {
              if (this.disposed || generation !== this.generation) return;
              if (this.isInstanceChanged(retryError)) {
                this.activeRunId = null;
                this.pendingCalls = [];
                this.clearStartDelivered(runId);
                this.stateChanged({
                  kind: "unavailable",
                  code: "RUN_RECOVERY_LOST",
                  message:
                    "백엔드가 재시작되어 이전 실행을 복구할 수 없습니다. 다시 시도해 주세요.",
                });
                return;
              }
              this.activeRunId = null;
              this.pendingCalls = [];
              this.clearStartDelivered(runId);
              this.stateChanged(this.unavailableState(retryError));
              return;
            }
          }
          this.activeRunId = null;
          this.pendingCalls = [];
          this.clearStartDelivered(runId);
          this.stateChanged(this.unavailableState(error));
          return;
        }
        this.activeRunId = null;
        this.pendingCalls = [];
        this.clearStartDelivered(runId);
        this.stateChanged(this.unavailableState(error));
      }
    })().catch(() => {
      // Prevent unhandled rejection from decide background task
    });
  }

  async cancelActive(): Promise<boolean> {
    const runId = this.activeRunId;
    this.activeRunId = null;
    this.pendingCalls = [];
    this.resetRecovery();
    if (!runId) return false;
    this.clearStartDelivered(runId);
    try {
      await this.transport.cancel(runId);
    } catch {
      /* best effort */
    }
    return true;
  }

  clear(): void {
    void this.cancelActive();
    this.generation++;
    this.resetRecovery();
    this.history = [];
    this.sessionAllowed.clear();
    this.clearStartDelivered();
    if (!this.disposed) this.stateChanged({ kind: "idle" });
  }

  dispose(): void {
    void this.cancelActive();
    this.disposed = true;
    this.generation++;
    this.resetRecovery();
    this.clearStartDelivered();
  }

  /** Explicit manual recovery — for deadline-exceeded retrieving state. */
  retryStatusCheck(): void {
    const runId = this.activeRunId;
    const generation = this.generation;
    if (!runId || this.disposed) return;
    // Single ownership per run_id/generation — do not create new loop if valid current owner exists for this run
    if (
      this.recoveryOwner &&
      this.recoveryOwner.generation === generation &&
      this.recoveryOwner.runId === runId
    ) {
      return;
    }
    this.stateChanged({ kind: "retrieving" });
    void this.tryRecoverStatus(runId, generation).catch(() => {
      // Prevent unhandled rejection from manual retry
    });
  }

  private getSleepState(epoch: number): {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (() => void) | null;
  } {
    let s = this.sleepStates.get(epoch);
    if (!s) {
      s = { timer: null, resolve: null };
      this.sleepStates.set(epoch, s);
    }
    return s;
  }

  private cancelTimerForEpoch(epoch: number): void {
    const state = this.sleepStates.get(epoch);
    if (!state) return;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.resolve) {
      const r = state.resolve;
      state.resolve = null;
      r();
    }
    if (state.timer === null && state.resolve === null) {
      this.sleepStates.delete(epoch);
    }
  }

  private resetRecovery(): void {
    // Invalidate current owner only — previous owner's cleanup must not affect new owner's timer
    const owner = this.recoveryOwner;
    if (owner) {
      this.cancelTimerForEpoch(owner.epoch);
      // Only clear if still current owner (avoid clearing a newer owner that was created after this call started)
      if (this.recoveryOwner?.epoch === owner.epoch) {
        this.recoveryOwner = null;
      }
    } else {
      // No owner but there might be stray timer from previous finally not yet cleaned? Ensure no leak
      // This case happens when reset is called without active owner (e.g., after complete)
      // Nothing to do
    }
  }

  private sleepTrackedForEpoch(ms: number, epoch: number): Promise<void> {
    return new Promise((resolve) => {
      const state = this.getSleepState(epoch);
      // For same epoch, clear previous pending before scheduling new (sequential sleeps)
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.resolve) {
        const old = state.resolve;
        state.resolve = null;
        old();
      }
      state.resolve = resolve;
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.resolve === resolve) {
          state.resolve = null;
        }
        if (state.timer === null && state.resolve === null) {
          this.sleepStates.delete(epoch);
        }
        resolve();
      }, ms);
    });
  }

  // Backward compat alias - not used, will be removed if unused. Keep as no-op to avoid breaking external callers if any.
  // Intentionally removed: clearRecoveryTimer

  private async resolveStart(
    generation: number,
    query: string,
    conversation: AnswerConversationMessage[],
  ): Promise<void> {
    const runId = randomUUID();
    this.activeRunId = runId;
    const startParams = {
      query,
      conversation,
      session_allowed_tools: [...this.sessionAllowed],
      run_id: runId,
    };
    try {
      const response = await this.transport.start(startParams);
      this.noteStartTransportResult(runId);
      if (
        this.disposed ||
        generation !== this.generation ||
        this.activeRunId !== runId
      ) {
        return;
      }
      await this.handleResponse(response, generation);
    } catch (error) {
      this.noteStartTransportResult(runId, error);
      if (this.disposed || generation !== this.generation) return;
      if (this.isRunExpired(error)) {
        this.activeRunId = null;
        this.clearStartDelivered(runId);
        this.stateChanged(this.expiredState());
        return;
      }
      if (this.isInstanceChanged(error)) {
        this.activeRunId = null;
        this.clearStartDelivered(runId);
        this.stateChanged({
          kind: "unavailable",
          code: "RUN_RECOVERY_LOST",
          message:
            "백엔드가 재시작되어 이전 실행을 복구할 수 없습니다. 다시 시도해 주세요.",
        });
        return;
      }
      if (this.isLocalBackendError(error)) {
        const recovered = await this.tryRecoverStatus(runId, generation);
        if (recovered) return;
        if (recovered === null) {
          try {
            const retryResponse = await this.transport.start(startParams);
            if (
              this.disposed ||
              generation !== this.generation ||
              this.activeRunId !== runId
            )
              return;
            await this.handleResponse(retryResponse, generation);
            return;
          } catch (retryError) {
            if (this.disposed || generation !== this.generation) return;
            if (this.isInstanceChanged(retryError)) {
              this.activeRunId = null;
              this.clearStartDelivered(runId);
              this.stateChanged({
                kind: "unavailable",
                code: "RUN_RECOVERY_LOST",
                message:
                  "백엔드가 재시작되어 이전 실행을 복구할 수 없습니다. 다시 시도해 주세요.",
              });
              return;
            }
            this.activeRunId = null;
            this.clearStartDelivered(runId);
            this.stateChanged(this.unavailableState(retryError));
            return;
          }
        }
        this.activeRunId = null;
        this.clearStartDelivered(runId);
        this.stateChanged(this.unavailableState(error));
        return;
      }
      this.activeRunId = null;
      this.clearStartDelivered(runId);
      this.stateChanged(this.unavailableState(error));
    }
  }

  private async tryRecoverStatus(
    runId: string,
    generation: number,
  ): Promise<boolean | null> {
    if (!this.transport.status) return false;
    // Single ownership per generation/runId
    if (
      this.recoveryOwner &&
      this.recoveryOwner.generation === generation &&
      this.recoveryOwner.runId === runId
    ) {
      return true;
    }
    const epoch = ++this.recoveryEpochCounter;
    this.recoveryOwner = { epoch, generation, runId };
    let startedBackground = false;
    try {
      let status: AnswerStatusResponse;
      let seenRun = false;
      try {
        status = await this.transport.status(runId);
        seenRun = true;
      } catch (statusError) {
        // Check instance change before local error
        if (this.isInstanceChanged(statusError)) {
          if (
            !this.disposed &&
            generation === this.generation &&
            this.activeRunId === runId
          ) {
            this.activeRunId = null;
            this.pendingCalls = [];
            this.clearStartDelivered(runId);
            this.stateChanged({
              kind: "unavailable",
              code: "RUN_RECOVERY_LOST",
              message:
                "백엔드가 재시작되어 이전 실행을 복구할 수 없습니다. 다시 시도해 주세요.",
            });
          }
          return true;
        }
        if (this.isRunExpired(statusError)) {
          if (
            !this.disposed &&
            generation === this.generation &&
            this.activeRunId === runId
          ) {
            this.activeRunId = null;
            this.pendingCalls = [];
            this.clearStartDelivered(runId);
            this.stateChanged(this.expiredState());
          }
          return true;
        }
        if (this.isLocalBackendError(statusError)) {
          // Uncertain: original RPC may still be in flight. Poll as running
          // instead of giving up (hides a live LLM) or retrying start (duplicate).
          status = { status: "running", run_id: runId };
        } else if (
          statusError instanceof BackendCallError &&
          statusError.code === "RUN_NOT_FOUND"
        ) {
          if (this.isStartDelivered(runId)) {
            if (
              !this.disposed &&
              generation === this.generation &&
              this.activeRunId === runId
            ) {
              this.activeRunId = null;
              this.pendingCalls = [];
              this.clearStartDelivered(runId);
              this.stateChanged({
                kind: "unavailable",
                code: "RUN_NOT_FOUND",
                message: "실행 상태를 확인할 수 없습니다. 다시 시도해 주세요.",
              });
            }
            return true;
          }
          return null;
        } else {
          return false;
        }
      }
      // If disposed or generation/runId changed after status, do not affect UI for old run
      if (
        this.disposed ||
        generation !== this.generation ||
        this.activeRunId !== runId
      ) {
        return true;
      }
      // Also verify still owner (could have been invalidated by submit)
      if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch) {
        return true;
      }
      switch (status.status) {
        case "complete":
          await this.handleResponse(
            {
              status: "complete",
              run_id: status.run_id,
              result: status.result,
            } as AnswerStartResponse,
            generation,
          );
          return true;
        case "approval_required":
          await this.handleResponse(
            {
              status: "approval_required",
              run_id: status.run_id,
              expires_at: status.expires_at,
              calls: status.calls,
            } as AnswerStartResponse,
            generation,
          );
          return true;
        case "failed":
          // Only affect UI if still current owner
          if (this.recoveryOwner?.epoch !== epoch) return true;
          this.activeRunId = null;
          this.pendingCalls = [];
          this.clearStartDelivered(runId);
          this.stateChanged({
            kind: "unavailable",
            code: status.code,
            message: status.message,
          });
          return true;
        case "cancelled":
          if (this.recoveryOwner?.epoch !== epoch) return true;
          this.activeRunId = null;
          this.pendingCalls = [];
          this.clearStartDelivered(runId);
          this.stateChanged({
            kind: "unavailable",
            code: "ANSWER_CANCELLED",
            message: "실행이 취소되었습니다.",
          });
          return true;
        case "running": {
          const deadline = Date.now() + 55_000;
          let attempt = 0;
          while (Date.now() < deadline) {
            if (
              this.disposed ||
              generation !== this.generation ||
              this.activeRunId !== runId
            ) {
              return true;
            }
            if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch) {
              return true;
            }
            await this.sleepTrackedForEpoch(500, epoch);
            if (
              this.disposed ||
              generation !== this.generation ||
              this.activeRunId !== runId
            ) {
              return true;
            }
            if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch) {
              return true;
            }
            try {
              const polled = await this.transport.status(runId);
              seenRun = true;
              if (polled.status !== "running") {
                // Verify still owner before affecting UI
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  return true;
                if (
                  this.disposed ||
                  generation !== this.generation ||
                  this.activeRunId !== runId
                )
                  return true;
                if (
                  polled.status === "complete" ||
                  polled.status === "approval_required"
                ) {
                  // SAFETY: status payload is complete | approval_required here; AnswerStartResponse is that union.
                  await this.handleResponse(
                    polled as unknown as AnswerStartResponse,
                    generation,
                  );
                  return true;
                }
                if (
                  polled.status === "failed" ||
                  polled.status === "cancelled"
                ) {
                  const code =
                    (polled as { code?: string }).code ||
                    (polled.status === "cancelled"
                      ? "ANSWER_CANCELLED"
                      : "BACKEND_ERROR");
                  const msg =
                    (polled as { message?: string }).message ||
                    (polled.status === "cancelled"
                      ? "실행이 취소되었습니다."
                      : "실행이 실패했습니다.");
                  this.activeRunId = null;
                  this.pendingCalls = [];
                  this.clearStartDelivered(runId);
                  this.stateChanged({
                    kind: "unavailable",
                    code,
                    message: msg,
                  });
                  return true;
                }
              }
              attempt = 0;
            } catch (polledError) {
              if (this.isInstanceChanged(polledError)) {
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  return true;
                this.activeRunId = null;
                this.pendingCalls = [];
                this.clearStartDelivered(runId);
                this.stateChanged({
                  kind: "unavailable",
                  code: "RUN_RECOVERY_LOST",
                  message:
                    "백엔드가 재시작되어 실행 상태를 확인할 수 없습니다.",
                });
                return true;
              }
              if (this.isLocalBackendError(polledError)) {
                const backoff = Math.min(1000 * 1.5 ** attempt, 2000);
                attempt++;
                await this.sleepTrackedForEpoch(backoff, epoch);
                continue;
              }
              if (this.isRunExpired(polledError)) {
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  return true;
                this.activeRunId = null;
                this.pendingCalls = [];
                this.clearStartDelivered(runId);
                this.stateChanged(this.expiredState());
                return true;
              }
              if (
                polledError instanceof BackendCallError &&
                polledError.code === "RUN_NOT_FOUND"
              ) {
                // Never observed and never delivered → original start likely
                // not received; retry same run_id. Otherwise do not start a
                // second LLM call.
                if (!seenRun && !this.isStartDelivered(runId)) return null;
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  return true;
                this.activeRunId = null;
                this.pendingCalls = [];
                this.clearStartDelivered(runId);
                this.stateChanged({
                  kind: "unavailable",
                  code: "RUN_NOT_FOUND",
                  message:
                    "실행 상태를 확인할 수 없습니다. 다시 시도해 주세요.",
                });
                return true;
              }
              if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                return true;
              this.activeRunId = null;
              this.pendingCalls = [];
              this.clearStartDelivered(runId);
              this.stateChanged(this.unavailableState(polledError));
              return true;
            }
          }
          // Deadline exceeded — check still owner before changing UI
          if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
            return true;
          if (
            this.disposed ||
            generation !== this.generation ||
            this.activeRunId !== runId
          )
            return true;
          if (!seenRun && !this.isStartDelivered(runId)) {
            // Still uncertain after the high-frequency window. Let the caller
            // retry the original RPC with the same run_id (backend is idempotent).
            return null;
          }
          if (!seenRun) {
            this.activeRunId = null;
            this.pendingCalls = [];
            this.clearStartDelivered(runId);
            this.stateChanged({
              kind: "unavailable",
              code: "RUN_NOT_FOUND",
              message: "실행 상태를 확인할 수 없습니다. 다시 시도해 주세요.",
            });
            return true;
          }
          this.stateChanged({ kind: "retrieving" });
          startedBackground = true;
          // Keep same owner for background polling
          void (async () => {
            try {
              while (
                !this.disposed &&
                generation === this.generation &&
                this.activeRunId === runId
              ) {
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  break;
                await this.sleepTrackedForEpoch(5000, epoch);
                if (
                  this.disposed ||
                  generation !== this.generation ||
                  this.activeRunId !== runId
                )
                  break;
                if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                  break;
                try {
                  const polled = await this.transport.status(runId);
                  if (polled.status !== "running") {
                    if (
                      !this.recoveryOwner ||
                      this.recoveryOwner.epoch !== epoch
                    )
                      break;
                    if (
                      this.disposed ||
                      generation !== this.generation ||
                      this.activeRunId !== runId
                    )
                      break;
                    if (
                      polled.status === "complete" ||
                      polled.status === "approval_required"
                    ) {
                      // SAFETY: status payload is complete | approval_required here; AnswerStartResponse is that union.
                      await this.handleResponse(
                        polled as unknown as AnswerStartResponse,
                        generation,
                      );
                      break;
                    }
                    if (
                      polled.status === "failed" ||
                      polled.status === "cancelled"
                    ) {
                      const code =
                        (polled as { code?: string }).code ||
                        (polled.status === "cancelled"
                          ? "ANSWER_CANCELLED"
                          : "BACKEND_ERROR");
                      const msg =
                        (polled as { message?: string }).message ||
                        (polled.status === "cancelled"
                          ? "실행이 취소되었습니다."
                          : "실행이 실패했습니다.");
                      this.activeRunId = null;
                      this.pendingCalls = [];
                      this.clearStartDelivered(runId);
                      this.stateChanged({
                        kind: "unavailable",
                        code,
                        message: msg,
                      });
                      break;
                    }
                  }
                } catch (bgError) {
                  if (this.isInstanceChanged(bgError)) {
                    if (
                      !this.recoveryOwner ||
                      this.recoveryOwner.epoch !== epoch
                    )
                      break;
                    this.activeRunId = null;
                    this.pendingCalls = [];
                    this.clearStartDelivered(runId);
                    this.stateChanged({
                      kind: "unavailable",
                      code: "RUN_RECOVERY_LOST",
                      message:
                        "백엔드가 재시작되어 실행 상태를 확인할 수 없습니다.",
                    });
                    break;
                  }
                  if (this.isLocalBackendError(bgError)) {
                    continue;
                  }
                  if (this.isRunExpired(bgError)) {
                    if (
                      !this.recoveryOwner ||
                      this.recoveryOwner.epoch !== epoch
                    )
                      break;
                    this.activeRunId = null;
                    this.pendingCalls = [];
                    this.clearStartDelivered(runId);
                    this.stateChanged(this.expiredState());
                    break;
                  }
                  if (!this.recoveryOwner || this.recoveryOwner.epoch !== epoch)
                    break;
                  this.activeRunId = null;
                  this.pendingCalls = [];
                  this.clearStartDelivered(runId);
                  this.stateChanged(this.unavailableState(bgError));
                  break;
                }
              }
            } finally {
              // Only clear if still current owner
              if (this.recoveryOwner?.epoch === epoch) {
                this.recoveryOwner = null;
                this.cancelTimerForEpoch(epoch);
              } else {
                this.cancelTimerForEpoch(epoch);
              }
            }
          })().catch(() => {
            try {
              if (this.recoveryOwner?.epoch === epoch) {
                this.recoveryOwner = null;
              }
              this.cancelTimerForEpoch(epoch);
            } catch {
              /* ignore cleanup errors */
            }
          });
          return true;
        }
        default:
          return null;
      }
    } finally {
      if (!startedBackground) {
        // Only clear if still owner — previous owner's finally must not clear new owner's state
        if (this.recoveryOwner?.epoch === epoch) {
          this.recoveryOwner = null;
          this.cancelTimerForEpoch(epoch);
        } else {
          // For non-owner, just ensure its own timer is cleaned
          this.cancelTimerForEpoch(epoch);
        }
      }
      // For background case, owner and timer remain for background task; it will clear in its finally
    }
  }

  private noteStartTransportResult(runId: string, error?: unknown): void {
    // Only the current active run owns the delivery state; a stale start
    // resolving after a new submit must not clobber the new run's state.
    if (this.activeRunId !== runId) return;
    if (error === undefined) {
      this.markStartDelivered(runId);
      return;
    }
    if (
      error instanceof BackendCallError &&
      error.details &&
      typeof error.details === "object"
    ) {
      const stage = (error.details as Record<string, unknown>).stage;
      if (stage === "read" || stage === "close" || stage === "timeout") {
        this.markStartDelivered(runId);
      }
    }
  }

  private markStartDelivered(runId: string): void {
    this.startDelivered = true;
    this.startDeliveredRunId = runId;
  }

  private clearStartDelivered(runId?: string): void {
    // Scope the clear to the owning run so an old run's late cleanup can
    // never erase a new run's delivery state (run ids are never reused).
    if (runId === undefined || this.startDeliveredRunId === runId) {
      this.startDelivered = false;
      this.startDeliveredRunId = null;
    }
  }

  private isStartDelivered(runId: string): boolean {
    return this.startDelivered && this.startDeliveredRunId === runId;
  }

  private isRunExpired(error: unknown): boolean {
    return error instanceof BackendCallError && error.code === "RUN_EXPIRED";
  }

  private expiredState(): Extract<AnswerState, { kind: "unavailable" }> {
    return {
      kind: "unavailable",
      code: "RUN_EXPIRED",
      message: "이전 실행이 만료되었습니다. 다시 질문해 주세요.",
    };
  }

  private isLocalBackendError(error: unknown): boolean {
    if (error instanceof BackendCallError) {
      return (
        error.code === "LOCAL_BACKEND_UNAVAILABLE" ||
        error.code === "LOCAL_BACKEND_TIMEOUT" ||
        error.code.startsWith("LOCAL_BACKEND") ||
        error.code === "BACKEND_CONNECTION_FAILED"
      );
    }
    return false;
  }

  private isInstanceChanged(error: unknown): boolean {
    if (
      error instanceof BackendCallError &&
      error.details &&
      typeof error.details === "object"
    ) {
      const d = error.details as Record<string, unknown>;
      return (
        d.instanceChanged === true ||
        d.pidChanged === true ||
        d.startedAtChanged === true
      );
    }
    return false;
  }

  private isPidChanged(error: unknown): boolean {
    return this.isInstanceChanged(error);
  }

  private async handleResponse(
    response: AnswerStartResponse,
    generation: number,
  ): Promise<void> {
    if (this.disposed || generation !== this.generation) return;
    const status = (response as { status?: string }).status;
    if (status === "running") {
      const runId =
        (response as { run_id?: string }).run_id || this.activeRunId;
      if (!runId) return;
      this.activeRunId = runId;
      await this.tryRecoverStatus(runId, generation);
      return;
    }
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
    if (response.status !== "complete" || !response.result) return;
    const completedRunId = response.run_id ?? null;
    this.activeRunId = null;
    this.pendingCalls = [];
    // The complete branch is generation-guarded with no awaits before this
    // point, so no newer run exists whose marker could be erased: clear the
    // delivery marker unconditionally (the response may omit run_id in the
    // legacy path). A leftover marker from an older run is stale and must go.
    if (completedRunId) {
      this.clearStartDelivered(completedRunId);
    } else {
      this.clearStartDelivered();
    }
    const result = response.result;
    this.history.push({ role: "user", content: this.lastQuery });
    this.history.push({ role: "assistant", content: result.answer });
    this.stateChanged({ kind: "answer", result });
  }

  private unavailableState(
    error: unknown,
  ): Extract<AnswerState, { kind: "unavailable" }> {
    const backendError = error instanceof BackendCallError ? error : undefined;
    const details = backendError?.details;
    const evidence =
      details &&
      typeof details === "object" &&
      "evidence" in details &&
      Array.isArray(details.evidence)
        ? (details.evidence as AnswerResult["evidence"])
        : undefined;
    const raw = error instanceof Error ? error.message : String(error);
    const unsafe =
      /ECONNRESET|EPIPE|ECONNABORTED|ETIMEDOUT|WinError\s+\d+|socket/i.test(
        raw,
      );
    const message = unsafe
      ? "로컬 백엔드 연결이 끊어졌습니다. 다시 시도해 주세요."
      : raw;
    return {
      kind: "unavailable",
      code: backendError?.code,
      message,
      evidence,
    };
  }
}
