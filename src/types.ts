export type LoadPolicy = "vault-open" | "first-search" | "manual";
export type DevicePreference = "auto" | "cpu" | "cuda";
export type EnginePreference = "pytorch" | "onnx";
export type ProviderPreference = "auto" | "cuda" | "tensorrt";
export type ChunkingStrategy = "paragraph-v1" | "markdown-v2";
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
  settingsVersion?: number;
}

export interface BackendStatus {
  state: BackendState;
  error?: string | null;
  pid?: number;
  port?: number;
  model_id?: string;
  device?: string;
  dimension?: number | null;
  files?: number;
  chunks?: number;
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
