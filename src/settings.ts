import type { VaultSearchSettings } from "./types";

export type SettingsImpact = "none" | "hot" | "scope" | "restart" | "vectors" | "all";

const ALL_KEYS: (keyof VaultSearchSettings)[] = [
  "chunkChars", "chunkOverlap", "chunkingStrategy"
];
const VECTOR_KEYS: (keyof VaultSearchSettings)[] = [
  "modelProfile", "modelId", "device", "engine", "queryPrefix", "documentPrefix", "normalizeEmbeddings"
];
const SCOPE_KEYS: (keyof VaultSearchSettings)[] = ["includeGlobs", "excludeGlobs"];
const RESTART_KEYS: (keyof VaultSearchSettings)[] = ["pythonExecutable", "modelIdleTimeoutSeconds"];
const HOT_KEYS: (keyof VaultSearchSettings)[] = [
  "bm25TopK", "vectorTopK", "finalTopK", "rrfK",
  "maxChunksPerFile", "titleRrfWeight", "prefixFallback"
];

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function settingsImpact(current: VaultSearchSettings, next: VaultSearchSettings): SettingsImpact {
  if (ALL_KEYS.some(key => !equal(current[key], next[key]))) return "all";
  const providerChangedForOnnx = (current.engine === "onnx" || next.engine === "onnx")
    && !equal(current.provider, next.provider);
  if (VECTOR_KEYS.some(key => !equal(current[key], next[key])) || providerChangedForOnnx) return "vectors";
  if (RESTART_KEYS.some(key => !equal(current[key], next[key]))) return "restart";
  if (SCOPE_KEYS.some(key => !equal(current[key], next[key]))) return "scope";
  if (HOT_KEYS.some(key => !equal(current[key], next[key]))) return "hot";
  return equal(current, next) ? "none" : "hot";
}

export function cloneSettings(settings: VaultSearchSettings): VaultSearchSettings {
  return {
    ...settings,
    includeGlobs: [...settings.includeGlobs],
    excludeGlobs: [...settings.excludeGlobs],
  };
}

export function hotConfig(settings: VaultSearchSettings): Record<string, unknown> {
  return {
    bm25TopK: settings.bm25TopK,
    vectorTopK: settings.vectorTopK,
    finalTopK: settings.finalTopK,
    rrfK: settings.rrfK,
    maxChunksPerFile: settings.maxChunksPerFile,
    titleRrfWeight: settings.titleRrfWeight,
    prefixFallback: settings.prefixFallback,
    includeGlobs: settings.includeGlobs,
    excludeGlobs: settings.excludeGlobs,
  };
}
