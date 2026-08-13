import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import { createWriteStream, existsSync } from "fs";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { requestUrl } from "obsidian";
import type { BackendResponse, BackendStatus, PythonRuntimeInfo, RuntimeInfo, VaultSearchSettings } from "./types";
import { BACKEND_VERSION, GITHUB_REPO } from "./constants";
import { requestBackend } from "./backend-protocol";
import { vaultDataDir } from "./runtime-paths";

interface BackendEvent {
  event: string;
  data: Record<string, unknown>;
}

interface MachineConfig {
  pythonExecutable?: string;
  runtimes?: Partial<Record<"cpu" | "cuda", string>>;
}

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private runtime: RuntimeInfo | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private runtimeInstall: Promise<PythonRuntimeInfo> | null = null;
  private runtimeInstaller: ChildProcessWithoutNullStreams | null = null;
  private machineWrite: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> | null = null;
  private startGeneration = 0;
  private statusValue: BackendStatus = { state: "stopped" };

  constructor(
    readonly vaultPath: string,
    readonly pluginDir: string,
    private readonly getSettings: () => VaultSearchSettings,
    private readonly statusChanged: (status: BackendStatus) => void,
    private readonly manifestVersion = BACKEND_VERSION
  ) {}

  get dataDir(): string { return vaultDataDir(this.vaultPath); }
  get runtimePath(): string { return path.join(this.dataDir, "runtime.json"); }
  get configPath(): string { return path.join(this.dataDir, "service-config.json"); }
  get machinePath(): string { return path.join(this.dataDir, "machine.json"); }
  get backendRoot(): string { return path.join(this.pluginDir, "backend"); }
  get status(): BackendStatus { return { ...this.statusValue }; }

  async readMachinePython(): Promise<string | null> {
    const config = await this.readMachineConfig();
    return config.pythonExecutable || null;
  }

  async readMachineConfig(): Promise<MachineConfig> {
    try {
      return JSON.parse(await readFile(this.machinePath, "utf8")) as MachineConfig;
    } catch { return {}; }
  }

  async writeMachinePython(pythonExecutable: string): Promise<void> {
    await this.updateMachineConfig(config => { config.pythonExecutable = pythonExecutable; });
  }

  async writeManagedRuntime(kind: "cpu" | "cuda", pythonExecutable: string): Promise<void> {
    await this.updateMachineConfig(config => {
      config.runtimes = { ...(config.runtimes || {}), [kind]: pythonExecutable };
    });
  }

  private async updateMachineConfig(change: (config: MachineConfig) => void): Promise<void> {
    const operation = this.machineWrite.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const config = await this.readMachineConfig();
      change(config);
      const suffix = `${process.pid}.${Date.now()}`;
      const temp = `${this.machinePath}.${suffix}.tmp`;
      const backup = `${this.machinePath}.${suffix}.backup`;
      await writeFile(temp, JSON.stringify(config, null, 2), "utf8");
      let backedUp = false;
      try {
        if (existsSync(this.machinePath)) { await rename(this.machinePath, backup); backedUp = true; }
        await rename(temp, this.machinePath);
        if (backedUp) await rm(backup, { force: true });
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        if (backedUp && !existsSync(this.machinePath)) await rename(backup, this.machinePath);
        throw error;
      }
    });
    this.machineWrite = operation.catch(() => undefined);
    return operation;
  }

  async inspectPython(pythonExecutable: string): Promise<PythonRuntimeInfo | null> {
    const code = [
      "import importlib.util,json,sys,torch,vault_search",
      "required=['transformers','tokenizers','sentence_transformers','kiwipiepy','usearch','numpy','onnxruntime']",
      "assert all(importlib.util.find_spec(name) for name in required)",
      "print(json.dumps({'base':sys._base_executable,'torch':torch.__version__,'backend':vault_search.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available(),'device_name':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
    ].join(";");
    try {
      const stdout = await this.execFileText(pythonExecutable, ["-X", "utf8", "-c", code], 15_000);
      const value = JSON.parse(stdout.trim()) as Record<string, unknown>;
      if (String(value.backend || "") !== BACKEND_VERSION) return null;
      return {
        pythonExecutable,
        baseExecutable: String(value.base || pythonExecutable),
        torchVersion: String(value.torch || "unknown"),
        cudaBuild: value.cuda_build ? String(value.cuda_build) : null,
        cudaAvailable: value.cuda_available === true,
        deviceName: value.device_name ? String(value.device_name) : null,
      };
    } catch { return null; }
  }

  async hasNvidiaGpu(): Promise<boolean> {
    try {
      await this.execFileText("nvidia-smi.exe", ["--query-gpu=name", "--format=csv,noheader"], 10_000);
      return true;
    } catch { return false; }
  }

  async managedRuntime(kind: "cpu" | "cuda"): Promise<PythonRuntimeInfo | null> {
    const executable = (await this.readMachineConfig()).runtimes?.[kind];
    return executable ? this.inspectPython(executable) : null;
  }

  async installManagedRuntime(kind: "cpu" | "cuda", basePython: string,
    progress: (text: string) => void): Promise<PythonRuntimeInfo> {
    if (this.runtimeInstall) return this.runtimeInstall;
    this.runtimeInstall = this.runRuntimeInstall(kind, basePython, progress);
    try { return await this.runtimeInstall; }
    finally { this.runtimeInstall = null; }
  }

  private async runRuntimeInstall(kind: "cpu" | "cuda", basePython: string,
    progress: (text: string) => void): Promise<PythonRuntimeInfo> {
    const script = path.join(this.backendRoot, "setup-runtime.ps1");
    if (!existsSync(script)) throw new Error(`Runtime installer is missing: ${script}`);
    const executable = await new Promise<string>((resolve, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
        "-PythonExecutable", basePython, "-Version", BACKEND_VERSION, "-Runtime", kind,
      ], { cwd: this.pluginDir, windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: "1" } });
      this.runtimeInstaller = child;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => {
        const text = chunk.toString("utf8"); stdout += text; progress(text.trim());
      });
      child.stderr.on("data", chunk => {
        const text = chunk.toString("utf8"); stderr += text; progress(text.trim());
      });
      child.on("error", reject);
      child.on("exit", code => {
        this.runtimeInstaller = null;
        if (code !== 0) reject(new Error(stderr.trim() || `Runtime installer exited with code ${code}`));
        else resolve(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "");
      });
    });
    const info = await this.inspectPython(executable);
    if (!info) throw new Error("Installed runtime validation failed");
    if (kind === "cuda" && !info.cudaAvailable) {
      throw new Error("CUDA runtime was installed, but CUDA is not available to PyTorch. Check the NVIDIA driver.");
    }
    await this.writeManagedRuntime(kind, executable);
    return info;
  }

  private execFileText(executable: string, args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(executable, args, { timeout, windowsHide: true, encoding: "utf8" },
        (error, stdout) => error ? reject(error) : resolve(stdout));
    });
  }

  private async readBackendVersion(): Promise<string | null> {
    try {
      const content = await readFile(path.join(this.backendRoot, "vault_search", "__init__.py"), "utf8");
      const match = /__version__\s*=\s*["']([^"']+)["']/.exec(content);
      return match ? match[1] : null;
    } catch { return null; }
  }

  /** Ensure the Python backend folder exists in the plugin directory and matches
   *  the plugin version. BRAT only installs main.js/manifest/styles.css, so the
   *  sidecar is self-provisioned from the release zip (or via the settings
   *  button) instead of being carried by BRAT. */
  async ensureBackendProvisioned(): Promise<boolean> {
    const current = await this.readBackendVersion();
    if (current === this.manifestVersion) return true;

    const version = this.manifestVersion;
    const zipUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/obsidian-vault-search-v${version}.zip`;
    let response;
    try {
      response = await requestUrl({ url: zipUrl, throw: false });
    } catch (error) {
      throw new Error(`백엔드 다운로드 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status !== 200) {
      throw new Error(`백엔드 다운로드 실패 (HTTP ${response.status}): ${zipUrl}`);
    }

    const zip = new AdmZip(Buffer.from(response.arrayBuffer));
    const backendEntries = zip.getEntries().filter(e => e.entryName.startsWith("backend/") && !e.isDirectory);
    if (backendEntries.length === 0) {
      throw new Error("릴리스 zip에 backend/ 폴더가 없습니다");
    }

    const tempRoot = path.join(this.pluginDir, `backend.provision-${Date.now()}`);
    const tempBackend = path.join(tempRoot, "backend");
    const existing = path.join(this.pluginDir, "backend");
    const backup = `${existing}.bak`;
    try {
      for (const entry of backendEntries) {
        const rel = entry.entryName.slice("backend/".length);
        const dest = path.join(tempBackend, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, entry.getData());
      }
      await rm(backup, { recursive: true, force: true });
      if (existsSync(existing)) await rename(existing, backup);
      try {
        await rename(tempBackend, existing);
      } catch (error) {
        await rename(backup, existing).catch(() => undefined);
        throw error;
      }
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    return true;
  }

  async start(lazyOverride?: boolean): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.startGeneration;
    this.startPromise = this.startInternal(lazyOverride, generation);
    try { await this.startPromise; }
    finally { this.startPromise = null; }
  }

  private async startInternal(lazyOverride: boolean | undefined, generation: number): Promise<void> {
    this.stopping = false;
    this.setStatus({ state: "starting" });
    await mkdir(this.dataDir, { recursive: true });
    try {
      await this.ensureBackendProvisioned();
    } catch (error) {
      this.setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    if (!existsSync(path.join(this.backendRoot, "vault_search", "__main__.py"))) {
      throw new Error(`Python backend is missing: ${this.backendRoot}`);
    }
    await this.stopStaleRuntime();
    await this.writeServiceConfig(lazyOverride);
    if (generation !== this.startGeneration || this.stopping) return;

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
    ++this.startGeneration;
    const installer = this.runtimeInstaller;
    if (installer && installer.exitCode === null) {
      installer.kill();
      if (process.platform === "win32" && installer.pid) {
        await new Promise<void>(resolve => {
          execFile("taskkill.exe", ["/PID", String(installer.pid), "/T", "/F"], () => resolve());
        });
      }
      this.runtimeInstaller = null;
    }
    const starting = this.startPromise;
    if (starting) await starting.catch(() => undefined);
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
