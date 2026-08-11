export type LoadPolicy = "vault-open" | "first-search" | "manual";
export type DevicePreference = "auto" | "cpu" | "cuda";
export type BackendState =
  | "stopped" | "starting" | "idle" | "loading_model" | "ready" | "ready_no_index"
  | "syncing" | "reconciling" | "rebuilding" | "rebuilding_vectors" | "error";

export interface VaultSearchSettings {
  loadPolicy: LoadPolicy;
  pythonExecutable: string;
  modelProfile: string;
  modelId: string;
  device: DevicePreference;
  queryPrefix: string;
  documentPrefix: string;
  normalizeEmbeddings: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  chunkChars: number;
  chunkOverlap: number;
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
  model_load_seconds?: number;
  progress?: string;
}

export interface RuntimeInfo {
  protocol_version: number;
  host: string;
  port: number;
  token: string;
  pid: number;
  state: string;
  model_id: string;
}

export interface BackendResponse<T = unknown> {
  protocol_version: number;
  request_id: string;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}
