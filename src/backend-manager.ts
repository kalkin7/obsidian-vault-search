import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "child_process";
import { createWriteStream, existsSync } from "fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { requestUrl } from "obsidian";

/** Sidecar environment names for the LLM provider keys. They must come
 *  exclusively from Obsidian secret storage — a stale OPENAI_API_KEY /
 *  OPENCODE_GO_API_KEY / DEEPSEEK_API_KEY inherited from the host process
 *  would otherwise reach the sidecar and surface as a confusing "Provider
 *  authentication failed". */
const PROVIDER_ENV_VARS = [
  "OPENAI_API_KEY",
  "OPENCODE_GO_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;
import type {
  BackendResponse,
  BackendStatus,
  PythonRuntimeInfo,
  RuntimeInfo,
  VaultSearchSettings,
} from "./types";
import { BACKEND_VERSION, GITHUB_REPO, PROTOCOL_VERSION } from "./constants";
import { requestBackend } from "./backend-protocol";
import { vaultDataDir } from "./runtime-paths";
import { mergeProviderEnvironment } from "./llm-secrets";
import type { McpSecretPayloadResult } from "./mcp-secrets";

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
  private backendProvision: Promise<boolean> | null = null;
  private startGeneration = 0;
  private statusValue: BackendStatus = { state: "stopped" };
  private ownership: "none" | "child" | "attached" = "none";

  constructor(
    readonly vaultPath: string,
    readonly pluginDir: string,
    private readonly getSettings: () => VaultSearchSettings,
    private readonly statusChanged: (status: BackendStatus) => void,
    private readonly manifestVersion = BACKEND_VERSION,
    private readonly getEnvironment: () => Record<string, string> = () => ({}),
    /** Builds the one-shot MCP secret handoff; invoked right after the
     *  sidecar starts listening so servers waiting for env values connect. */
    private readonly getMcpSecretPayload:
      | (() => McpSecretPayloadResult | null)
      | null = null,
  ) {}

  get dataDir(): string {
    return vaultDataDir(this.vaultPath);
  }
  get runtimePath(): string {
    return path.join(this.dataDir, "runtime.json");
  }
  get configPath(): string {
    return path.join(this.dataDir, "service-config.json");
  }
  get machinePath(): string {
    return path.join(this.dataDir, "machine.json");
  }
  get backendRoot(): string {
    return path.join(this.pluginDir, "backend");
  }
  get status(): BackendStatus {
    return { ...this.statusValue };
  }

  async readMachinePython(): Promise<string | null> {
    const config = await this.readMachineConfig();
    return config.pythonExecutable || null;
  }

  async readMachineConfig(): Promise<MachineConfig> {
    try {
      return JSON.parse(
        await readFile(this.machinePath, "utf8"),
      ) as MachineConfig;
    } catch {
      return {};
    }
  }

  async writeMachinePython(pythonExecutable: string): Promise<void> {
    await this.updateMachineConfig((config) => {
      config.pythonExecutable = pythonExecutable;
    });
  }

  async writeManagedRuntime(
    kind: "cpu" | "cuda",
    pythonExecutable: string,
  ): Promise<void> {
    await this.updateMachineConfig((config) => {
      config.runtimes = {
        ...(config.runtimes || {}),
        [kind]: pythonExecutable,
      };
    });
  }

  private async updateMachineConfig(
    change: (config: MachineConfig) => void,
  ): Promise<void> {
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
        if (existsSync(this.machinePath)) {
          await rename(this.machinePath, backup);
          backedUp = true;
        }
        await rename(temp, this.machinePath);
        if (backedUp) await rm(backup, { force: true });
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        if (backedUp && !existsSync(this.machinePath))
          await rename(backup, this.machinePath);
        throw error;
      }
    });
    this.machineWrite = operation.catch(() => undefined);
    return operation;
  }

  async inspectPython(
    pythonExecutable: string,
  ): Promise<PythonRuntimeInfo | null> {
    // engine=onnx executes through onnxruntime, so "CUDA available" must mean
    // the ORT providers can actually run CUDA/TensorRT. torch alone is not
    // enough: a CUDA-enabled torch paired with a CPU-only onnxruntime would be
    // selected as a GPU runtime and then either silently run on CPU
    // (device=auto) or hard-fail (device=cuda).
    const code = [
      "import importlib.util,json,sys,torch,onnxruntime,vault_search",
      "required=['transformers','tokenizers','sentence_transformers','kiwipiepy','usearch','numpy','onnxruntime']",
      "assert all(importlib.util.find_spec(name) for name in required)",
      "providers=onnxruntime.get_available_providers()",
      "ort_cuda='CUDAExecutionProvider' in providers or 'TensorrtExecutionProvider' in providers",
      "print(json.dumps({'executable':sys.executable,'base':sys._base_executable,'torch':torch.__version__,'onnxruntime':onnxruntime.__version__,'ort_providers':providers,'backend':vault_search.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available() and ort_cuda,'device_name':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))",
    ].join(";");
    try {
      // The backend under test is the plugin-side folder, not a pip copy in the
      // venv's site-packages. Without PYTHONPATH here, inspectPython reads the
      // stale installed version and rejects every provisioned runtime.
      const stdout = await this.execFileText(
        pythonExecutable,
        ["-X", "utf8", "-c", code],
        15_000,
        { PYTHONPATH: this.backendRoot },
      );
      const value = JSON.parse(stdout.trim()) as Record<string, unknown>;
      if (String(value.backend || "") !== BACKEND_VERSION) return null;
      return {
        // Prefer the resolved interpreter path (sys.executable) over the input
        // string: the input may be a bare command like "python", which would be
        // persisted and later rejected by Test-Path / Path.exists().
        pythonExecutable: String(value.executable || pythonExecutable),
        baseExecutable: String(value.base || pythonExecutable),
        torchVersion: String(value.torch || "unknown"),
        cudaBuild: value.cuda_build ? String(value.cuda_build) : null,
        cudaAvailable: value.cuda_available === true,
        deviceName: value.device_name ? String(value.device_name) : null,
      };
    } catch {
      return null;
    }
  }

  async hasNvidiaGpu(): Promise<boolean> {
    try {
      await this.execFileText(
        "nvidia-smi.exe",
        ["--query-gpu=name", "--format=csv,noheader"],
        10_000,
      );
      return true;
    } catch {
      return false;
    }
  }

  async managedRuntime(
    kind: "cpu" | "cuda",
  ): Promise<PythonRuntimeInfo | null> {
    const executable = (await this.readMachineConfig()).runtimes?.[kind];
    return executable ? this.inspectPython(executable) : null;
  }

  /** Python to use when settings.pythonExecutable is empty / "python"
   *  (auto mode): the managed venv runtime, cuda first then cpu. Returns null
   *  when no managed runtime is registered. */
  async resolveDefaultPython(): Promise<string | null> {
    for (const kind of ["cuda", "cpu"] as const) {
      const runtime = await this.managedRuntime(kind);
      if (runtime) return runtime.pythonExecutable;
    }
    return null;
  }

  async installManagedRuntime(
    kind: "cpu" | "cuda",
    basePython: string,
    progress: (text: string) => void,
  ): Promise<PythonRuntimeInfo> {
    if (this.runtimeInstall) return this.runtimeInstall;
    this.runtimeInstall = this.runRuntimeInstall(kind, basePython, progress);
    try {
      return await this.runtimeInstall;
    } finally {
      this.runtimeInstall = null;
    }
  }

  private async runRuntimeInstall(
    kind: "cpu" | "cuda",
    basePython: string,
    progress: (text: string) => void,
  ): Promise<PythonRuntimeInfo> {
    const script = path.join(this.backendRoot, "setup-runtime.ps1");
    if (!existsSync(script))
      throw new Error(`Runtime installer is missing: ${script}`);
    const executable = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-PythonExecutable",
          basePython,
          "-Version",
          BACKEND_VERSION,
          "-Runtime",
          kind,
        ],
        {
          cwd: this.pluginDir,
          windowsHide: true,
          shell: false,
          env: { ...process.env, PYTHONUTF8: "1" },
        },
      );
      this.runtimeInstaller = child;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdout += text;
        progress(text.trim());
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        progress(text.trim());
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        this.runtimeInstaller = null;
        if (code === 0)
          resolve(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "");
        else
          reject(
            new Error(
              stderr.trim() || `Runtime installer exited with code ${code}`,
            ),
          );
      });
    });
    const info = await this.inspectPython(executable);
    if (!info) throw new Error("Installed runtime validation failed");
    if (kind === "cuda" && !info.cudaAvailable) {
      throw new Error(
        "CUDA runtime was installed, but CUDA is not available to PyTorch. Check the NVIDIA driver.",
      );
    }
    await this.writeManagedRuntime(kind, executable);
    return info;
  }

  private execFileText(
    executable: string,
    args: string[],
    timeout: number,
    extraEnv?: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          timeout,
          windowsHide: true,
          encoding: "utf8",
          env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });
  }

  private async readBackendVersion(): Promise<string | null> {
    try {
      const content = await readFile(
        path.join(this.backendRoot, "vault_search", "__init__.py"),
        "utf8",
      );
      const match = /__version__\s*=\s*["']([^"']+)["']/.exec(content);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /** Version of the installed plugin-side backend folder (null when the
   *  backend is not provisioned). Exposed for the settings-tab status. */
  async backendVersion(): Promise<string | null> {
    return this.readBackendVersion();
  }

  /** Ensure the Python backend folder exists in the plugin directory and matches
   *  the plugin version. BRAT only installs main.js/manifest/styles.css, so the
   *  sidecar is self-provisioned from the release zip (or via the settings
   *  button) instead of being carried by BRAT. Serialized so automatic startup
   *  and the manual repair button cannot race each other. */
  ensureBackendProvisioned(opts: { force?: boolean } = {}): Promise<boolean> {
    if (!this.backendProvision) {
      this.backendProvision = this.provisionBackendFiles(
        opts.force ?? false,
      ).finally(() => {
        this.backendProvision = null;
      });
    }
    return this.backendProvision;
  }

  private async provisionBackendFiles(force: boolean): Promise<boolean> {
    const current = await this.readBackendVersion();
    if (!force && current === this.manifestVersion) return true;

    const existing = path.join(this.pluginDir, "backend");
    // Recover a valid backup first if the live backend is missing (e.g. a
    // crash happened between the backup and install steps last time).
    if (!existsSync(existing)) {
      const backups = await readdir(this.pluginDir).catch(() => []);
      const candidates = backups
        .filter((n) => n.startsWith("backend.bak."))
        .sort();
      for (const name of candidates.reverse()) {
        const backupPath = path.join(this.pluginDir, name);
        try {
          await rename(backupPath, existing);
          break;
        } catch {
          /* try older */
        }
      }
    }

    const version = this.manifestVersion;
    const zipUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/obsidian-vault-search-v${version}.zip`;
    let response;
    try {
      response = await requestUrl({ url: zipUrl, throw: false });
    } catch (error) {
      throw new Error(
        `백엔드 다운로드 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `백엔드 다운로드 실패 (HTTP ${response.status}): ${zipUrl}`,
      );
    }

    const zip = new AdmZip(Buffer.from(response.arrayBuffer));
    const entries = zip.getEntries();
    const backendEntries = entries.filter((e) => {
      const norm = e.entryName.replace(/\\/g, "/");
      return norm.startsWith("backend/") && !e.isDirectory;
    });
    if (backendEntries.length === 0) {
      throw new Error("릴리스 zip에 backend/ 폴더가 없습니다");
    }

    // Integrity check: the downloaded backend must report the same version the
    // plugin expects. A stale or tampered zip (even from the same URL) would
    // otherwise install code that inspectPython then rejects — or worse.
    const initEntry = entries.find(
      (e) => e.entryName.replace(/\\/g, "/") === "backend/vault_search/__init__.py",
    );
    const versionMatch = initEntry
      ? /__version__\s*=\s*["']([^"']+)["']/.exec(
          initEntry.getData().toString("utf8"),
        )
      : null;
    if (!versionMatch || versionMatch[1] !== this.manifestVersion) {
      throw new Error(
        `릴리스 zip의 백엔드 버전이 일치하지 않습니다: 기대 ${this.manifestVersion}, ` +
          `발견 ${versionMatch ? versionMatch[1] : "없음"}. ${zipUrl}`,
      );
    }

    const tempRoot = path.join(
      this.pluginDir,
      `backend.provision-${Date.now()}`,
    );
    const tempBackend = path.join(tempRoot, "backend");
    try {
      for (const entry of backendEntries) {
        const norm = entry.entryName.replace(/\\/g, "/");
        const rel = norm.slice("backend/".length);
        const dest = path.resolve(tempBackend, rel);
        const inside = path.relative(tempBackend, dest);
        if (path.isAbsolute(rel) || inside === "" || inside.startsWith("..")) {
          throw new Error(
            `안전하지 않은 zip 항목이 감지되어 중단합니다: ${entry.entryName}`,
          );
        }
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, entry.getData());
      }

      const backup = path.join(this.pluginDir, `backend.bak.${Date.now()}`);
      if (existsSync(existing)) await rename(existing, backup);
      try {
        await rename(tempBackend, existing);
      } catch (error) {
        let rollbackError: unknown;
        try {
          await rename(backup, existing);
        } catch (e) {
          rollbackError = e;
        }
        if (rollbackError) {
          throw new Error(
            `백엔드 교체 실패: ${error instanceof Error ? error.message : String(error)}; ` +
              `복구도 실패 — 백업을 유지합니다: ${backup}`,
          );
        }
        throw error;
      }
      // Success: clean up older backups.
      const backups = await readdir(this.pluginDir).catch(() => []);
      for (const name of backups.filter((n) => n.startsWith("backend.bak."))) {
        await rm(path.join(this.pluginDir, name), {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    return true;
  }

  async start(lazyOverride?: boolean): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.startGeneration;
    this.startPromise = this.startInternal(lazyOverride, generation);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(
    lazyOverride: boolean | undefined,
    generation: number,
  ): Promise<void> {
    this.stopping = false;
    this.setStatus({ state: "starting" });
    await mkdir(this.dataDir, { recursive: true });
    const providerEnvironment = this.getEnvironment();
    if (
      Object.keys(providerEnvironment).length === 0 &&
      (await this.tryAttachStandalone())
    )
      return;
    await this.stopStaleRuntime();
    try {
      await this.ensureBackendProvisioned();
    } catch (error) {
      this.setStatus({
        state: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (
      !existsSync(path.join(this.backendRoot, "vault_search", "__main__.py"))
    ) {
      throw new Error(`Python backend is missing: ${this.backendRoot}`);
    }
    await this.writeServiceConfig(lazyOverride);
    if (generation !== this.startGeneration || this.stopping) return;

    const settings = this.getSettings();
    // Auto mode (empty or "python"): resolve the managed venv runtime first;
    // prepareRuntime normally persists the resolved path, this is a safety
    // net for direct start() calls.
    const explicit = settings.pythonExecutable?.trim();
    const python =
      explicit && explicit !== "python"
        ? explicit
        : ((await this.resolveDefaultPython()) ?? "python");
    const args = [
      "-X",
      "utf8",
      "-m",
      "vault_search",
      "serve",
      "--config",
      this.configPath,
      "--vault",
      this.vaultPath,
      "--data-dir",
      this.dataDir,
      "--parent-pid",
      String(process.pid),
      "--watch-stdin",
    ];
    const env = mergeProviderEnvironment(process.env, providerEnvironment);
    // Provider keys reach the sidecar ONLY via Obsidian secret storage:
    // unconditionally overwrite each provider var — either with the stored
    // secret or an explicit empty string — so a stale shell/system key the
    // host process inherited can never masquerade as the stored one.
    for (const name of PROVIDER_ENV_VARS) {
      env[name] = providerEnvironment[name] ?? "";
    }
    env.PYTHONUTF8 = "1";
    env.PYTHONPATH =
      this.backendRoot +
      (env.PYTHONPATH ? path.delimiter + env.PYTHONPATH : "");
    env.HF_HUB_DISABLE_PROGRESS_BARS = "1";
    const child = spawn(python, args, {
      cwd: this.pluginDir,
      env,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.ownership = "child";

    const log = createWriteStream(path.join(this.dataDir, "backend.log"), {
      flags: "a",
    });
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
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
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("error", (error) => {
      this.setStatus({ state: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      log.end(`\n[plugin] backend exit code=${code} signal=${signal}\n`);
      this.child = null;
      this.runtime = null;
      this.clearHeartbeat();
      if (!this.stopping && code !== 0) {
        this.setStatus({
          state: "error",
          error: `Backend exited: code=${code}, signal=${signal}`,
        });
      } else {
        this.setStatus({ state: "stopped" });
      }
    });
  }

  async waitUntilAvailable(timeoutMs = 10_000): Promise<BackendStatus> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached")
        await this.refreshStatus().catch(() => undefined);
      const state = this.statusValue.state;
      if (["idle", "loading_model", "ready", "ready_no_index"].includes(state))
        return this.status;
      if (state === "error")
        throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Backend did not start listening");
  }

  async waitUntilReady(timeoutMs = 180_000): Promise<BackendStatus> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.ownership === "attached")
        await this.refreshStatus().catch(() => undefined);
      const state = this.statusValue.state;
      if (state === "ready" || state === "ready_no_index") return this.status;
      if (state === "error")
        throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Backend model loading timed out");
  }

  private async refreshStatus(): Promise<void> {
    const runtime = this.runtime || (await this.readRuntime());
    if (!runtime) return;
    const response = await requestBackend<BackendStatus>(
      runtime,
      "status",
      {},
      3000,
    );
    if (response.ok) {
      this.setStatus({
        ...(response.data || {}),
        pid: runtime.pid,
        port: runtime.port,
      });
    }
  }

  async stop(preserveAttached = false): Promise<void> {
    this.stopping = true;
    ++this.startGeneration;
    const installer = this.runtimeInstaller;
    if (installer && installer.exitCode === null) {
      installer.kill();
      if (process.platform === "win32" && installer.pid) {
        await new Promise<void>((resolve) => {
          execFile(
            "taskkill.exe",
            ["/PID", String(installer.pid), "/T", "/F"],
            () => resolve(),
          );
        });
      }
      this.runtimeInstaller = null;
    }
    const starting = this.startPromise;
    if (starting) await starting.catch(() => undefined);
    this.clearHeartbeat();
    const child = this.child;
    const runtime = this.runtime || (await this.readRuntime());

    if (this.ownership === "attached" && preserveAttached) {
      // Plugin unload: detach from a standalone daemon and let it live on.
      this.runtime = null;
      this.child = null;
      this.ownership = "none";
      this.setStatus({ state: "stopped" });
      return;
    }

    if (child?.stdin.writable) child.stdin.end();
    const ownedPid = runtime?.pid ?? child?.pid;
    if (runtime) {
      try {
        await requestBackend(runtime, "shutdown", {}, 2000);
      } catch {
        /* force below */
      }
    }
    if (runtime && !child) {
      // Attached standalone: wait for the daemon to actually exit so a follow-up
      // start cannot race a still-running writer holding the ServiceLock.
      const deadline = Date.now() + 10_000;
      while (this.pidRunning(ownedPid as number) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (this.pidRunning(ownedPid as number)) {
        throw new Error(`Standalone backend did not stop: PID ${ownedPid}`);
      }
    }
    if (child && child.exitCode === null) {
      const exited = await this.waitForExit(child, 5000);
      if (!exited) {
        child.kill();
        if (process.platform === "win32" && child.pid) {
          await new Promise<void>((resolve) => {
            execFile(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              () => resolve(),
            );
          });
        }
      }
    }
    try {
      const current = await this.readRuntime();
      if (!current || current.pid === ownedPid)
        await rm(this.runtimePath, { force: true });
    } catch {
      /* ignore */
    }
    this.runtime = null;
    this.child = null;
    this.ownership = "none";
    this.setStatus({ state: "stopped" });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start(false);
    await this.waitUntilReady();
  }

  /** Push MCP env values to the sidecar over the authenticated protocol.
   *  Values never touch disk, logs, or the spawn environment. The payload is
   *  a FULL snapshot of every enabled server (possibly with empty maps) so
   *  rotations AND deletions propagate; the sidecar replaces each listed
   *  server's stored mapping wholesale and reconnects only changed ones. */
  async sendMcpSecrets(): Promise<void> {
    if (!this.getMcpSecretPayload || !this.runtime) return;
    if (!this.getSettings().mcpEnabled) return;
    const built = this.getMcpSecretPayload();
    if (!built) return;
    await this.call("set_mcp_secrets", built.payload, 10_000);
  }

  async call<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 5000,
  ): Promise<T> {
    let runtime = this.runtime;
    if (!runtime) runtime = await this.readRuntime();
    if (!runtime) throw new Error("Backend is not running");
    const response: BackendResponse<T> = await requestBackend<T>(
      runtime,
      method,
      params,
      timeoutMs,
    );
    if (!response.ok) {
      throw new BackendCallError(
        response.error?.code || "BACKEND_ERROR",
        response.error?.message || "Backend request failed",
        response.error?.details,
      );
    }
    const data = response.data as T;
    // Attached standalone backends emit no stdout events, so status transitions
    // (load_model -> ready) never reach handleBackendLine. Sync from any status
    // response so waitUntilReady can observe them.
    if (
      data &&
      typeof data === "object" &&
      "state" in (data as Record<string, unknown>)
    ) {
      this.setStatus({
        ...(data as unknown as BackendStatus),
        pid: runtime.pid,
        port: runtime.port,
      });
    }
    return data;
  }

  async ensureStarted(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) await this.start(false);
    await this.waitUntilAvailable();
    if (this.statusValue.state === "idle") {
      await this.call("load_model", {});
    }
    await this.waitUntilReady();
  }

  /** Serializes service-config writes so concurrent settings saves can't
   *  interleave tmp-file renames (last-write-wins with always-valid JSON). */
  private configWriteChain: Promise<void> = Promise.resolve();

  /** Rewrite service-config.json from the current settings so a sidecar
   *  restart keeps hot (in-memory) model/effort changes instead of reloading
   *  a stale file. Called on every settings save. */
  persistServiceConfig(): Promise<void> {
    const write = this.configWriteChain.then(() => this.writeServiceConfig());
    this.configWriteChain = write.catch(() => undefined);
    return write;
  }

  private async writeServiceConfig(lazyOverride?: boolean): Promise<void> {
    const settings = this.getSettings();
    // The fetched-model cache is plugin-side bookkeeping; keep it out of the
    // sidecar config file.
    const { fetchedProviderModels: _fetched, ...configSettings } = settings;
    const payload = {
      vaultPath: this.vaultPath,
      dataDir: this.dataDir,
      // Resolved for MCP servers configured with cwd="plugin" (plan §6.1).
      pluginPath: this.pluginDir,
      ...configSettings,
      lazyModel: lazyOverride ?? settings.loadPolicy === "first-search",
    };
    // Unique temp name: concurrent writers can't clobber each other's file.
    const temp = `${this.configPath}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await rename(temp, this.configPath);
    } catch {
      // Windows rename-over-existing can fail. Swap via a backup so a failed
      // replacement never leaves the config file missing.
      const backup = `${this.configPath}.bak`;
      await rm(backup, { force: true });
      try {
        await rename(this.configPath, backup);
      } catch {
        // No previous config — nothing to preserve.
      }
      try {
        await rename(temp, this.configPath);
      } catch (error) {
        try {
          await rename(backup, this.configPath);
        } catch {
          // Best-effort restore.
        }
        await rm(temp, { force: true });
        throw error;
      }
      await rm(backup, { force: true });
    }
  }

  private redactLogLine(line: string): string {
    try {
      const value = JSON.parse(line) as { data?: { token?: string } };
      if (value.data?.token) value.data.token = "<redacted>";
      return JSON.stringify(value);
    } catch {
      return line;
    }
  }

  private handleBackendLine(line: string): void {
    let event: BackendEvent;
    try {
      event = JSON.parse(line) as BackendEvent;
    } catch {
      return;
    }
    if (!event.event || !event.data) return;
    if (event.event === "listening") {
      this.runtime = event.data as unknown as RuntimeInfo;
      this.setStatus({
        state:
          String(event.data.state || "loading_model") === "idle"
            ? "idle"
            : "loading_model",
        pid: Number(event.data.pid),
        port: Number(event.data.port),
        model_id: String(event.data.model_id || ""),
      });
      // The server redacts the token from the listening event; read the full
      // runtime (including the token) from disk for authenticated requests.
      void this.readRuntime().then((runtime) => {
        if (runtime) this.runtime = runtime;
        this.startHeartbeat();
        // MCP env values travel over the authenticated loopback only, right
        // after the sidecar is reachable (plan §6.2).
        void this.sendMcpSecrets().catch(() => undefined);
      });
      return;
    }
    if (event.event === "idle") {
      this.setStatus({
        ...(event.data as unknown as BackendStatus),
        state: "idle",
        pid: this.runtime?.pid,
        port: this.runtime?.port,
      });
      return;
    }
    if (event.event === "ready") {
      this.setStatus({
        ...(event.data as unknown as BackendStatus),
        pid: this.runtime?.pid,
        port: this.runtime?.port,
      });
      return;
    }
    if (event.event === "rebuild_progress") {
      this.setStatus({
        progress: `${Number(event.data.processed_files || 0)}/${Number(event.data.total_files || 0)} 파일, ${Number(event.data.chunks || 0)} 청크`,
      });
      return;
    }
    if (event.event === "rebuild_started") {
      this.setStatus({ progress: `0/${Number(event.data.files || 0)} 파일` });
      return;
    }
    if (event.event === "embedding_started") {
      this.setStatus({
        progress: `${Number(event.data.chunks || 0)}개 청크 임베딩 중`,
      });
      return;
    }
    if (event.event === "embedding_finished") {
      this.setStatus({
        progress: `${Number(event.data.chunks || 0)}개 청크 임베딩 완료, 검증 중`,
      });
      return;
    }
    if (event.event === "rebuild_finished") {
      this.setStatus({ progress: undefined });
      return;
    }
    if (event.event === "state" || event.event === "error") {
      this.setStatus({
        ...(event.data as unknown as BackendStatus),
        pid: this.runtime?.pid,
        port: this.runtime?.port,
      });
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    const pulse = () => {
      if (!this.runtime) return;
      void requestBackend(this.runtime, "heartbeat", {}, 2000).catch(
        () => undefined,
      );
    };
    pulse();
    this.heartbeat = setInterval(pulse, 5000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private setStatus(status: Partial<BackendStatus>): void {
    if (status.state === "stopped" || status.state === "starting") {
      // Lifecycle transitions invalidate every runtime-derived field (model,
      // device, provider, index counts, error, ...): a stopped service must
      // not keep reporting the last loaded session's provider/device, or the
      // settings tab would show e.g. "실행 제공자: TensorRT" while nothing
      // is running.
      this.statusValue = { ...status } as BackendStatus;
    } else {
      this.statusValue = { ...this.statusValue, ...status };
    }
    this.statusChanged(this.status);
  }

  private async readRuntime(): Promise<RuntimeInfo | null> {
    try {
      return JSON.parse(
        await readFile(this.runtimePath, "utf8"),
      ) as RuntimeInfo;
    } catch {
      return null;
    }
  }

  /** Attach to a healthy standalone backend instead of spawning a child.
   *  A standalone daemon started by the CLI must survive plugin reloads, so it
   *  is adopted (heartbeat kept, ownership "attached") and never killed by the
   *  plugin lifecycle. */
  private async tryAttachStandalone(): Promise<boolean> {
    const runtime = await this.readRuntime();
    if (!runtime) return false;
    if (runtime.owner !== "standalone") return false;
    if (runtime.protocol_version !== PROTOCOL_VERSION) return false;
    if (
      runtime.backend_version &&
      runtime.backend_version !== this.manifestVersion
    )
      return false;
    if (runtime.vault_path && this.vaultPath) {
      const normalized = (value: string) =>
        value.replace(/\\/g, "/").toLowerCase();
      if (normalized(runtime.vault_path) !== normalized(this.vaultPath))
        return false;
    }
    if (!this.pidRunning(runtime.pid)) return false;
    let statusData: BackendStatus;
    try {
      const response = await requestBackend<BackendStatus>(
        runtime,
        "status",
        {},
        2000,
      );
      if (!response.ok) return false;
      statusData = response.data ?? { state: "stopped" };
    } catch {
      return false;
    }
    this.runtime = runtime;
    this.child = null;
    this.ownership = "attached";
    this.setStatus({ ...statusData, pid: runtime.pid, port: runtime.port });
    this.startHeartbeat();
    return true;
  }

  private stopStaleRuntime(): Promise<void> {
    return this.stopExistingRuntime(false);
  }

  private async stopExistingRuntime(preserveAttached: boolean): Promise<void> {
    const runtime = await this.readRuntime();
    if (!runtime) return;
    // Verify the runtime is genuinely ours before touching its PID. A PID can
    // be reused by an unrelated process; an inauthentic runtime file must not
    // block startup on a process we cannot and should not kill.
    let authentic = false;
    if (this.pidRunning(runtime.pid)) {
      try {
        const status = await requestBackend(runtime, "status", {}, 2000);
        authentic = status.ok;
      } catch {
        authentic = false;
      }
    }
    if (runtime.owner === "standalone" && preserveAttached && authentic) return;
    if (!authentic) {
      await rm(this.runtimePath, { force: true }).catch(() => undefined);
      return;
    }
    try {
      await requestBackend(runtime, "shutdown", {}, 1000);
    } catch {
      /* stale file */
    }
    const deadline = Date.now() + 10_000;
    while (this.pidRunning(runtime.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.pidRunning(runtime.pid)) {
      throw new Error(
        `Existing Vault Search backend did not stop: PID ${runtime.pid}`,
      );
    }
    await rm(this.runtimePath, { force: true });
  }

  private pidRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

export class BackendCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
