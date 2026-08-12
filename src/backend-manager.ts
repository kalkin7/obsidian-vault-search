import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { createWriteStream, existsSync } from "fs";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import * as path from "path";
import type { BackendResponse, BackendStatus, RuntimeInfo, VaultSearchSettings } from "./types";
import { requestBackend } from "./backend-protocol";
import { vaultDataDir } from "./runtime-paths";

interface BackendEvent {
  event: string;
  data: Record<string, unknown>;
}

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private runtime: RuntimeInfo | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private statusValue: BackendStatus = { state: "stopped" };

  constructor(
    readonly vaultPath: string,
    readonly pluginDir: string,
    private readonly getSettings: () => VaultSearchSettings,
    private readonly statusChanged: (status: BackendStatus) => void
  ) {}

  get dataDir(): string { return vaultDataDir(this.vaultPath); }
  get runtimePath(): string { return path.join(this.dataDir, "runtime.json"); }
  get configPath(): string { return path.join(this.dataDir, "service-config.json"); }
  get machinePath(): string { return path.join(this.dataDir, "machine.json"); }
  get backendRoot(): string { return path.join(this.pluginDir, "backend"); }
  get status(): BackendStatus { return { ...this.statusValue }; }

  async readMachinePython(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(this.machinePath, "utf8")) as { pythonExecutable?: string };
      return value.pythonExecutable || null;
    } catch { return null; }
  }

  async writeMachinePython(pythonExecutable: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const temp = this.machinePath + ".tmp";
    await writeFile(temp, JSON.stringify({ pythonExecutable }, null, 2), "utf8");
    try { await rename(temp, this.machinePath); }
    catch { await rm(this.machinePath, { force: true }); await rename(temp, this.machinePath); }
  }

  async start(lazyOverride?: boolean): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    this.stopping = false;
    this.setStatus({ state: "starting" });
    await mkdir(this.dataDir, { recursive: true });
    if (!existsSync(path.join(this.backendRoot, "vault_search", "__main__.py"))) {
      throw new Error(`Python backend is missing: ${this.backendRoot}`);
    }
    await this.stopStaleRuntime();
    await this.writeServiceConfig(lazyOverride);

    const settings = this.getSettings();
    const args = [
      "-X", "utf8", "-m", "vault_search", "serve",
      "--config", this.configPath,
      "--vault", this.vaultPath,
      "--data-dir", this.dataDir,
      "--parent-pid", String(process.pid),
      "--watch-stdin"
    ];
    const env = { ...process.env };
    env.PYTHONUTF8 = "1";
    env.PYTHONPATH = this.backendRoot + (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : "");
    env.HF_HUB_DISABLE_PROGRESS_BARS = "1";
    const child = spawn(settings.pythonExecutable || "python", args, {
      cwd: this.pluginDir,
      env,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    const log = createWriteStream(path.join(this.dataDir, "backend.log"), { flags: "a" });
    let stdoutBuffer = "";
    child.stdout.on("data", chunk => {
      const text = chunk.toString("utf8");
      stdoutBuffer += text;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) {
          log.write(this.redactLogLine(line) + "\n");
          this.handleBackendLine(line);
        }
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", chunk => log.write(chunk));
    child.on("error", error => {
      this.setStatus({ state: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      log.end(`\n[plugin] backend exit code=${code} signal=${signal}\n`);
      this.child = null;
      this.runtime = null;
      this.clearHeartbeat();
      if (!this.stopping && code !== 0) {
        this.setStatus({ state: "error", error: `Backend exited: code=${code}, signal=${signal}` });
      } else {
        this.setStatus({ state: "stopped" });
      }
    });
  }

  async waitUntilAvailable(timeoutMs = 10_000): Promise<BackendStatus> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.statusValue.state;
      if (["idle", "loading_model", "ready", "ready_no_index"].includes(state)) return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Backend did not start listening");
  }

  async waitUntilReady(timeoutMs = 180_000): Promise<BackendStatus> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.statusValue.state;
      if (state === "ready" || state === "ready_no_index") return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Backend model loading timed out");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearHeartbeat();
    const child = this.child;
    if (child?.stdin.writable) child.stdin.end();
    const runtime = this.runtime || await this.readRuntime();
    const ownedPid = runtime?.pid ?? child?.pid;
    if (runtime) {
      try { await requestBackend(runtime, "shutdown", {}, 2000); } catch { /* force below */ }
    }
    if (child && child.exitCode === null) {
      const exited = await this.waitForExit(child, 5000);
      if (!exited) {
        child.kill();
        if (process.platform === "win32" && child.pid) {
          await new Promise<void>(resolve => {
            execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => resolve());
          });
        }
      }
    }
    try {
      const current = await this.readRuntime();
      if (!current || current.pid === ownedPid) await rm(this.runtimePath, { force: true });
    } catch { /* ignore */ }
    this.runtime = null;
    this.child = null;
    this.setStatus({ state: "stopped" });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start(false);
    await this.waitUntilReady();
  }

  async call<T>(method: string, params: Record<string, unknown> = {},
    timeoutMs = 5000): Promise<T> {
    let runtime = this.runtime;
    if (!runtime) runtime = await this.readRuntime();
    if (!runtime) throw new Error("Backend is not running");
    const response: BackendResponse<T> = await requestBackend<T>(runtime, method, params, timeoutMs);
    if (!response.ok) {
      throw new BackendCallError(response.error?.code || "BACKEND_ERROR",
        response.error?.message || "Backend request failed", response.error?.details);
    }
    return response.data as T;
  }

  async ensureStarted(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) await this.start(false);
    await this.waitUntilAvailable();
    if (this.statusValue.state === "idle") {
      await this.call("load_model", {});
    }
    await this.waitUntilReady();
  }

  private async writeServiceConfig(lazyOverride?: boolean): Promise<void> {
    const settings = this.getSettings();
    const payload = {
      vaultPath: this.vaultPath,
      dataDir: this.dataDir,
      ...settings,
      lazyModel: lazyOverride ?? settings.loadPolicy === "first-search"
    };
    const temp = this.configPath + ".tmp";
    await writeFile(temp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await rename(temp, this.configPath);
    } catch {
      await rm(this.configPath, { force: true });
      await rename(temp, this.configPath);
    }
  }

  private redactLogLine(line: string): string {
    try {
      const value = JSON.parse(line) as { data?: { token?: string } };
      if (value.data?.token) value.data.token = "<redacted>";
      return JSON.stringify(value);
    } catch { return line; }
  }

  private handleBackendLine(line: string): void {
    let event: BackendEvent;
    try { event = JSON.parse(line) as BackendEvent; } catch { return; }
    if (!event.event || !event.data) return;
    if (event.event === "listening") {
      this.runtime = event.data as unknown as RuntimeInfo;
      this.setStatus({
        state: String(event.data.state || "loading_model") === "idle" ? "idle" : "loading_model",
        pid: Number(event.data.pid),
        port: Number(event.data.port),
        model_id: String(event.data.model_id || "")
      });
      this.startHeartbeat();
      return;
    }
    if (event.event === "idle") {
      this.setStatus({ ...(event.data as unknown as BackendStatus),
        state: "idle", pid: this.runtime?.pid, port: this.runtime?.port });
      return;
    }
    if (event.event === "ready") {
      this.setStatus({ ...(event.data as unknown as BackendStatus),
        pid: this.runtime?.pid, port: this.runtime?.port });
      return;
    }
    if (event.event === "rebuild_progress") {
      this.setStatus({
        progress: `${Number(event.data.processed_files || 0)}/${Number(event.data.total_files || 0)} 파일, ${Number(event.data.chunks || 0)} 청크`
      });
      return;
    }
    if (event.event === "rebuild_started") {
      this.setStatus({ progress: `0/${Number(event.data.files || 0)} 파일` });
      return;
    }
    if (event.event === "embedding_started") {
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}개 청크 임베딩 중` });
      return;
    }
    if (event.event === "embedding_finished") {
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}개 청크 임베딩 완료, 검증 중` });
      return;
    }
    if (event.event === "rebuild_finished") {
      this.setStatus({ progress: undefined });
      return;
    }
    if (event.event === "state" || event.event === "error") {
      this.setStatus({ ...(event.data as unknown as BackendStatus),
        pid: this.runtime?.pid, port: this.runtime?.port });
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    const pulse = () => {
      if (!this.runtime) return;
      void requestBackend(this.runtime, "heartbeat", {}, 2000).catch(() => undefined);
    };
    pulse();
    this.heartbeat = setInterval(pulse, 5000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private setStatus(status: Partial<BackendStatus>): void {
    this.statusValue = { ...this.statusValue, ...status };
    this.statusChanged(this.status);
  }

  private async readRuntime(): Promise<RuntimeInfo | null> {
    try {
      return JSON.parse(await readFile(this.runtimePath, "utf8")) as RuntimeInfo;
    } catch { return null; }
  }

  private async stopStaleRuntime(): Promise<void> {
    const runtime = await this.readRuntime();
    if (!runtime) return;
    try {
      await requestBackend(runtime, "shutdown", {}, 1000);
    } catch { /* stale file */ }
    const deadline = Date.now() + 10_000;
    while (this.pidRunning(runtime.pid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (this.pidRunning(runtime.pid)) {
      throw new Error(`Existing Vault Search backend did not stop: PID ${runtime.pid}`);
    }
    await rm(this.runtimePath, { force: true });
  }

  private pidRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
  }
}

export class BackendCallError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
