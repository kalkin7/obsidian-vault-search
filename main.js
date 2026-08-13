var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultSearchPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");
var path3 = __toESM(require("path"));

// src/backend-manager.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_promises = require("fs/promises");
var path2 = __toESM(require("path"));

// src/constants.ts
var PROTOCOL_VERSION = 1;
var BACKEND_VERSION = "0.1.2";
var MODEL_PROFILES = {
  "multilingual-e5-base": {
    name: "Multilingual E5 Base (\uAD8C\uC7A5, \uC800\uC790\uC6D0)",
    modelId: "intfloat/multilingual-e5-base",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "\uD604\uC7AC K_Notes \uAE30\uBCF8 \uBAA8\uB378. \uC57D 1.2GB \uBA54\uBAA8\uB9AC, CPU \uAC80\uC0C9\uC774 \uBE60\uB985\uB2C8\uB2E4."
  },
  "bge-m3": {
    name: "BGE-M3 (\uACE0\uC131\uB2A5, \uACE0\uC790\uC6D0)",
    modelId: "BAAI/bge-m3",
    queryPrefix: "",
    documentPrefix: "",
    note: "\uC57D 2.3GB \uBA54\uBAA8\uB9AC. \uBAA8\uB378 \uBCC0\uACBD \uD6C4 \uBCA1\uD130 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4."
  },
  "koe5": {
    name: "KoE5 (\uD55C\uAD6D\uC5B4 \uD2B9\uD654, \uACE0\uC790\uC6D0)",
    modelId: "nlpai-lab/KoE5",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "\uD55C\uAD6D\uC5B4 \uD2B9\uD654 \uBAA8\uB378. \uC57D 2.3GB \uBA54\uBAA8\uB9AC\uC785\uB2C8\uB2E4."
  },
  "custom": {
    name: "\uC0AC\uC6A9\uC790 \uC9C0\uC815 Sentence Transformers \uBAA8\uB378",
    modelId: "",
    queryPrefix: "",
    documentPrefix: "",
    note: "Hugging Face \uBAA8\uB378 ID\uC640 \uC811\uB450\uC5B4\uB97C \uC9C1\uC811 \uC9C0\uC815\uD569\uB2C8\uB2E4."
  }
};
var DEFAULT_SETTINGS = {
  loadPolicy: "first-search",
  pythonExecutable: "python",
  modelProfile: "multilingual-e5-base",
  modelId: "intfloat/multilingual-e5-base",
  engine: "onnx",
  provider: "auto",
  device: "auto",
  queryPrefix: "query: ",
  documentPrefix: "passage: ",
  normalizeEmbeddings: true,
  includeGlobs: ["**/*.md"],
  excludeGlobs: [".obsidian/**", "9_System/**", "**/node_modules/**"],
  chunkChars: 400,
  chunkOverlap: 60,
  chunkingStrategy: "paragraph-v1",
  bm25TopK: 30,
  vectorTopK: 30,
  finalTopK: 20,
  rrfK: 60,
  maxChunksPerFile: 1,
  titleRrfWeight: 1,
  prefixFallback: true,
  syncDebounceMs: 1500,
  autoSync: true,
  startupReconcile: true,
  modelIdleTimeoutSeconds: 0
};

// src/backend-protocol.ts
var net = __toESM(require("net"));
var import_crypto = require("crypto");
function requestBackend(runtime, method, params = {}, timeoutMs = 3e3) {
  return new Promise((resolve2, reject) => {
    const requestId = (0, import_crypto.randomUUID)();
    const socket = net.createConnection({ host: runtime.host || "127.0.0.1", port: runtime.port });
    let buffer = "";
    let settled = false;
    const finishError = (error) => {
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
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response.request_id !== requestId) throw new Error("Mismatched backend request ID");
        settled = true;
        socket.end();
        resolve2(response);
      } catch (error) {
        finishError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("close", () => {
      if (!settled) finishError(new Error("Backend closed without a response"));
    });
  });
}

// src/runtime-paths.ts
var import_crypto2 = require("crypto");
var path = __toESM(require("path"));
function canonicalVaultPath(vaultPath) {
  const normalized = path.resolve(vaultPath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function vaultId(vaultPath) {
  return (0, import_crypto2.createHash)("sha256").update(canonicalVaultPath(vaultPath), "utf8").digest("hex").slice(0, 20);
}
function localDataRoot() {
  const root = process.env.LOCALAPPDATA || path.join(process.env.HOME || process.cwd(), ".local", "share");
  return path.join(root, "ObsidianVaultSearch");
}
function vaultDataDir(vaultPath) {
  return path.join(localDataRoot(), "vaults", vaultId(vaultPath));
}

// src/backend-manager.ts
var BackendManager = class {
  constructor(vaultPath, pluginDir, getSettings, statusChanged) {
    this.vaultPath = vaultPath;
    this.pluginDir = pluginDir;
    this.getSettings = getSettings;
    this.statusChanged = statusChanged;
  }
  child = null;
  runtime = null;
  heartbeat = null;
  stopping = false;
  runtimeInstall = null;
  runtimeInstaller = null;
  machineWrite = Promise.resolve();
  startPromise = null;
  startGeneration = 0;
  statusValue = { state: "stopped" };
  get dataDir() {
    return vaultDataDir(this.vaultPath);
  }
  get runtimePath() {
    return path2.join(this.dataDir, "runtime.json");
  }
  get configPath() {
    return path2.join(this.dataDir, "service-config.json");
  }
  get machinePath() {
    return path2.join(this.dataDir, "machine.json");
  }
  get backendRoot() {
    return path2.join(this.pluginDir, "backend");
  }
  get status() {
    return { ...this.statusValue };
  }
  async readMachinePython() {
    const config = await this.readMachineConfig();
    return config.pythonExecutable || null;
  }
  async readMachineConfig() {
    try {
      return JSON.parse(await (0, import_promises.readFile)(this.machinePath, "utf8"));
    } catch {
      return {};
    }
  }
  async writeMachinePython(pythonExecutable) {
    await this.updateMachineConfig((config) => {
      config.pythonExecutable = pythonExecutable;
    });
  }
  async writeManagedRuntime(kind, pythonExecutable) {
    await this.updateMachineConfig((config) => {
      config.runtimes = { ...config.runtimes || {}, [kind]: pythonExecutable };
    });
  }
  async updateMachineConfig(change) {
    const operation = this.machineWrite.then(async () => {
      await (0, import_promises.mkdir)(this.dataDir, { recursive: true });
      const config = await this.readMachineConfig();
      change(config);
      const suffix = `${process.pid}.${Date.now()}`;
      const temp = `${this.machinePath}.${suffix}.tmp`;
      const backup = `${this.machinePath}.${suffix}.backup`;
      await (0, import_promises.writeFile)(temp, JSON.stringify(config, null, 2), "utf8");
      let backedUp = false;
      try {
        if ((0, import_fs.existsSync)(this.machinePath)) {
          await (0, import_promises.rename)(this.machinePath, backup);
          backedUp = true;
        }
        await (0, import_promises.rename)(temp, this.machinePath);
        if (backedUp) await (0, import_promises.rm)(backup, { force: true });
      } catch (error) {
        await (0, import_promises.rm)(temp, { force: true }).catch(() => void 0);
        if (backedUp && !(0, import_fs.existsSync)(this.machinePath)) await (0, import_promises.rename)(backup, this.machinePath);
        throw error;
      }
    });
    this.machineWrite = operation.catch(() => void 0);
    return operation;
  }
  async inspectPython(pythonExecutable) {
    const code = [
      "import importlib.util,json,sys,torch,vault_search",
      "required=['transformers','tokenizers','sentence_transformers','kiwipiepy','usearch','numpy','onnxruntime']",
      "assert all(importlib.util.find_spec(name) for name in required)",
      "print(json.dumps({'base':sys._base_executable,'torch':torch.__version__,'backend':vault_search.__version__,'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available(),'device_name':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))"
    ].join(";");
    try {
      const stdout = await this.execFileText(pythonExecutable, ["-X", "utf8", "-c", code], 15e3);
      const value = JSON.parse(stdout.trim());
      if (String(value.backend || "") !== BACKEND_VERSION) return null;
      return {
        pythonExecutable,
        baseExecutable: String(value.base || pythonExecutable),
        torchVersion: String(value.torch || "unknown"),
        cudaBuild: value.cuda_build ? String(value.cuda_build) : null,
        cudaAvailable: value.cuda_available === true,
        deviceName: value.device_name ? String(value.device_name) : null
      };
    } catch {
      return null;
    }
  }
  async hasNvidiaGpu() {
    try {
      await this.execFileText("nvidia-smi.exe", ["--query-gpu=name", "--format=csv,noheader"], 1e4);
      return true;
    } catch {
      return false;
    }
  }
  async managedRuntime(kind) {
    const executable = (await this.readMachineConfig()).runtimes?.[kind];
    return executable ? this.inspectPython(executable) : null;
  }
  async installManagedRuntime(kind, basePython, progress) {
    if (this.runtimeInstall) return this.runtimeInstall;
    this.runtimeInstall = this.runRuntimeInstall(kind, basePython, progress);
    try {
      return await this.runtimeInstall;
    } finally {
      this.runtimeInstall = null;
    }
  }
  async runRuntimeInstall(kind, basePython, progress) {
    const script = path2.join(this.backendRoot, "setup-runtime.ps1");
    if (!(0, import_fs.existsSync)(script)) throw new Error(`Runtime installer is missing: ${script}`);
    const executable = await new Promise((resolve2, reject) => {
      const child = (0, import_child_process.spawn)("powershell.exe", [
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
        kind
      ], { cwd: this.pluginDir, windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: "1" } });
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
        if (code !== 0) reject(new Error(stderr.trim() || `Runtime installer exited with code ${code}`));
        else resolve2(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "");
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
  execFileText(executable, args, timeout) {
    return new Promise((resolve2, reject) => {
      (0, import_child_process.execFile)(
        executable,
        args,
        { timeout, windowsHide: true, encoding: "utf8" },
        (error, stdout) => error ? reject(error) : resolve2(stdout)
      );
    });
  }
  async start(lazyOverride) {
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
  async startInternal(lazyOverride, generation) {
    this.stopping = false;
    this.setStatus({ state: "starting" });
    await (0, import_promises.mkdir)(this.dataDir, { recursive: true });
    if (!(0, import_fs.existsSync)(path2.join(this.backendRoot, "vault_search", "__main__.py"))) {
      throw new Error(`Python backend is missing: ${this.backendRoot}`);
    }
    await this.stopStaleRuntime();
    await this.writeServiceConfig(lazyOverride);
    if (generation !== this.startGeneration || this.stopping) return;
    const settings = this.getSettings();
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
      "--watch-stdin"
    ];
    const env = { ...process.env };
    env.PYTHONUTF8 = "1";
    env.PYTHONPATH = this.backendRoot + (env.PYTHONPATH ? path2.delimiter + env.PYTHONPATH : "");
    env.HF_HUB_DISABLE_PROGRESS_BARS = "1";
    const child = (0, import_child_process.spawn)(settings.pythonExecutable || "python", args, {
      cwd: this.pluginDir,
      env,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    const log = (0, import_fs.createWriteStream)(path2.join(this.dataDir, "backend.log"), { flags: "a" });
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
      log.end(`
[plugin] backend exit code=${code} signal=${signal}
`);
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
  async waitUntilAvailable(timeoutMs = 1e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.statusValue.state;
      if (["idle", "loading_model", "ready", "ready_no_index"].includes(state)) return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve2) => setTimeout(resolve2, 100));
    }
    throw new Error("Backend did not start listening");
  }
  async waitUntilReady(timeoutMs = 18e4) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.statusValue.state;
      if (state === "ready" || state === "ready_no_index") return this.status;
      if (state === "error") throw new Error(this.statusValue.error || "Backend failed");
      await new Promise((resolve2) => setTimeout(resolve2, 250));
    }
    throw new Error("Backend model loading timed out");
  }
  async stop() {
    this.stopping = true;
    ++this.startGeneration;
    const installer = this.runtimeInstaller;
    if (installer && installer.exitCode === null) {
      installer.kill();
      if (process.platform === "win32" && installer.pid) {
        await new Promise((resolve2) => {
          (0, import_child_process.execFile)("taskkill.exe", ["/PID", String(installer.pid), "/T", "/F"], () => resolve2());
        });
      }
      this.runtimeInstaller = null;
    }
    const starting = this.startPromise;
    if (starting) await starting.catch(() => void 0);
    this.clearHeartbeat();
    const child = this.child;
    if (child?.stdin.writable) child.stdin.end();
    const runtime = this.runtime || await this.readRuntime();
    const ownedPid = runtime?.pid ?? child?.pid;
    if (runtime) {
      try {
        await requestBackend(runtime, "shutdown", {}, 2e3);
      } catch {
      }
    }
    if (child && child.exitCode === null) {
      const exited = await this.waitForExit(child, 5e3);
      if (!exited) {
        child.kill();
        if (process.platform === "win32" && child.pid) {
          await new Promise((resolve2) => {
            (0, import_child_process.execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => resolve2());
          });
        }
      }
    }
    try {
      const current = await this.readRuntime();
      if (!current || current.pid === ownedPid) await (0, import_promises.rm)(this.runtimePath, { force: true });
    } catch {
    }
    this.runtime = null;
    this.child = null;
    this.setStatus({ state: "stopped" });
  }
  async restart() {
    await this.stop();
    await this.start(false);
    await this.waitUntilReady();
  }
  async call(method, params = {}, timeoutMs = 5e3) {
    let runtime = this.runtime;
    if (!runtime) runtime = await this.readRuntime();
    if (!runtime) throw new Error("Backend is not running");
    const response = await requestBackend(runtime, method, params, timeoutMs);
    if (!response.ok) {
      throw new BackendCallError(
        response.error?.code || "BACKEND_ERROR",
        response.error?.message || "Backend request failed",
        response.error?.details
      );
    }
    return response.data;
  }
  async ensureStarted() {
    if (!this.child || this.child.exitCode !== null) await this.start(false);
    await this.waitUntilAvailable();
    if (this.statusValue.state === "idle") {
      await this.call("load_model", {});
    }
    await this.waitUntilReady();
  }
  async writeServiceConfig(lazyOverride) {
    const settings = this.getSettings();
    const payload = {
      vaultPath: this.vaultPath,
      dataDir: this.dataDir,
      ...settings,
      lazyModel: lazyOverride ?? settings.loadPolicy === "first-search"
    };
    const temp = this.configPath + ".tmp";
    await (0, import_promises.writeFile)(temp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await (0, import_promises.rename)(temp, this.configPath);
    } catch {
      await (0, import_promises.rm)(this.configPath, { force: true });
      await (0, import_promises.rename)(temp, this.configPath);
    }
  }
  redactLogLine(line) {
    try {
      const value = JSON.parse(line);
      if (value.data?.token) value.data.token = "<redacted>";
      return JSON.stringify(value);
    } catch {
      return line;
    }
  }
  handleBackendLine(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event.event || !event.data) return;
    if (event.event === "listening") {
      this.runtime = event.data;
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
      this.setStatus({
        ...event.data,
        state: "idle",
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
      return;
    }
    if (event.event === "ready") {
      this.setStatus({
        ...event.data,
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
      return;
    }
    if (event.event === "rebuild_progress") {
      this.setStatus({
        progress: `${Number(event.data.processed_files || 0)}/${Number(event.data.total_files || 0)} \uD30C\uC77C, ${Number(event.data.chunks || 0)} \uCCAD\uD06C`
      });
      return;
    }
    if (event.event === "rebuild_started") {
      this.setStatus({ progress: `0/${Number(event.data.files || 0)} \uD30C\uC77C` });
      return;
    }
    if (event.event === "embedding_started") {
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC911` });
      return;
    }
    if (event.event === "embedding_finished") {
      this.setStatus({ progress: `${Number(event.data.chunks || 0)}\uAC1C \uCCAD\uD06C \uC784\uBCA0\uB529 \uC644\uB8CC, \uAC80\uC99D \uC911` });
      return;
    }
    if (event.event === "rebuild_finished") {
      this.setStatus({ progress: void 0 });
      return;
    }
    if (event.event === "state" || event.event === "error") {
      this.setStatus({
        ...event.data,
        pid: this.runtime?.pid,
        port: this.runtime?.port
      });
    }
  }
  startHeartbeat() {
    this.clearHeartbeat();
    const pulse = () => {
      if (!this.runtime) return;
      void requestBackend(this.runtime, "heartbeat", {}, 2e3).catch(() => void 0);
    };
    pulse();
    this.heartbeat = setInterval(pulse, 5e3);
  }
  clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
  setStatus(status) {
    this.statusValue = { ...this.statusValue, ...status };
    this.statusChanged(this.status);
  }
  async readRuntime() {
    try {
      return JSON.parse(await (0, import_promises.readFile)(this.runtimePath, "utf8"));
    } catch {
      return null;
    }
  }
  async stopStaleRuntime() {
    const runtime = await this.readRuntime();
    if (!runtime) return;
    try {
      await requestBackend(runtime, "shutdown", {}, 1e3);
    } catch {
    }
    const deadline = Date.now() + 1e4;
    while (this.pidRunning(runtime.pid) && Date.now() < deadline) {
      await new Promise((resolve2) => setTimeout(resolve2, 200));
    }
    if (this.pidRunning(runtime.pid)) {
      throw new Error(`Existing Vault Search backend did not stop: PID ${runtime.pid}`);
    }
    await (0, import_promises.rm)(this.runtimePath, { force: true });
  }
  pidRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  waitForExit(child, timeoutMs) {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve2) => {
      const timer = setTimeout(() => resolve2(false), timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve2(true);
      });
    });
  }
};
var BackendCallError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
};

// src/settings-tab.ts
var import_obsidian = require("obsidian");

// src/settings.ts
var ALL_KEYS = [
  "chunkChars",
  "chunkOverlap",
  "chunkingStrategy"
];
var VECTOR_KEYS = [
  "modelProfile",
  "modelId",
  "device",
  "engine",
  "queryPrefix",
  "documentPrefix",
  "normalizeEmbeddings"
];
var SCOPE_KEYS = ["includeGlobs", "excludeGlobs"];
var RESTART_KEYS = ["pythonExecutable", "modelIdleTimeoutSeconds"];
var HOT_KEYS = [
  "bm25TopK",
  "vectorTopK",
  "finalTopK",
  "rrfK",
  "maxChunksPerFile",
  "titleRrfWeight",
  "prefixFallback"
];
function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function defaultLoadPolicy(engine) {
  return engine === "onnx" ? "first-search" : "vault-open";
}
function settingsImpact(current, next) {
  if (ALL_KEYS.some((key) => !equal(current[key], next[key]))) return "all";
  const providerChangedForOnnx = (current.engine === "onnx" || next.engine === "onnx") && !equal(current.provider, next.provider);
  if (VECTOR_KEYS.some((key) => !equal(current[key], next[key])) || providerChangedForOnnx) return "vectors";
  if (RESTART_KEYS.some((key) => !equal(current[key], next[key]))) return "restart";
  if (SCOPE_KEYS.some((key) => !equal(current[key], next[key]))) return "scope";
  if (HOT_KEYS.some((key) => !equal(current[key], next[key]))) return "hot";
  return equal(current, next) ? "none" : "hot";
}
function cloneSettings(settings) {
  return {
    ...settings,
    includeGlobs: [...settings.includeGlobs],
    excludeGlobs: [...settings.excludeGlobs]
  };
}
function hotConfig(settings) {
  return {
    bm25TopK: settings.bm25TopK,
    vectorTopK: settings.vectorTopK,
    finalTopK: settings.finalTopK,
    rrfK: settings.rrfK,
    maxChunksPerFile: settings.maxChunksPerFile,
    titleRrfWeight: settings.titleRrfWeight,
    prefixFallback: settings.prefixFallback,
    includeGlobs: settings.includeGlobs,
    excludeGlobs: settings.excludeGlobs
  };
}

// src/settings-tab.ts
var VaultSearchSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(owner) {
    super(owner.app, owner);
    this.owner = owner;
  }
  display() {
    const { containerEl } = this;
    const draft = this.owner.draftSettings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Search Service" });
    const status = this.owner.backend?.status || { state: "stopped" };
    const statusEl = containerEl.createDiv({ cls: "vault-search-status" });
    statusEl.setText([
      `\uC0C1\uD0DC: ${status.state}`,
      status.model_id ? `\uBAA8\uB378: ${status.model_id}` : "",
      status.device ? `\uB514\uBC14\uC774\uC2A4: ${status.device}` : "",
      status.pid ? `PID: ${status.pid} / \uD3EC\uD2B8: ${status.port}` : "",
      status.count_available === false ? "\uC778\uB371\uC2A4 \uAC1C\uC218: \uD655\uC778 \uBD88\uAC00" : status.files !== void 0 ? `\uC778\uB371\uC2A4: \uD30C\uC77C ${status.files}\uAC1C / \uCCAD\uD06C ${status.chunks ?? 0}\uAC1C` : "",
      status.model_load_seconds !== void 0 ? `\uCD5C\uADFC \uBAA8\uB378 \uB85C\uB529: ${status.model_load_seconds}\uCD08` : "",
      status.progress ? `\uC9C4\uD589: ${status.progress}` : "",
      status.pending_recovery_required ? `\uBCF5\uAD6C \uC7AC\uC2DC\uB3C4 \uD544\uC694: ${status.pending_recovery_warning || "pending path journal"}` : "",
      status.error ? `\uC624\uB958: ${status.error}` : "",
      this.owner.runtimeSummary,
      this.owner.runtimeWarning || ""
    ].filter(Boolean).join("\n"));
    if (status.error) statusEl.addClass("vault-search-error");
    const impact = settingsImpact(this.owner.settings, draft);
    new import_obsidian.Setting(containerEl).setName("\uC11C\uBE44\uC2A4 \uC81C\uC5B4 \uBC0F \uC124\uC815 \uC801\uC6A9").setDesc(`\uBAA8\uB378\uC740 \uC774 \uBCFC\uD2B8\uC5D0\uC11C\uB9CC \uC0C1\uC8FC\uD569\uB2C8\uB2E4. \uB300\uAE30 \uC911\uC778 \uC124\uC815 \uC601\uD5A5: ${impact}`).addButton((button) => button.setButtonText("\uC2DC\uC791").onClick(async () => {
      try {
        await this.owner.startBackend();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC911\uC9C0").onClick(async () => {
      try {
        await this.owner.stopBackend();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC124\uC815 \uC801\uC6A9").setCta().onClick(async () => {
      try {
        await this.owner.applyDraftSettings();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uBCC0\uACBD \uCDE8\uC18C").onClick(() => this.owner.resetDraftSettings()));
    new import_obsidian.Setting(containerEl).setName("\uC2DC\uC791 \uC815\uCC45").setDesc("\uAE30\uBCF8\uAC12\uC740 \uC5D4\uC9C4\uC5D0 \uB530\uB77C \uC790\uB3D9 \uC870\uC815\uB429\uB2C8\uB2E4: ONNX\uB294 \uCCAB \uAC80\uC0C9 \uC2DC \uB85C\uB4DC, PyTorch\uB294 \uBCFC\uD2B8 \uC5F4 \uB54C \uB85C\uB4DC. \uC5EC\uAE30\uC11C \uC9C1\uC811 \uC120\uD0DD\uD558\uBA74 \uADF8 \uAC12\uC774 \uC720\uC9C0\uB429\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("vault-open", "\uBCFC\uD2B8\uB97C \uC5F4 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("first-search", "\uCCAB \uAC80\uC0C9 \uB54C \uBAA8\uB378 \uB85C\uB4DC").addOption("manual", "\uC218\uB3D9 \uC2DC\uC791").setValue(draft.loadPolicy).onChange((value) => {
      draft.loadPolicy = value;
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("\uC720\uD734 \uBAA8\uB378 \uC5B8\uB85C\uB4DC (\uCD08)").setDesc("0\uC774\uBA74 \uBE44\uD65C\uC131(\uB85C\uB4DC \uD6C4 \uC0C1\uC8FC). \uAC80\uC0C9\uC774 \uC5C6\uC73C\uBA74 \uC774 \uC2DC\uAC04 \uD6C4 \uBAA8\uB378\uC744 \uC5B8\uB85C\uB4DC\uD569\uB2C8\uB2E4. ONNX \uC5D4\uC9C4\uC740 ORT \uC138\uC158\uC744 \uD574\uC81C\uD574 VRAM/RAM\uC744 \uBC18\uD658\uD558\uACE0, \uB2E4\uC74C \uAC80\uC0C9 \uC2DC \uB2E4\uC2DC \uB85C\uB4DC\uD569\uB2C8\uB2E4. PyTorch \uC5D4\uC9C4\uC740 \uCC38\uC870\uB97C \uD574\uC81C\uD558\uB418 CUDA \uCE90\uC2DC\uB85C VRAM \uC77C\uBD80\uAC00 \uB0A8\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.modelIdleTimeoutSeconds)).onChange((value) => {
      draft.modelIdleTimeoutSeconds = this.nonnegativeNumber(value, draft.modelIdleTimeoutSeconds);
    }));
    new import_obsidian.Setting(containerEl).setName("Python \uC2E4\uD589 \uD30C\uC77C").setDesc("\uC804\uC6A9 venv\uC758 python.exe\uB97C \uAD8C\uC7A5\uD569\uB2C8\uB2E4.").addText((text) => text.setValue(draft.pythonExecutable).setPlaceholder("python").onChange((value) => {
      draft.pythonExecutable = value.trim() || "python";
    }));
    new import_obsidian.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBAA8\uB378").addDropdown((dropdown) => {
      for (const [id, profile] of Object.entries(MODEL_PROFILES)) dropdown.addOption(id, profile.name);
      dropdown.setValue(draft.modelProfile).onChange((id) => {
        const profile = MODEL_PROFILES[id];
        draft.modelProfile = id;
        if (id !== "custom" && profile) {
          draft.modelId = profile.modelId;
          draft.queryPrefix = profile.queryPrefix;
          draft.documentPrefix = profile.documentPrefix;
        }
        this.display();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\uBAA8\uB378 ID").setDesc(MODEL_PROFILES[draft.modelProfile]?.note || "Sentence Transformers \uBAA8\uB378 ID").addText((text) => text.setValue(draft.modelId).onChange((value) => {
      draft.modelId = value.trim();
    }));
    new import_obsidian.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uBC31\uC5D4\uB4DC").setDesc("ONNX Runtime(\uAE30\uBCF8): \uC9C1\uC811 ONNX \uACBD\uB85C\uB85C \uC2DC\uC791\uC774 \uBE60\uB974\uACE0 \uC720\uD734 \uC2DC VRAM/RAM\uC744 \uD574\uC81C\uD569\uB2C8\uB2E4. GPU\uAC00 \uC788\uC73C\uBA74 TensorRT/CUDA\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC790\uB3D9 \uC0AC\uC6A9\uD569\uB2C8\uB2E4. PyTorch: \uBC8C\uD06C \uC778\uB371\uC2F1\uC774 \uAC00\uC7A5 \uBE60\uB974\uC9C0\uB9CC \uC2DC\uC791\uC774 \uB290\uB9BD\uB2C8\uB2E4. \uBC31\uC5D4\uB4DC\uB97C \uBC14\uAFB8\uBA74 \uC2DC\uC791 \uC815\uCC45 \uAE30\uBCF8\uAC12\uB3C4 \uD568\uAED8 \uC870\uC815\uB429\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("onnx", "ONNX Runtime (\uAE30\uBCF8, \uAD8C\uC7A5)").addOption("pytorch", "PyTorch").setValue(draft.engine).onChange((value) => {
      const previous = draft.engine;
      draft.engine = value;
      if (draft.loadPolicy === defaultLoadPolicy(previous)) {
        draft.loadPolicy = defaultLoadPolicy(draft.engine);
      }
      this.display();
    }));
    containerEl.createEl("h3", { text: "\uACE0\uAE09 \uC124\uC815" });
    new import_obsidian.Setting(containerEl).setName("\uB514\uBC14\uC774\uC2A4").setDesc("\uC790\uB3D9(\uAE30\uBCF8)\uC740 GPU\uC640 \uAC80\uC99D\uB41C CUDA \uB7F0\uD0C0\uC784\uC774 \uC788\uC73C\uBA74 GPU\uB97C, \uC5C6\uC73C\uBA74 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4. CUDA\uB97C \uBA85\uC2DC\uD558\uBA74 \uB300\uC6A9\uB7C9 \uB7F0\uD0C0\uC784 \uB2E4\uC6B4\uB85C\uB4DC\uAC00 \uD544\uC694\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("auto", "\uC790\uB3D9").addOption("cpu", "CPU").addOption("cuda", "CUDA").setValue(draft.device).onChange((value) => {
      draft.device = value;
    }));
    const caps = status.capabilities;
    if (draft.engine === "onnx" && caps && caps.derived_model_available === false) {
      new import_obsidian.Setting(containerEl).setName("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC900\uBE44").setDesc(caps.model_available === false ? "e5-base \uBAA8\uB378 \uC2A4\uB0C5\uC0F7\uC774 \uB85C\uCEEC\uC5D0 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 intfloat/multilingual-e5-base\uB97C \uBC1B\uC544 \uC8FC\uC138\uC694." : "\uB85C\uCEEC \uC2A4\uB0C5\uC0F7\uC5D0 \uD30C\uC0DD \uD480\uB9C1 \uADF8\uB798\uD504(onnx/model-pooled-normalized.onnx)\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0DD\uC131\uC744 \uC2E4\uD589\uD558\uBA74 ONNX \uC5D4\uC9C4\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addButton((button) => {
        button.setButtonText("\uD30C\uC0DD \uBAA8\uB378 \uC0DD\uC131").setCta();
        if (caps.model_available === false) button.setDisabled(true);
        button.onClick(async () => {
          try {
            await this.owner.provisionOnnx();
          } catch (error) {
            this.showError(error);
          }
        });
      });
    }
    const providerOptions = [["auto", "\uC790\uB3D9"]];
    if (caps?.cuda_available) providerOptions.push(["cuda", "CUDA"]);
    if (caps?.tensorrt_available) providerOptions.push(["tensorrt", "TensorRT"]);
    const supported = caps ? [caps.cuda_available && "CUDA", caps.tensorrt_available && "TensorRT"].filter(Boolean).join(", ") || "CPU\uB9CC" : "\uC11C\uBE44\uC2A4 \uC2DC\uC791 \uD6C4 \uD655\uC778";
    const providerValue = providerOptions.some(([value]) => value === draft.provider) ? draft.provider : "auto";
    new import_obsidian.Setting(containerEl).setName("ONNX \uC2E4\uD589 \uC81C\uACF5\uC790 (provider)").setDesc(`CUDA\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uB429\uB2C8\uB2E4. \uC774 \uBA38\uC2E0 \uC9C0\uC6D0: ${supported}. auto\uB294 TensorRT\uAC00 \uC124\uCE58\uB418\uC5B4 \uC788\uC73C\uBA74 \uC6B0\uC120\uD558\uACE0, \uC544\uB2C8\uBA74 CUDA\uB85C \uD3F4\uBC31\uD569\uB2C8\uB2E4.`).addDropdown((dropdown) => {
      for (const [value, label] of providerOptions) dropdown.addOption(value, label);
      dropdown.setValue(providerValue).setDisabled(draft.engine !== "onnx" || draft.device !== "cuda").onChange((value) => {
        draft.provider = value;
      });
    });
    new import_obsidian.Setting(containerEl).setName("CUDA \uB7F0\uD0C0\uC784").setDesc("NVIDIA GPU\uC6A9 PyTorch\uC640 onnxruntime-gpu\uB97C \uBCC4\uB3C4 \uC124\uCE58\uD569\uB2C8\uB2E4. \uC218 GB \uB2E4\uC6B4\uB85C\uB4DC\uC640 \uBCA1\uD130 \uC7AC\uAD6C\uCD95\uC73C\uB85C \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addButton((button) => button.setButtonText("CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58").onClick(async () => {
      try {
        await this.owner.installCudaRuntime();
      } catch (error) {
        this.showError(error);
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\uC784\uBCA0\uB529 \uC815\uADDC\uD654").addToggle((toggle) => toggle.setValue(draft.normalizeEmbeddings).onChange((value) => {
      draft.normalizeEmbeddings = value;
    }));
    new import_obsidian.Setting(containerEl).setName("Query prefix").addText((text) => text.setValue(draft.queryPrefix).onChange((value) => {
      draft.queryPrefix = value;
    }));
    new import_obsidian.Setting(containerEl).setName("Document prefix").addText((text) => text.setValue(draft.documentPrefix).onChange((value) => {
      draft.documentPrefix = value;
    }));
    new import_obsidian.Setting(containerEl).setName("Include globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").addTextArea((area) => {
      area.setValue(draft.includeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.includeGlobs = this.lines(value);
      });
    });
    new import_obsidian.Setting(containerEl).setName("Exclude globs").setDesc("\uBCFC\uD2B8 \uC0C1\uB300 \uACBD\uB85C, \uD55C \uC904\uC5D0 \uD558\uB098").addTextArea((area) => {
      area.setValue(draft.excludeGlobs.join("\n"));
      area.inputEl.rows = 7;
      area.onChange((value) => {
        draft.excludeGlobs = this.lines(value);
      });
    });
    new import_obsidian.Setting(containerEl).setName("\uC778\uB371\uC2A4 \uAD00\uB9AC").setDesc("\uC124\uC815 \uC801\uC6A9 \uD6C4 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694. \uC7AC\uAD6C\uCD95\uC740 \uC784\uC2DC \uD30C\uC77C \uAC80\uC99D \uD6C4 \uC6D0\uC790\uC801\uC73C\uB85C \uAD50\uCCB4\uB429\uB2C8\uB2E4.").addButton((button) => button.setButtonText("\uBC94\uC704 \uBBF8\uB9AC\uBCF4\uAE30").onClick(async () => {
      try {
        const result = await this.owner.previewScope();
        new import_obsidian.Notice(`\uAC80\uC0C9 \uB300\uC0C1: ${result.count}\uAC1C \uD30C\uC77C`);
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC815\uBC00 \uB300\uC870").onClick(async () => {
      try {
        await this.owner.reconcile("strict");
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uBCA1\uD130 \uC7AC\uAD6C\uCD95").onClick(async () => {
      try {
        await this.owner.rebuildVectors();
      } catch (error) {
        this.showError(error);
      }
    })).addButton((button) => button.setButtonText("\uC804\uCCB4 \uC7AC\uAD6C\uCD95").setWarning().onClick(async () => {
      try {
        await this.owner.rebuildAll();
      } catch (error) {
        this.showError(error);
      }
    }));
    new import_obsidian.Setting(containerEl).setName("\uCCAD\uD06C \uD06C\uAE30 / \uC624\uBC84\uB7A9").setDesc("\uAC12\uC744 \uBCC0\uACBD\uD558\uBA74 \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.chunkChars)).onChange((value) => {
      draft.chunkChars = this.positiveNumber(value, draft.chunkChars);
    })).addText((text) => text.setValue(String(draft.chunkOverlap)).onChange((value) => {
      draft.chunkOverlap = this.nonnegativeNumber(value, draft.chunkOverlap);
    }));
    new import_obsidian.Setting(containerEl).setName("\uCCAD\uD0B9 \uC804\uB7B5").setDesc("Markdown \uAD6C\uC870 \uC778\uC2DD \uC804\uB7B5\uC744 \uD3EC\uD568\uD574 \uBCC0\uACBD \uC2DC \uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.").addDropdown((dropdown) => dropdown.addOption("paragraph-v1", "\uBB38\uB2E8 \uAE30\uBC18 (\uAE30\uBCF8\uAC12)").addOption("markdown-v2", "Markdown \uAD6C\uC870 \uC778\uC2DD").setValue(draft.chunkingStrategy).onChange((value) => {
      draft.chunkingStrategy = value;
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("BM25 / \uBCA1\uD130 / \uCD5C\uC885 \uD6C4\uBCF4 / RRF k").setDesc("\uCD5C\uC885 \uD6C4\uBCF4\uB294 16~40\uAC1C\uB97C \uAD8C\uC7A5\uD569\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.bm25TopK)).onChange((value) => {
      draft.bm25TopK = this.positiveNumber(value, draft.bm25TopK);
    })).addText((text) => text.setValue(String(draft.vectorTopK)).onChange((value) => {
      draft.vectorTopK = this.positiveNumber(value, draft.vectorTopK);
    })).addText((text) => text.setValue(String(draft.finalTopK)).onChange((value) => {
      draft.finalTopK = this.positiveNumber(value, draft.finalTopK);
    })).addText((text) => text.setValue(String(draft.rrfK)).onChange((value) => {
      draft.rrfK = this.positiveNumber(value, draft.rrfK);
    }));
    new import_obsidian.Setting(containerEl).setName("\uAC80\uC0C9 \uB2E4\uC591\uC131 / \uC81C\uBAA9 \uAC00\uC911\uCE58").setDesc("\uD30C\uC77C\uB2F9 \uCD5C\uB300 \uCCAD\uD06C \uC218\uC640 \uD30C\uC77C\uBA85\xB7\uACBD\uB85C\xB7\uD5E4\uB529 RRF \uAC00\uC911\uCE58\uC785\uB2C8\uB2E4. \uAE30\uBCF8\uAC12\uC740 1 / 1.0\uC785\uB2C8\uB2E4.").addText((text) => text.setValue(String(draft.maxChunksPerFile)).onChange((value) => {
      draft.maxChunksPerFile = this.positiveNumber(value, draft.maxChunksPerFile);
    })).addText((text) => text.setValue(String(draft.titleRrfWeight)).onChange((value) => {
      draft.titleRrfWeight = this.nonnegativeNumber(value, draft.titleRrfWeight);
    }));
    new import_obsidian.Setting(containerEl).setName("\uC811\uB450\uC0AC \uAC80\uC0C9 \uD3F4\uBC31").setDesc("\uC815\uD655 BM25 \uACB0\uACFC\uAC00 \uC5C6\uC744 \uB54C \uD1A0\uD070 \uC811\uB450\uC0AC \uAC80\uC0C9\uC73C\uB85C \uD55C \uBC88 \uB354 \uCC3E\uC2B5\uB2C8\uB2E4.").addToggle((toggle) => toggle.setValue(draft.prefixFallback).onChange((value) => {
      draft.prefixFallback = value;
    }));
    new import_obsidian.Setting(containerEl).setName("\uB3D9\uAE30\uD654 debounce (ms)").addText((text) => text.setValue(String(draft.syncDebounceMs)).onChange((value) => {
      draft.syncDebounceMs = this.positiveNumber(value, draft.syncDebounceMs);
    }));
    new import_obsidian.Setting(containerEl).setName("\uC790\uB3D9 \uC99D\uBD84 \uB3D9\uAE30\uD654").addToggle((toggle) => toggle.setValue(draft.autoSync).onChange((value) => {
      draft.autoSync = value;
    }));
    new import_obsidian.Setting(containerEl).setName("\uC2DC\uC791 \uC2DC \uC804\uCCB4 \uB300\uC870").addToggle((toggle) => toggle.setValue(draft.startupReconcile).onChange((value) => {
      draft.startupReconcile = value;
    }));
  }
  lines(value) {
    return value.split(/\r?\n/).map((line) => line.trim().replace(/\\/g, "/")).filter(Boolean);
  }
  positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  nonnegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  showError(error) {
    new import_obsidian.Notice(`Vault Search \uC624\uB958: ${error instanceof Error ? error.message : String(error)}`, 8e3);
    this.display();
  }
};

// src/vault-event-queue.ts
var VaultEventQueue = class {
  constructor(debounceMs, flushCallback, maxBatchSize = 200) {
    this.debounceMs = debounceMs;
    this.flushCallback = flushCallback;
    this.maxBatchSize = maxBatchSize;
  }
  changed = /* @__PURE__ */ new Set();
  deleted = /* @__PURE__ */ new Set();
  timer = null;
  flushing = false;
  markChanged(path4) {
    if (!path4.toLowerCase().endsWith(".md")) return;
    this.deleted.delete(path4);
    this.changed.add(path4);
    this.schedule();
  }
  markDeleted(path4) {
    if (!path4.toLowerCase().endsWith(".md")) return;
    this.changed.delete(path4);
    this.deleted.add(path4);
    this.schedule();
  }
  async flush() {
    if (this.flushing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.changed.size === 0 && this.deleted.size === 0) return;
    this.flushing = true;
    const changed = [...this.changed].slice(0, this.maxBatchSize);
    const remaining = Math.max(0, this.maxBatchSize - changed.length);
    const deleted = [...this.deleted].slice(0, remaining);
    for (const path4 of changed) this.changed.delete(path4);
    for (const path4 of deleted) this.deleted.delete(path4);
    try {
      const accepted = await this.flushCallback(changed, deleted);
      if (!accepted) {
        for (const path4 of changed) this.changed.add(path4);
        for (const path4 of deleted) this.deleted.add(path4);
      }
    } catch {
      for (const path4 of changed) this.changed.add(path4);
      for (const path4 of deleted) this.deleted.add(path4);
    } finally {
      this.flushing = false;
      if (this.changed.size || this.deleted.size) this.schedule();
    }
  }
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changed.clear();
    this.deleted.clear();
  }
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), Math.max(100, this.debounceMs()));
  }
};

// src/search-modal.ts
var import_obsidian2 = require("obsidian");

// src/search-session.ts
function selectedTextQuery(editor) {
  return editor.getSelection();
}
var SearchSession = class {
  constructor(search, stateChanged, debounceMs = 250) {
    this.search = search;
    this.stateChanged = stateChanged;
    this.debounceMs = debounceMs;
  }
  timer = null;
  generation = 0;
  setQuery(value) {
    const query = value.trim();
    const generation = ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (query.length < 2) {
      this.stateChanged({ kind: "idle" });
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.execute(query, generation);
    }, this.debounceMs);
  }
  dispose() {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  async execute(query, generation) {
    this.stateChanged({ kind: "loading" });
    try {
      const results = await this.search(query);
      if (generation !== this.generation) return;
      this.stateChanged({ kind: "results", results });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stateChanged({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
};

// src/search-result-view.ts
function resultLocation(result) {
  return { path: result.file_path, line: Math.max(1, result.start_line ?? 1) };
}
var SearchResultView = class {
  constructor(containerEl, openResult) {
    this.containerEl = containerEl;
    this.openResult = openResult;
  }
  render(results) {
    this.containerEl.empty();
    if (results.length === 0) {
      this.containerEl.createDiv({ cls: "vault-search-empty", text: "\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." });
      return;
    }
    for (const result of results) {
      const location = resultLocation(result);
      const item = this.containerEl.createEl("button", { cls: "vault-search-result" });
      const header = item.createDiv({ cls: "vault-search-result-header" });
      header.createSpan({
        cls: "vault-search-result-file",
        text: result.file_path.split("/").pop()?.replace(/\.md$/i, "") || result.file_path
      });
      const badges = header.createSpan({ cls: "vault-search-result-badges" });
      for (const channel of result.channels ?? []) {
        badges.createSpan({ cls: "vault-search-channel", text: channel });
      }
      const heading = result.heading_path?.filter(Boolean).join(" \u203A ");
      if (heading) item.createDiv({ cls: "vault-search-result-heading", text: heading });
      item.createDiv({ cls: "vault-search-result-snippet", text: result.content.replace(/\s+/g, " ").trim() });
      item.addEventListener("click", () => void this.openResult(location));
    }
  }
};

// src/search-modal.ts
var VaultSearchModal = class extends import_obsidian2.Modal {
  constructor(owner, initialQuery = "") {
    super(owner.app);
    this.owner = owner;
    this.initialQuery = initialQuery;
  }
  inputEl;
  statusEl;
  resultsEl;
  resultView;
  session;
  onOpen() {
    this.modalEl.addClass("vault-search-modal");
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Vault Search" });
    this.inputEl = this.contentEl.createEl("input", {
      cls: "vault-search-input",
      attr: { type: "search", placeholder: "\uBCFC\uD2B8 \uAC80\uC0C9", "aria-label": "Vault Search query" }
    });
    this.statusEl = this.contentEl.createDiv({ cls: "vault-search-modal-status" });
    this.resultsEl = this.contentEl.createDiv({ cls: "vault-search-results" });
    this.resultView = new SearchResultView(
      this.resultsEl,
      (location) => this.owner.openSearchResult(location)
    );
    this.session = new SearchSession((query) => this.search(query), (state) => this.renderState(state));
    this.inputEl.addEventListener("input", () => this.session.setQuery(this.inputEl.value));
    this.inputEl.value = this.initialQuery;
    this.renderBackendStatus(this.owner.backend.status);
    this.session.setQuery(this.initialQuery);
    this.inputEl.focus();
    this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
  }
  onClose() {
    this.session?.dispose();
    this.contentEl.empty();
    this.owner.searchModalClosed(this);
  }
  updateBackendStatus(status) {
    if (this.statusEl) this.renderBackendStatus(status);
  }
  async search(query) {
    await this.owner.ensureSearchStarted();
    try {
      return await this.runSearch(query);
    } catch (error) {
      if (error instanceof BackendCallError && error.code === "MODEL_LOADING") {
        await this.owner.ensureSearchStarted();
        return await this.runSearch(query);
      }
      throw error;
    }
  }
  async runSearch(query) {
    const response = await this.owner.backend.call(
      "search",
      { query, verbose: true },
      3e4
    );
    return response.results;
  }
  renderState(state) {
    if (state.kind === "idle") {
      this.resultsEl.empty();
      return;
    }
    if (state.kind === "loading") {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: "vault-search-empty", text: "\uAC80\uC0C9 \uC911\u2026" });
      return;
    }
    if (state.kind === "results") {
      this.resultView.render(state.results);
      return;
    }
    this.resultsEl.empty();
    const unavailable = this.resultsEl.createDiv({ cls: "vault-search-unavailable" });
    unavailable.createDiv({ text: `\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${state.message}` });
    const button = unavailable.createEl("button", { text: "\uC124\uC815 \uC5F4\uAE30" });
    button.addEventListener("click", () => this.owner.openSearchSettings());
  }
  renderBackendStatus(status) {
    this.statusEl.removeClass("vault-search-error");
    if (status.state === "idle") {
      this.statusEl.setText("\uBAA8\uB378 \uB300\uAE30 \uC911 \xB7 \uAC80\uC0C9 \uC2DC \uBAA8\uB378\uC744 \uB85C\uB4DC\uD569\uB2C8\uB2E4.");
    } else if (status.state === "loading_model" || status.state === "starting") {
      this.statusEl.setText("\uAC80\uC0C9 \uBAA8\uB378\uC744 \uB85C\uB4DC\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4\u2026");
    } else if (status.state === "error") {
      this.statusEl.setText(status.error || "\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      this.statusEl.addClass("vault-search-error");
    } else if (status.state === "stopped") {
      this.statusEl.setText("\uAC80\uC0C9 \uC11C\uBE44\uC2A4\uAC00 \uC911\uC9C0\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    } else {
      this.statusEl.setText("");
    }
  }
};

// src/runtime-install-modal.ts
var import_obsidian3 = require("obsidian");
var RuntimeInstallModal = class extends import_obsidian3.Modal {
  constructor(app, explicitCuda, resolveChoice) {
    super(app);
    this.explicitCuda = explicitCuda;
    this.resolveChoice = resolveChoice;
  }
  settled = false;
  onOpen() {
    this.titleEl.setText("CUDA \uAC80\uC0C9 \uB7F0\uD0C0\uC784 \uC124\uCE58");
    this.contentEl.createEl("p", { text: "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA\uC6A9 PyTorch \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." });
    this.contentEl.createEl("p", { text: "\uCD5C\uCD08 \uC124\uCE58\uB294 \uC218 GB\uB97C \uB2E4\uC6B4\uB85C\uB4DC\uD558\uBBC0\uB85C \uB124\uD2B8\uC6CC\uD06C\uC640 PC \uC131\uB2A5\uC5D0 \uB530\uB77C \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC124\uCE58 \uD6C4 \uBCA1\uD130 \uC778\uB371\uC2A4\uB97C \uB2E4\uC2DC \uAD6C\uCD95\uD569\uB2C8\uB2E4." });
    if (this.explicitCuda) this.contentEl.createEl("p", { text: "CUDA\uB97C \uBA85\uC2DC\uC801\uC73C\uB85C \uC120\uD0DD\uD588\uC73C\uBBC0\uB85C \uC124\uCE58\uD558\uC9C0 \uC54A\uC73C\uBA74 \uC124\uC815\uC744 \uC801\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
    new import_obsidian3.Setting(this.contentEl).addButton((button) => button.setButtonText("\uB098\uC911\uC5D0").onClick(() => this.finish(false))).addButton((button) => button.setButtonText("\uC124\uCE58").setCta().onClick(() => this.finish(true)));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolveChoice(false);
    }
  }
  finish(install) {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.resolveChoice(install);
  }
};
function confirmRuntimeInstall(app, explicitCuda) {
  return new Promise((resolve2) => new RuntimeInstallModal(app, explicitCuda, resolve2).open());
}

// src/runtime-selection.ts
function selectRuntime(device, current, cpu, cuda, hasNvidiaGpu) {
  if (device === "cpu") {
    const selected2 = cpu || current;
    return selected2 ? { kind: "selected", runtime: selected2 } : { kind: "error", message: "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  if (current?.cudaAvailable) return { kind: "selected", runtime: current };
  if (cuda?.cudaAvailable) return { kind: "selected", runtime: cuda };
  if (!hasNvidiaGpu) {
    if (device === "cuda") {
      return { kind: "error", message: "NVIDIA GPU \uB610\uB294 \uB4DC\uB77C\uC774\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
    }
    const selected2 = cpu || current;
    return selected2 ? { kind: "selected", runtime: selected2 } : { kind: "error", message: "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." };
  }
  if (device === "cuda") return { kind: "install-cuda" };
  const selected = cpu || current;
  return selected ? {
    kind: "cpu-fallback",
    runtime: selected,
    warning: "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC9C0 \uC54A\uC544 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4."
  } : { kind: "install-cuda" };
}

// src/main.ts
var VaultSearchPlugin = class extends import_obsidian4.Plugin {
  draftSettings;
  backend;
  queue;
  settingTab;
  startupPrepared = false;
  startupInProgress = false;
  searchModal = null;
  runtimeChangePromise = null;
  runtimeSummary = "\uB7F0\uD0C0\uC784: \uD655\uC778 \uC804";
  runtimeWarning = null;
  async onload() {
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian4.FileSystemAdapter)) {
      new import_obsidian4.Notice("Vault Search Service\uB294 \uB370\uC2A4\uD06C\uD1B1 \uD30C\uC77C\uC2DC\uC2A4\uD15C \uBCFC\uD2B8\uB9CC \uC9C0\uC6D0\uD569\uB2C8\uB2E4.");
      return;
    }
    const vaultPath = adapter.getBasePath();
    const pluginDir = path3.join(vaultPath, this.app.vault.configDir, "plugins", this.manifest.id);
    this.backend = new BackendManager(
      vaultPath,
      pluginDir,
      () => this.settings,
      (status) => this.handleStatus(status)
    );
    const machinePython = await this.backend.readMachinePython();
    if (machinePython) this.settings.pythonExecutable = machinePython;
    else await this.backend.writeMachinePython(this.settings.pythonExecutable);
    this.draftSettings = cloneSettings(this.settings);
    this.queue = new VaultEventQueue(
      () => this.settings.syncDebounceMs,
      async (changed, deleted) => {
        if (!this.settings.autoSync) return true;
        if (!this.isReady()) return false;
        await this.backend.call("sync_paths", { changed, deleted }, 12e4);
        return true;
      }
    );
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian4.TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian4.TFile) this.queue.markChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof import_obsidian4.TFile) this.queue.markDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian4.TFile) {
        this.queue.markDeleted(oldPath);
        this.queue.markChanged(file.path);
      }
    }));
    this.settingTab = new VaultSearchSettingTab(this);
    this.addSettingTab(this.settingTab);
    this.registerCommands();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.loadPolicy === "vault-open") {
        void this.startBackend().catch((error) => new import_obsidian4.Notice(`Vault Search \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`, 1e4));
      } else if (this.settings.loadPolicy === "first-search") {
        void this.startLazyBackend().catch((error) => new import_obsidian4.Notice(`Vault Search \uB300\uAE30 \uC11C\uBE44\uC2A4 \uC2DC\uC791 \uC2E4\uD328: ${this.errorMessage(error)}`, 1e4));
      }
    });
  }
  onunload() {
    this.queue?.clear();
    if (this.backend) void this.backend.stop();
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...loaded || {} };
    this.settings.includeGlobs = loaded?.includeGlobs || [...DEFAULT_SETTINGS.includeGlobs];
    this.settings.excludeGlobs = loaded?.excludeGlobs || [...DEFAULT_SETTINGS.excludeGlobs];
    if (loaded?.loadPolicy === void 0) {
      this.settings.loadPolicy = defaultLoadPolicy(this.settings.engine);
    }
    this.draftSettings = cloneSettings(this.settings);
  }
  async saveSettings() {
    const { pythonExecutable, ...portable } = this.settings;
    await this.saveData(portable);
    if (this.backend) await this.backend.writeMachinePython(pythonExecutable);
  }
  resetDraftSettings() {
    this.draftSettings = cloneSettings(this.settings);
    this.settingTab?.display();
  }
  async applyDraftSettings() {
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.applyDraftSettingsInternal();
    try {
      await this.runtimeChangePromise;
    } finally {
      this.runtimeChangePromise = null;
    }
  }
  async applyDraftSettingsInternal() {
    const previous = cloneSettings(this.settings);
    const next = cloneSettings(this.draftSettings);
    const impact = settingsImpact(previous, next);
    if (impact === "none") return;
    if (previous.device !== next.device || previous.engine !== next.engine || previous.pythonExecutable !== next.pythonExecutable) {
      await this.prepareRuntime(next, true);
    }
    const previousWasRunning = this.backend.status.state !== "stopped";
    try {
      if (impact === "all" || impact === "vectors" || impact === "restart") {
        await this.backend.stop();
        this.settings = next;
        await this.saveSettings();
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        if (impact === "all") await this.backend.call("rebuild_all", {}, 36e5);
        if (impact === "vectors") await this.backend.call("rebuild_vectors", {}, 36e5);
        if (!previousWasRunning && this.settings.loadPolicy === "manual") await this.backend.stop();
      } else {
        this.settings = next;
        await this.saveSettings();
        if (this.isReady()) {
          await this.backend.call("apply_search_config", hotConfig(next));
          if (impact === "scope") await this.backend.call("reconcile", { mode: "fast" }, 6e5);
        }
      }
      this.draftSettings = cloneSettings(this.settings);
      new import_obsidian4.Notice(impact === "all" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uC804\uCCB4 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : impact === "vectors" ? "\uC124\uC815\uC744 \uC801\uC6A9\uD558\uACE0 \uBCA1\uD130 \uC778\uB371\uC2A4\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4." : "Vault Search \uC124\uC815\uC744 \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4.");
    } catch (error) {
      await this.backend.stop().catch(() => void 0);
      this.settings = previous;
      this.draftSettings = cloneSettings(previous);
      await this.saveSettings();
      if (previousWasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    } finally {
      this.settingTab?.display();
    }
  }
  async startBackend() {
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(false);
    await this.backend.waitUntilReady();
    await this.completeStartup();
    this.settingTab?.display();
  }
  async installCudaRuntime() {
    if (this.runtimeChangePromise) return this.runtimeChangePromise;
    this.runtimeChangePromise = this.installCudaRuntimeInternal();
    try {
      await this.runtimeChangePromise;
    } finally {
      this.runtimeChangePromise = null;
    }
  }
  async installCudaRuntimeInternal() {
    if (!await this.backend.hasNvidiaGpu()) {
      throw new Error("NVIDIA GPU \uB610\uB294 \uB4DC\uB77C\uC774\uBC84\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
    if (!await confirmRuntimeInstall(this.app, true)) return;
    const current = await this.backend.inspectPython(this.settings.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    new import_obsidian4.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", 1e4);
    const installed = await this.backend.installManagedRuntime(
      "cuda",
      basePython,
      (text) => {
        if (text) this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
      }
    );
    this.runtimeSummary = `\uB7F0\uD0C0\uC784: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`;
    this.runtimeWarning = null;
    if (this.settings.device === "cpu") {
      const active = current || cpu;
      this.runtimeSummary = active ? `\uB7F0\uD0C0\uC784: CPU / PyTorch ${active.torchVersion} (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)` : "\uB7F0\uD0C0\uC784: CPU (CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uB428)";
      new import_obsidian4.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC CPU \uBA85\uC2DC \uC124\uC815\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4.", 1e4);
      this.settingTab?.display();
      return;
    }
    const previous = cloneSettings(this.settings);
    const previousDraft = cloneSettings(this.draftSettings);
    const wasRunning = this.backend.status.state !== "stopped";
    try {
      if (wasRunning) await this.backend.stop();
      this.settings.pythonExecutable = installed.pythonExecutable;
      this.draftSettings.pythonExecutable = installed.pythonExecutable;
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
        await this.backend.call("rebuild_vectors", {}, 36e5);
      }
      await this.saveSettings();
    } catch (error) {
      await this.backend.stop().catch(() => void 0);
      this.settings = previous;
      this.draftSettings = previousDraft;
      await this.saveSettings();
      if (wasRunning) {
        await this.backend.start(false);
        await this.backend.waitUntilReady();
      }
      throw error;
    }
    new import_obsidian4.Notice("CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uC640 \uC801\uC6A9\uC744 \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.", 1e4);
    this.settingTab?.display();
  }
  async startLazyBackend() {
    await this.prepareRuntime(this.settings, false);
    await this.backend.start(true);
    await this.backend.waitUntilAvailable();
    this.settingTab?.display();
  }
  async ensureSearchStarted() {
    if (this.backend.status.state === "stopped" || this.backend.status.state === "error") {
      await this.prepareRuntime(this.settings, false);
    }
    await this.backend.ensureStarted();
  }
  async provisionOnnx() {
    if (this.backend.status.state === "stopped") {
      await this.prepareRuntime(this.settings, false);
      await this.backend.start(false);
      try {
        await this.backend.waitUntilAvailable();
      } catch {
      }
    }
    const result = await this.backend.call(
      "provision_onnx",
      {},
      6e5
    );
    if (!result.provisioned) throw new Error("ONNX \uD30C\uC0DD \uBAA8\uB378 \uC0DD\uC131 \uC2E4\uD328");
    new import_obsidian4.Notice("ONNX \uD30C\uC0DD \uBAA8\uB378\uC744 \uC0DD\uC131\uD588\uC2B5\uB2C8\uB2E4. \uC11C\uBE44\uC2A4\uB97C \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4.", 8e3);
    await this.restartBackend();
  }
  async stopBackend() {
    this.startupPrepared = false;
    await this.backend.stop();
    this.settingTab?.display();
  }
  async restartBackend() {
    this.startupPrepared = false;
    await this.prepareRuntime(this.settings, false);
    await this.backend.restart();
    await this.completeStartup();
    this.settingTab?.display();
    new import_obsidian4.Notice("Vault Search Service\uB97C \uC7AC\uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async previewScope() {
    await this.ensureSearchStarted();
    return this.backend.call("preview_scope", {}, 12e4);
  }
  async reconcile(mode = "strict") {
    await this.ensureSearchStarted();
    const result = await this.backend.call("reconcile", { mode }, 6e5);
    new import_obsidian4.Notice(result.rebuild_required ? `\uC7AC\uAD6C\uCD95 \uD544\uC694: ${result.reason}` : "\uC778\uB371\uC2A4 \uC99D\uBD84 \uB300\uC870\uB97C \uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4.", 8e3);
    this.settingTab?.display();
  }
  async rebuildAll() {
    await this.ensureSearchStarted();
    new import_obsidian4.Notice("\uC804\uCCB4 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4. \uBC31\uADF8\uB77C\uC6B4\uB4DC\uC5D0\uC11C \uC9C4\uD589\uB429\uB2C8\uB2E4.");
    const result = await this.backend.call("rebuild_all", {}, 36e5);
    new import_obsidian4.Notice(`\uC804\uCCB4 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uD30C\uC77C ${result.files}\uAC1C, \uCCAD\uD06C ${result.chunks}\uAC1C`, 1e4);
    this.settingTab?.display();
  }
  async rebuildVectors() {
    await this.ensureSearchStarted();
    new import_obsidian4.Notice("\uBCA1\uD130 \uC778\uB371\uC2A4 \uC7AC\uAD6C\uCD95\uC744 \uC2DC\uC791\uD569\uB2C8\uB2E4.");
    const result = await this.backend.call("rebuild_vectors", {}, 36e5);
    new import_obsidian4.Notice(`\uBCA1\uD130 \uC7AC\uAD6C\uCD95 \uC644\uB8CC: \uCCAD\uD06C ${result.chunks}\uAC1C`, 1e4);
    this.settingTab?.display();
  }
  registerCommands() {
    this.addCommand({ id: "open-search", name: "Open search", callback: () => this.openSearch() });
    this.addCommand({
      id: "search-selected-text",
      name: "Search selected text",
      editorCallback: (editor) => this.openSearch(selectedTextQuery(editor))
    });
    this.addCommand({ id: "start-service", name: "Start search service", callback: () => void this.startBackend() });
    this.addCommand({ id: "stop-service", name: "Stop search service", callback: () => void this.stopBackend() });
    this.addCommand({ id: "restart-service", name: "Restart search service", callback: () => void this.restartBackend() });
    this.addCommand({ id: "reconcile-index", name: "Reconcile search index", callback: () => void this.reconcile() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild complete search index", callback: () => void this.rebuildAll() });
    this.addCommand({ id: "rebuild-vectors", name: "Rebuild vector index", callback: () => void this.rebuildVectors() });
  }
  async prepareRuntime(target, interactive) {
    const current = await this.backend.inspectPython(target.pythonExecutable);
    const cpu = await this.backend.managedRuntime("cpu");
    const cuda = await this.backend.managedRuntime("cuda");
    const choose = (python, summary) => {
      target.pythonExecutable = python;
      this.runtimeSummary = summary;
      this.runtimeWarning = null;
    };
    const hasGpu = await this.backend.hasNvidiaGpu();
    const selection = selectRuntime(target.device, current, cpu, cuda, hasGpu);
    if (selection.kind === "error") throw new Error(selection.message);
    if (selection.kind === "selected") {
      const selected = selection.runtime;
      choose(selected.pythonExecutable, selected.cudaAvailable ? `\uB7F0\uD0C0\uC784: CUDA ${selected.cudaBuild || ""} / ${selected.deviceName || "GPU"}` : `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`);
      return;
    }
    if (selection.kind === "cpu-fallback" && !interactive) {
      target.pythonExecutable = selection.runtime.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selection.runtime.torchVersion}`;
      this.runtimeWarning = selection.warning;
      return;
    }
    const install = interactive && await confirmRuntimeInstall(this.app, target.device === "cuda");
    if (!install) {
      if (target.device === "cuda") throw new Error(interactive ? "CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58\uAC00 \uCDE8\uC18C\uB418\uC5B4 \uC124\uC815\uC744 \uC801\uC6A9\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." : "CUDA \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C CUDA \uB7F0\uD0C0\uC784\uC744 \uBA3C\uC800 \uC124\uCE58\uD574 \uC8FC\uC138\uC694.");
      const selected = selection.kind === "cpu-fallback" ? selection.runtime : cpu || current;
      if (!selected) throw new Error("\uC0AC\uC6A9 \uAC00\uB2A5\uD55C CPU \uAC80\uC0C9 \uB7F0\uD0C0\uC784\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = "NVIDIA GPU\uAC00 \uAC10\uC9C0\uB410\uC9C0\uB9CC CUDA \uB7F0\uD0C0\uC784\uC774 \uC124\uCE58\uB418\uC9C0 \uC54A\uC544 CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.";
      return;
    }
    const basePython = current?.baseExecutable || cpu?.baseExecutable || "python";
    try {
      new import_obsidian4.Notice("CUDA \uB7F0\uD0C0\uC784\uC744 \uC124\uCE58\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC218 \uBD84 \uC774\uC0C1 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", 1e4);
      const installed = await this.backend.installManagedRuntime(
        "cuda",
        basePython,
        (text) => {
          if (text) this.runtimeSummary = `CUDA \uC124\uCE58 \uC911: ${text.split(/\r?\n/).at(-1)}`;
        }
      );
      choose(
        installed.pythonExecutable,
        `\uB7F0\uD0C0\uC784: CUDA ${installed.cudaBuild || ""} / ${installed.deviceName || "GPU"}`
      );
    } catch (error) {
      if (target.device === "cuda") throw error;
      const selected = cpu || current;
      if (!selected) throw error;
      target.pythonExecutable = selected.pythonExecutable;
      this.runtimeSummary = `\uB7F0\uD0C0\uC784: CPU / PyTorch ${selected.torchVersion}`;
      this.runtimeWarning = `CUDA \uB7F0\uD0C0\uC784 \uC124\uCE58 \uC2E4\uD328\uB85C CPU\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4: ${this.errorMessage(error)}`;
    }
  }
  handleStatus(status) {
    this.settingTab?.display();
    this.searchModal?.updateBackendStatus(status);
    if (status.state === "ready" || status.state === "ready_no_index") {
      if (this.startupPrepared) void this.queue?.flush();
      else void this.completeStartup();
    }
  }
  async completeStartup() {
    if (this.startupPrepared || this.startupInProgress || !this.isReady()) return;
    this.startupInProgress = true;
    try {
      this.queue?.clear();
      if (this.settings.startupReconcile) {
        const result = await this.backend.call(
          "reconcile",
          { mode: "fast" },
          6e5
        );
        if (result.rebuild_required) {
          new import_obsidian4.Notice("Vault Search \uC778\uB371\uC2A4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C \uC804\uCCB4 \uC7AC\uAD6C\uCD95\uC744 \uC2E4\uD589\uD558\uC138\uC694.", 8e3);
        }
      }
      this.startupPrepared = true;
    } finally {
      this.startupInProgress = false;
    }
    await this.queue?.flush();
  }
  isReady() {
    const state = this.backend.status.state;
    return state === "ready" || state === "ready_no_index";
  }
  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  openSearch(initialQuery = "") {
    this.searchModal?.close();
    this.searchModal = new VaultSearchModal(this, initialQuery);
    this.searchModal.open();
  }
  async openSearchResult(location) {
    const file = this.app.vault.getAbstractFileByPath(location.path);
    if (!(file instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice(`\uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${location.path}`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, {
      active: true,
      eState: { line: location.line - 1 }
    });
    this.searchModal?.close();
  }
  openSearchSettings() {
    const setting = this.app.setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }
  searchModalClosed(modal) {
    if (this.searchModal === modal) this.searchModal = null;
  }
};
