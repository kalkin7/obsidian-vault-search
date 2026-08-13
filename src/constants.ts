import type { VaultSearchSettings } from "./types";

export const PLUGIN_ID = "obsidian-vault-search";
export const PROTOCOL_VERSION = 1;
export const BACKEND_VERSION = "0.1.2";
export const GITHUB_REPO = "kalkin7/obsidian-vault-search";

export const MODEL_PROFILES: Record<string, {
  name: string;
  modelId: string;
  queryPrefix: string;
  documentPrefix: string;
  note: string;
}> = {
  "multilingual-e5-base": {
    name: "Multilingual E5 Base (권장, 저자원)",
    modelId: "intfloat/multilingual-e5-base",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "현재 K_Notes 기본 모델. 약 1.2GB 메모리, CPU 검색이 빠릅니다."
  },
  "bge-m3": {
    name: "BGE-M3 (고성능, 고자원)",
    modelId: "BAAI/bge-m3",
    queryPrefix: "",
    documentPrefix: "",
    note: "약 2.3GB 메모리. 모델 변경 후 벡터 재구축이 필요합니다."
  },
  "koe5": {
    name: "KoE5 (한국어 특화, 고자원)",
    modelId: "nlpai-lab/KoE5",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "한국어 특화 모델. 약 2.3GB 메모리입니다."
  },
  "custom": {
    name: "사용자 지정 Sentence Transformers 모델",
    modelId: "",
    queryPrefix: "",
    documentPrefix: "",
    note: "Hugging Face 모델 ID와 접두어를 직접 지정합니다."
  }
};

export const DEFAULT_SETTINGS: VaultSearchSettings = {
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
