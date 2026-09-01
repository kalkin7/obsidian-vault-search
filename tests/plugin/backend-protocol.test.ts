import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { classifyStage, safeErrno } from "../../src/backend-protocol";

describe("backend-protocol observability", () => {
  it("classifies ECONNRESET as LOCAL_BACKEND_UNAVAILABLE", () => {
    const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const result = classifyStage(err, "read", "search");
    expect(result.code).toBe("LOCAL_BACKEND_UNAVAILABLE");
    expect(result.message).not.toMatch(/ECONNRESET/);
    expect(result.message).toMatch(/로컬 백엔드/);
  });

  it("classifies timeout as LOCAL_BACKEND_TIMEOUT", () => {
    const err = Object.assign(new Error("Backend request timed out: search"), { code: "ETIMEDOUT" });
    const result = classifyStage(err, "timeout", "search");
    expect(result.code).toBe("LOCAL_BACKEND_TIMEOUT");
  });

  it("safeErrno does not leak token", () => {
    const err = Object.assign(new Error("some error with secret-token should not leak"), { errno: 10054 });
    const code = safeErrno(err);
    expect(code).toBe(10054);
    // Ensure the error message containing token is not returned as code
    expect(String(code)).not.toMatch(/secret-token/);
  });

  it("heartbeat success does not log to console.error (behavior)", async () => {
    const net = await import("net");
    const { requestBackend } = await import("../../src/backend-protocol");
    const server = net.createServer((socket) => {
      socket.on("data", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const resp = JSON.stringify({ request_id: msg.request_id, ok: true, data: { state: "ready" }, protocol_version: 1 }) + "\n";
          socket.write(resp);
          socket.end();
        } catch {}
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime = { host: "127.0.0.1", port: addr.port, token: "secret-token-xyz", pid: 999, protocol_version: 1, model_id: "test" } as unknown as import("../../src/types").RuntimeInfo;
      const resp = await requestBackend(runtime, "heartbeat", {}, 1000);
      expect(resp.ok).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      server.close();
    }
  });

  it("error log does not contain token or prompt", async () => {
    const net = await import("net");
    const { requestBackend } = await import("../../src/backend-protocol");
    // No server on this port -> ECONNREFUSED
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime = { host: "127.0.0.1", port: 59999, token: "secret-token-xyz", pid: 999, protocol_version: 1, model_id: "test" } as unknown as import("../../src/types").RuntimeInfo;
      await expect(requestBackend(runtime, "answer_start", { run_id: "my-run", query: "secret prompt" } as unknown as Record<string, unknown>, 300)).rejects.toThrow();
      const logged = spy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(logged).not.toMatch(/secret-token-xyz/);
      expect(logged).not.toMatch(/secret prompt/);
      expect(logged).toMatch(/my-run/);
    } finally {
      spy.mockRestore();
    }
  });
});
