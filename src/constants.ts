import type { VaultSearchSettings } from "./types";

export const PLUGIN_ID = "obsidian-vault-search";
export const PROTOCOL_VERSION = 1;
export const VIEW_TYPE_VAULT_AI_SEARCH = "vault-ai-search";
export const LIGHTNING_ICON_ASSET = "lightning.search.png";
export const BACKEND_VERSION = "0.1.27";
export const GITHUB_REPO = "kalkin7/obsidian-vault-search";

export const MODEL_PROFILES: Record<
  string,
  {
    name: string;
    modelId: string;
    queryPrefix: string;
    documentPrefix: string;
    note: string;
  }
> = {
  "multilingual-e5-base": {
    name: "Multilingual E5 Base (권장, 저자원)",
    modelId: "intfloat/multilingual-e5-base",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "현재 K_Notes 기본 모델. 약 1.2GB 메모리, CPU 검색이 빠릅니다.",
  },
  "bge-m3": {
    name: "BGE-M3 (고성능, 고자원)",
    modelId: "BAAI/bge-m3",
    queryPrefix: "",
    documentPrefix: "",
    note: "약 2.3GB 메모리. 모델 변경 후 벡터 재구축이 필요합니다.",
  },
  koe5: {
    name: "KoE5 (한국어 특화, 고자원)",
    modelId: "nlpai-lab/KoE5",
    queryPrefix: "query: ",
    documentPrefix: "passage: ",
    note: "한국어 특화 모델. 약 2.3GB 메모리입니다.",
  },
  custom: {
    name: "사용자 지정 Sentence Transformers 모델",
    modelId: "",
    queryPrefix: "",
    documentPrefix: "",
    note: "Hugging Face 모델 ID와 접두어를 직접 지정합니다.",
  },
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
  excludeGlobs: [".obsidian/**", "**/node_modules/**"],
  wikiFolders: ["5_Wiki/issues", "5_Wiki/entities", "5_Wiki/decisions"],
  chunkChars: 400,
  chunkOverlap: 60,
  chunkingStrategy: "paragraph-v1",
  bm25TopK: 80,
  vectorTopK: 80,
  finalTopK: 40,
  rrfK: 60,
  maxChunksPerFile: 1,
  titleRrfWeight: 1,
  prefixFallback: true,
  syncDebounceMs: 1500,
  autoSync: true,
  startupReconcile: true,
  modelIdleTimeoutSeconds: 300,
  answerProvider: "openai",
  answerModel: "",
  favoriteAnswerModels: [],
  answerMaxContextChars: 24000,
  answerMaxOutputTokens: 1200,
  answerTimeoutSeconds: 60,
};

export const LLM_PROVIDER_DEFAULTS = {
  openai: {
    name: "OpenAI Responses API",
    model: "gpt-5.6",
    env: "OPENAI_API_KEY",
  },
  "opencode-go": {
    name: "OpenCode Go",
    model: "deepseek-v4-flash",
    env: "OPENCODE_GO_API_KEY",
  },
  deepseek: {
    name: "DeepSeek",
    model: "deepseek-v4-flash",
    env: "DEEPSEEK_API_KEY",
  },
} as const;

export const LLM_SECRET_IDS = {
  openai: "vault-search-openai-api-key",
  "opencode-go": "vault-search-opencode-go-api-key",
  deepseek: "vault-search-deepseek-api-key",
} as const;

export const LLM_MODEL_ENDPOINTS = {
  openai: "https://api.openai.com/v1/models",
  "opencode-go": "https://opencode.ai/zen/go/v1/models",
  deepseek: "https://api.deepseek.com/models",
} as const;
