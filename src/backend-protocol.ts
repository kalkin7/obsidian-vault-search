import * as net from "net";
import { randomUUID } from "crypto";
import type { BackendResponse, RuntimeInfo } from "./types";
import { PROTOCOL_VERSION } from "./constants";

export function requestBackend<T>(runtime: RuntimeInfo, method: string,
  params: Record<string, unknown> = {}, timeoutMs = 3000): Promise<BackendResponse<T>> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const socket = net.createConnection({ host: runtime.host || "127.0.0.1", port: runtime.port });
    let buffer = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => finishError(new Error(`Backend request timed out: ${method}`)));
    socket.on("error", finishError);
    socket.on("connect", () => {
      socket.write(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        request_id: requestId,
        token: runtime.token,
        method,
        params
      }) + "\n", "utf8");
    });
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as BackendResponse<T>;
        if (response.request_id !== requestId) throw new Error("Mismatched backend request ID");
        settled = true;
        socket.end();
        resolve(response);
      } catch (error) {
        finishError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("close", () => {
      if (!settled) finishError(new Error("Backend closed without a response"));
    });
  });
}
