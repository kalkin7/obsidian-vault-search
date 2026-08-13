from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_INCLUDES = ["**/*.md"]
DEFAULT_EXCLUDES = [".obsidian/**", "9_System/**", "**/node_modules/**"]


@dataclass(slots=True)
class SearchConfig:
    vault_path: Path
    data_dir: Path
    model_id: str = "intfloat/multilingual-e5-base"
    model_profile: str = "multilingual-e5-base"
    engine: str = "pytorch"
    device: str = "auto"
    provider: str = "auto"
    query_prefix: str = "query: "
    document_prefix: str = "passage: "
    normalize_embeddings: bool = True
    include_globs: list[str] = field(default_factory=lambda: list(DEFAULT_INCLUDES))
    exclude_globs: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    chunk_chars: int = 400
    chunk_overlap: int = 60
    chunking_strategy: str = "paragraph-v1"
    bm25_top_k: int = 80
    vector_top_k: int = 80
    final_top_k: int = 40
    rrf_k: int = 60
    max_chunks_per_file: int = 1
    title_rrf_weight: float = 1.0
    prefix_fallback: bool = True
    embedding_batch_size_cpu: int = 32
    embedding_batch_size_gpu: int = 64
    lazy_model: bool = False
    model_idle_timeout_seconds: float = 0.0
    heartbeat_timeout_seconds: float = 20.0

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def db_path(self) -> Path:
        return self.index_dir / "chunks.db"

    @property
    def vector_path(self) -> Path:
        return self.index_dir / "vectors.usearch"

    @property
    def metadata_path(self) -> Path:
        return self.index_dir / "metadata.json"

    @property
    def runtime_path(self) -> Path:
        return self.data_dir / "runtime.json"

    @property
    def log_path(self) -> Path:
        return self.data_dir / "backend.log"

    def scope_hash(self) -> str:
        raw = json.dumps(
            {"include": self.include_globs, "exclude": self.exclude_globs},
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _as_nonempty_lines(value: Any, default: list[str]) -> list[str]:
    if isinstance(value, list):
        result = [str(x).strip().replace("\\", "/") for x in value if str(x).strip()]
        return result or list(default)
    if isinstance(value, str):
        result = [x.strip().replace("\\", "/") for x in value.splitlines() if x.strip()]
        return result or list(default)
    return list(default)


def load_config(path: str | Path, vault_override: str | None = None,
                data_dir_override: str | None = None) -> SearchConfig:
    config_path = Path(path).resolve()
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    vault_value = vault_override or raw.get("vaultPath") or raw.get("vault_path")
    data_dir_value = data_dir_override or raw.get("dataDir") or raw.get("data_dir")
    if not vault_value:
        raise ValueError("vaultPath is required")
    if not data_dir_value:
        raise ValueError("dataDir is required")
    vault = Path(vault_value).resolve()
    data_dir = Path(data_dir_value).resolve()
    if not vault.is_dir():
        raise ValueError(f"Vault path does not exist: {vault}")

    profile = str(raw.get("modelProfile", "multilingual-e5-base"))
    model_id = str(raw.get("modelId", "intfloat/multilingual-e5-base"))
    engine = str(raw.get("engine", "pytorch")).lower()
    if engine not in {"pytorch", "onnx"}:
        engine = "pytorch"
    query_prefix = str(raw.get("queryPrefix", "query: " if profile == "multilingual-e5-base" else ""))
    document_prefix = str(raw.get("documentPrefix", "passage: " if profile == "multilingual-e5-base" else ""))
    device = str(raw.get("device", "auto")).lower()
    if device not in {"auto", "cpu", "cuda"}:
        device = "auto"
    provider = str(raw.get("provider", "auto")).lower()
    if provider not in {"auto", "cuda", "tensorrt"}:
        provider = "auto"

    cfg = SearchConfig(
        vault_path=vault,
        data_dir=data_dir,
        model_id=model_id,
        model_profile=profile,
        engine=engine,
        device=device,
        provider=provider,
        query_prefix=query_prefix,
        document_prefix=document_prefix,
        normalize_embeddings=bool(raw.get("normalizeEmbeddings", True)),
        include_globs=_as_nonempty_lines(raw.get("includeGlobs"), DEFAULT_INCLUDES),
        exclude_globs=_as_nonempty_lines(raw.get("excludeGlobs"), DEFAULT_EXCLUDES),
        chunk_chars=max(100, int(raw.get("chunkChars", 400))),
        chunk_overlap=max(0, int(raw.get("chunkOverlap", 60))),
        chunking_strategy=str(raw.get("chunkingStrategy", "paragraph-v1")),
        bm25_top_k=max(1, int(raw.get("bm25TopK", 80))),
        vector_top_k=max(1, int(raw.get("vectorTopK", 80))),
        final_top_k=max(1, int(raw.get("finalTopK", 40))),
        rrf_k=max(1, int(raw.get("rrfK", 60))),
        max_chunks_per_file=max(1, int(raw.get("maxChunksPerFile", 1))),
        title_rrf_weight=max(0.0, float(raw.get("titleRrfWeight", 1.0))),
        prefix_fallback=bool(raw.get("prefixFallback", True)),
        embedding_batch_size_cpu=max(1, int(raw.get("embeddingBatchSizeCpu", 32))),
        embedding_batch_size_gpu=max(1, int(raw.get("embeddingBatchSizeGpu", 64))),
        lazy_model=bool(raw.get("lazyModel", raw.get("loadPolicy") == "first-search")),
        model_idle_timeout_seconds=max(0.0, float(raw.get("modelIdleTimeoutSeconds", 0.0))),
        heartbeat_timeout_seconds=max(5.0, float(raw.get("heartbeatTimeoutSeconds", 20.0))),
    )
    if cfg.chunk_overlap >= cfg.chunk_chars:
        raise ValueError("chunkOverlap must be smaller than chunkChars")
    if cfg.chunking_strategy not in {"paragraph-v1", "markdown-v2"}:
        raise ValueError("chunkingStrategy must be paragraph-v1 or markdown-v2")
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    cfg.index_dir.mkdir(parents=True, exist_ok=True)
    return cfg
