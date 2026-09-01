export type LoadPolicy = "vault-open" | "first-search" | "manual";
export type DevicePreference = "auto" | "cpu" | "cuda";
export type EnginePreference = "pytorch" | "onnx";
export type ProviderPreference = "auto" | "cuda" | "tensorrt";
export type LLMProviderId = "openai" | "opencode-go" | "deepseek";
/** Reasoning-effort levels for reasoning models; "auto" sends nothing and
 *  lets the provider pick its default. Not every model accepts every level
 *  (see reasoningEffortLevels); the backend maps per provider. */
export type ReasoningEffort =
  | "auto"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
/** A model starred in the settings list; provider is stored so the footer
 *  selector can switch provider when a cross-provider favorite is picked. */
export type FavoriteAnswerModel = {
  provider: LLMProviderId;
  model: string;
};
export type ChunkingStrategy = "paragraph-v1" | "markdown-v2";
export type McpToolPolicy = "deny" | "ask" | "allow";

/** A registered local stdio MCP server. Env VALUES live only in Obsidian
 *  secret storage — data.json carries the names exclusively. */
export interface McpServerSettings {
  id: string;
  name: string;
  enabled: boolean;
  /** "stdio": local child process; "http": remote streamable-HTTP server. */
  transport: "stdio" | "http";
  command: string;
  args: string[];
  /** "vault" | "plugin" | absolute directory chosen explicitly by the user. */
  cwd: string;
  /** Safe origin (scheme://host[:port]) for http servers (full URLs live in secret storage). */
  url: string;
  envNames: string[];
  toolPolicies: Record<string, McpToolPolicy>;
}

export interface SkillRootSettings {
  id: string;
  /** Vault-relative preferred; explicit absolute paths are opt-in. */
  path: string;
  enabled: boolean;
}

export type BackendState =
  | "stopped"
  | "starting"
  | "idle"
  | "loading_model"
  | "ready"
  | "ready_no_index"
  | "syncing"
  | "reconciling"
  | "rebuilding"
  | "rebuilding_vectors"
  | "error";

export interface VaultSearchSettings {
  loadPolicy: LoadPolicy;
  pythonExecutable: string;
  modelProfile: string;
  modelId: string;
  engine: EnginePreference;
  provider: ProviderPreference;
  device: DevicePreference;
  queryPrefix: string;
  documentPrefix: string;
  normalizeEmbeddings: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  wikiFolders: string[];
  chunkChars: number;
  chunkOverlap: number;
  chunkingStrategy: ChunkingStrategy;
  bm25TopK: number;
  vectorTopK: number;
  finalTopK: number;
  rrfK: number;
  maxChunksPerFile: number;
  titleRrfWeight: number;
  prefixFallback: boolean;
  syncDebounceMs: number;
  autoSync: boolean;
  startupReconcile: boolean;
  modelIdleTimeoutSeconds: number;
  answerProvider: LLMProviderId;
  answerModel: string;
  answerReasoningEffort: ReasoningEffort;
  /** Models starred in the settings model list, per provider. Offered in the
   *  AI search footer selector across ALL providers (selecting one switches
   *  the provider too). Falls back to fetched models when empty. */
  favoriteAnswerModels: FavoriteAnswerModel[];
  answerMaxContextChars: number;
  answerMaxOutputTokens: number;
  answerTimeoutSeconds: number;
  /** Vault-relative folder where AI search history notes are saved. */
  historyFolder: string;
  /** Autosave each completed answer into the history folder. */
  historyAutosave: boolean;
  /** Max history notes to keep; 0 = keep all. */
  historyMaxEntries: number;
  /** Last fetched model lists per provider, persisted so the settings model
   *  list and its stars survive restarts (refresh with "모델 최신화"). */
  fetchedProviderModels?: Partial<Record<LLMProviderId, string[]>>;
  // --- API agent extensions ---
  /** Project rules sent as a bounded system-instruction section. Snapshot
   *  semantics: imported AGENTS.md content is copied here verbatim. */
  answerProjectRules: string;
  /** Where the current rules text came from (custom textarea or import). */
  answerProjectRulesSource: "custom" | "agents-md";
  /** Metadata of the last AGENTS.md import (UI display only). */
  answerProjectRulesImportedAt?: string;
  answerProjectRulesHash?: string;
  mcpEnabled: boolean;
  mcpServers: McpServerSettings[];
  skillsEnabled: boolean;
  skillRoots: SkillRootSettings[];
  /** Canonical skill ids ("root-id:normalized-name") the user enabled. */
  enabledSkills: string[];
  /** Migration marker: true once legacy v0.1.59~0.1.63 HTTP URLs have been migrated to secretStorage. */
  mcpHttpUrlsMigrated?: boolean;
  settingsVersion?: number;
}

/** Install state of the plugin-side Python backend folder (version match
 *  against the plugin manifest). Drives the settings-tab status display. */
export interface BackendInstallState {
  installed: boolean;
  version: string | null;
  expected: string;
}

export interface BackendStatus {
  state: BackendState;
  error?: string | null;
  pid?: number;
  port?: number;
  model_id?: string;
  device?: string;
  /** Configured provider value (auto | cuda | tensorrt). */
  provider?: string;
  /** Provider the ONNX engine will run on (resolved pre-load), e.g.
   *  TensorrtExecutionProvider; null only for the PyTorch engine (a CPU
   *  device resolves to CPUExecutionProvider). */
  expected_provider?: string | null;
  /** Provider the loaded ONNX session was actually built with (the truth),
   *  or null while the model is not loaded. */
  effective_provider?: string | null;
  dimension?: number | null;
  files?: number;
  chunks?: number;
  /** Unix epoch seconds from index metadata `updated_at`. */
  last_updated_at?: number | null;
  count_available?: boolean;
  model_load_seconds?: number;
  progress?: string;
  pending_recovery_required?: boolean;
  pending_recovery_warning?: string | null;
  runtime_warning?: string | null;
  index_validation_state?: "pending" | "compatible" | "incompatible";
  index_rebuild_required?: boolean;
  index_problems?: string[];
  recommended_action?: "rebuild_vectors" | "rebuild_all" | null;
  capabilities?: {
    onnx_available?: boolean;
    cuda_available?: boolean;
    tensorrt_available?: boolean;
    model_available?: boolean;
    derived_model_available?: boolean;
  };
}

export interface PythonRuntimeInfo {
  pythonExecutable: string;
  baseExecutable: string;
  torchVersion: string;
  cudaBuild: string | null;
  cudaAvailable: boolean;
  deviceName: string | null;
}

export interface RuntimeInfo {
  runtime_schema?: number;
  protocol_version: number;
  backend_version?: string;
  vault_id?: string;
  vault_path?: string;
  host: string;
  port: number;
  token: string;
  pid: number;
  state: string;
  model_id: string;
  owner?: "plugin" | "standalone";
  parent_pid?: number;
  started_at?: string;
}

export interface BackendResponse<T = unknown> {
  protocol_version: number;
  request_id: string;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export interface SearchResult {
  rank: number;
  file_path: string;
  score: number;
  content: string;
  heading_path?: string[];
  start_line?: number;
  channels?: string[];
  expanded?: boolean;
  source?: "wiki_sources";
  linked_from?: string;
}

export interface Citation {
  id: string;
  file_path: string;
  start_line: number;
  heading_path: string[];
  rank: number;
  score: number;
}

export interface AnswerEvidence extends Citation {
  content: string;
}

export interface AnswerRequest {
  query: string;
  top_k?: number;
  max_context_chars?: number;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Agentic mode: the model iteratively searches / reads / greps the vault
   *  (CLI-agent quality) before answering. */
  deep?: boolean;
}

export interface AnswerResult {
  answer: string;
  citations: Citation[];
  evidence: AnswerEvidence[];
  provider: LLMProviderId;
  model: string;
  grounded: boolean;
  diagnostics: {
    retrieved_count: number;
    context_chars: number;
    answer_chars: number;
    citation_warning?: string;
    /** Agentic (deep) mode diagnostics. */
    deep?: boolean;
    turns?: number;
    tool_calls?: number;
  };
  /** Safe tool-usage metadata only — never raw arguments or results. */
  toolActivity?: ToolActivityEntry[];
  /** What actually grounded the answer: vault citations, external tools,
   *  both, or neither. `grounded` stays for backward compatibility. */
  groundingKind?: "vault" | "tool" | "mixed" | "none";
}

export interface ToolActivityEntry {
  toolName: string;
  serverName?: string;
  status: "success" | "error" | "rejected" | "cancelled";
  durationMs?: number;
  truncated?: boolean;
}

/** One MCP call awaiting user approval (plan §11.1). Arguments are shown in
 *  the UI but never persisted to history or logs. */
export interface PendingToolCall {
  call_id: string;
  tool_name: string;
  server_name: string;
  display_name: string;
  description?: string;
  arguments: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type AnswerStartResponse =
  | { status: "complete"; run_id?: string; result: AnswerResult }
  | {
      status: "approval_required";
      run_id: string;
      expires_at: string;
      calls: PendingToolCall[];
    };

export type ToolDecision = "allow_once" | "allow_session" | "reject";

/** Live MCP host state reported by `mcp_status` (plan §9.1). */
export interface McpServerStatus {
  id: string;
  name: string;
  state: "disabled" | "awaiting_secret" | "connecting" | "connected" | "error";
  message?: string | null;
  enabled: boolean;
  /** Additive since 0.1.59: "stdio" (default when absent) or "http". */
  transport?: "stdio" | "http";
  /** stdio: command; http: safe origin only (scheme://host[:port]). */
  endpoint?: string;
  /** True when a secret full URL is held in backend memory for this HTTP server. */
  has_url_secret?: boolean;
  command: string;
  tools: number;
  tool_names?: string[];
  env_names: string[];
  tool_policies: Record<string, McpToolPolicy>;
}

/** Deterministic tool-surface bounds measured by the backend (fix §6). */
export interface McpToolSurfaceStatus {
  discovered_tools: number;
  exposed_mcp_tools: number;
  tools_truncated: boolean;
  schema_bytes: number;
  schema_truncated: boolean;
}

export interface McpStatusResponse {
  enabled: boolean;
  servers: McpServerStatus[];
  connected: number;
  config_problems?: string[];
  tool_surface?: McpToolSurfaceStatus;
}

export interface SkillRootStatus {
  id: string;
  path: string;
  enabled: boolean;
  state: "ok" | "disabled" | "missing" | "error";
  message?: string | null;
  skills: number;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface SkillsStatusResponse {
  roots: SkillRootStatus[];
  skills: SkillCatalogEntry[];
  problems: string[];
  conflicts: string[];
  active_count: number;
  catalog_chars: number;
}

export type AnswerState =
  | { kind: "idle" }
  | { kind: "retrieving" }
  | { kind: "answering" }
  | { kind: "answer"; result: AnswerResult }
  | { kind: "tool-approval"; runId: string; calls: PendingToolCall[] }
  | { kind: "tool-running"; runId: string; calls: PendingToolCall[] }
  | {
      kind: "unavailable";
      message: string;
      code?: string;
      evidence?: AnswerEvidence[];
    };
