import * as net from "net";
import { randomUUID } from "crypto";
import type { BackendResponse, RuntimeInfo } from "./types";
import { PROTOCOL_VERSION } from "./constants";

export class LocalBackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalBackendError";
  }
}

export function safeErrno(error: unknown): string | number | null {
  const anyErr = error as { errno?: unknown; code?: unknown; message?: string };
  if (typeof anyErr.errno === "number") return anyErr.errno;
  if (typeof anyErr.errno === "string") return anyErr.errno;
  if (typeof anyErr.code === "string" && anyErr.code !== "ECONNRESET")
    return anyErr.code;
  // Try extract from message like [WinError 10054] or ECONNRESET
  const msg = anyErr.message || String(error);
  const win = /\[WinError\s+(\d+)\]/.exec(msg);
  if (win) return Number(win[1]);
  if (/ECONNRESET/.test(msg)) return "ECONNRESET";
  if (/EPIPE/.test(msg)) return "EPIPE";
  if (/ETIMEDOUT/.test(msg)) return "ETIMEDOUT";
  if (/ECONNABORTED/.test(msg)) return "ECONNABORTED";
  return null;
}

export function classifyStage(
  error: unknown,
  stage: string,
  method: string,
): { code: string; message: string } {
  const anyErr = error as { code?: string; message?: string };
  const rawCode = (anyErr.code || "") as string;
  const msg = (anyErr.message || String(error)).toLowerCase();
  const isTimeout =
    rawCode === "ETIMEDOUT" ||
    msg.includes("timed out") ||
    msg.includes("timeout");
  if (isTimeout) {
    return {
      code: "LOCAL_BACKEND_TIMEOUT",
      message: "로컬 백엔드 응답 시간이 초과되었습니다.",
    };
  }
  if (
    rawCode === "ECONNRESET" ||
    rawCode === "EPIPE" ||
    rawCode === "ECONNABORTED" ||
    msg.includes("econnreset") ||
    msg.includes("read econnreset")
  ) {
    // Distinguish stage for diagnostics, but user message is classified
    return {
      code: "LOCAL_BACKEND_UNAVAILABLE",
      message: "로컬 백엔드 연결이 끊어졌습니다. 다시 시도해 주세요.",
    };
  }
  if (msg.includes("backend closed without")) {
    return {
      code: "LOCAL_BACKEND_UNAVAILABLE",
      message: "로컬 백엔드가 응답 없이 연결을 종료했습니다.",
    };
  }
  // Generic local failure
  return {
    code: "LOCAL_BACKEND_UNAVAILABLE",
    message: "로컬 백엔드에 연결할 수 없습니다.",
  };
}

export function requestBackend<T>(
  runtime: RuntimeInfo,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 3000,
): Promise<BackendResponse<T>> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const start = Date.now();
    let stage: "connect" | "write" | "read" | "close" | "timeout" = "connect";
    const host = runtime.host || "127.0.0.1";
    const port = runtime.port;
    const pid = runtime.pid;
    const socket = net.createConnection({ host, port });
    let buffer = "";
    let settled = false;
    const logSafe = (event: string, data: Record<string, unknown>) => {
      try {
        // Never log token or params (may contain prompt/vault evidence)
        const safe = {
          event,
          data: {
            request_id: requestId,
            method,
            host,
            port,
            pid,
            stage,
            ...data,
          },
          timestamp: new Date().toISOString(),
        };
        // Use stderr via console.error — plugin's backend.log also captures via event sink
        console.error(JSON.stringify(safe));
      } catch {
        /* ignore */
      }
    };
    const runIdForLog =
      typeof (params as Record<string, unknown>)?.run_id === "string"
        ? String((params as Record<string, unknown>).run_id).slice(0, 64)
        : undefined;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - start;
      const errnoCode = safeErrno(error);
      const classified = classifyStage(error, stage, method);
      logSafe("rpc_error", {
        elapsed_ms: elapsed,
        exc_class: error.name || "Error",
        errno_code: errnoCode == null ? null : String(errnoCode),
        classified_code: classified.code,
        run_id: runIdForLog,
      });
      socket.destroy();
      reject(
        new LocalBackendError(classified.code, classified.message, {
          request_id: requestId,
          run_id: runIdForLog,
          method,
          host,
          port,
          pid,
          stage,
          elapsed_ms: elapsed,
          exc_class: error.name || "Error",
          errno_code: errnoCode == null ? null : String(errnoCode),
        }),
      );
    };
    socket.setNoDelay(true);
    socket.setTimeout(timeoutMs, () => {
      stage = "timeout";
      finishError(new Error(`Backend request timed out: ${method}`));
    });
    socket.on("error", (err) => {
      finishError(err);
    });
    socket.on("connect", () => {
      stage = "write";
      try {
        socket.write(
          JSON.stringify({
            protocol_version: PROTOCOL_VERSION,
            request_id: requestId,
            token: runtime.token,
            method,
            params,
          }) + "\n",
          "utf8",
          (err) => {
            if (err) finishError(err);
            else stage = "read";
          },
        );
      } catch (err) {
        finishError(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on("data", (chunk) => {
      stage = "read";
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(
          buffer.slice(0, newline),
        ) as BackendResponse<T>;
        if (response.request_id !== requestId)
          throw new Error("Mismatched backend request ID");
        settled = true;
        socket.end();
        resolve(response);
      } catch (error) {
        finishError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("close", () => {
      stage = "close";
      if (!settled) finishError(new Error("Backend closed without a response"));
    });
  });
}
