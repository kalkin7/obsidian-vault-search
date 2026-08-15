import type {
  EnginePreference,
  LoadPolicy,
  VaultSearchSettings,
} from "./types";

export type SettingsImpact =
  | "none"
  | "hot"
  | "scope"
  | "restart"
  | "vectors"
  | "all";

const ALL_KEYS: (keyof VaultSearchSettings)[] = [
  "chunkChars",
  "chunkOverlap",
  "chunkingStrategy",
];
const VECTOR_KEYS: (keyof VaultSearchSettings)[] = [
  "modelProfile",
  "modelId",
  "device",
  "engine",
  "queryPrefix",
  "documentPrefix",
  "normalizeEmbeddings",
];
const SCOPE_KEYS: (keyof VaultSearchSettings)[] = [
  "includeGlobs",
  "excludeGlobs",
];
const RESTART_KEYS: (keyof VaultSearchSettings)[] = [
  "pythonExecutable",
  "modelIdleTimeoutSeconds",
];
const HOT_KEYS: (keyof VaultSearchSettings)[] = [
  "bm25TopK",
  "vectorTopK",
  "finalTopK",
  "rrfK",
  "maxChunksPerFile",
  "titleRrfWeight",
  "prefixFallback",
  "wikiFolders",
];

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Engine-aware load policy default. ONNX starts fast (~1.5 s CPU) so it
 * defaults to loading on first search; PyTorch cold start is slow (~9 s), so
 * it defaults to preloading at vault open. Explicit choices are respected. */
export function defaultLoadPolicy(engine: EnginePreference): LoadPolicy {
  return engine === "onnx" ? "first-search" : "vault-open";
}

export function settingsImpact(
  current: VaultSearchSettings,
  next: VaultSearchSettings,
): SettingsImpact {
  if (ALL_KEYS.some((key) => !equal(current[key], next[key]))) return "all";
  const providerChangedForOnnx =
    (current.engine === "onnx" || next.engine === "onnx") &&
    !equal(current.provider, next.provider);
  if (
    VECTOR_KEYS.some((key) => !equal(current[key], next[key])) ||
    providerChangedForOnnx
  )
    return "vectors";
  if (RESTART_KEYS.some((key) => !equal(current[key], next[key])))
    return "restart";
  if (SCOPE_KEYS.some((key) => !equal(current[key], next[key]))) return "scope";
  if (HOT_KEYS.some((key) => !equal(current[key], next[key]))) return "hot";
  return equal(current, next) ? "none" : "hot";
}

export function cloneSettings(
  settings: VaultSearchSettings,
): VaultSearchSettings {
  return {
    ...settings,
    includeGlobs: [...settings.includeGlobs],
    excludeGlobs: [...settings.excludeGlobs],
    wikiFolders: [...settings.wikiFolders],
  };
}

export function hotConfig(
  settings: VaultSearchSettings,
): Record<string, unknown> {
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
    wikiFolders: settings.wikiFolders,
  };
}

/** Latest settings layout version. Bump when legacy defaults need to migrate. */
export const SETTINGS_VERSION = 1;
const LEGACY_DEFAULT_TOP = { bm25TopK: 30, vectorTopK: 30, finalTopK: 20 };

/** Migrate untouched legacy defaults to the benchmarked defaults.
 *
 * Only exact legacy defaults are migrated so users who customized any of the
 * three candidate-width values keep their choices. Missing settingsVersion is
 * treated as pre-migration; after migration the version is stamped so future
 * default changes do not keep rewriting user settings. Returns true when a
 * change was applied so the caller can persist it once. */
export function migrateSettings(settings: VaultSearchSettings): boolean {
  if ((settings.settingsVersion ?? 0) >= SETTINGS_VERSION) return false;
  const top = {
    bm25TopK: settings.bm25TopK,
    vectorTopK: settings.vectorTopK,
    finalTopK: settings.finalTopK,
  };
  const untouched =
    top.bm25TopK === LEGACY_DEFAULT_TOP.bm25TopK &&
    top.vectorTopK === LEGACY_DEFAULT_TOP.vectorTopK &&
    top.finalTopK === LEGACY_DEFAULT_TOP.finalTopK;
  if (untouched) {
    settings.bm25TopK = 80;
    settings.vectorTopK = 80;
    settings.finalTopK = 40;
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return true;
}
