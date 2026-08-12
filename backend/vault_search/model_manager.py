from __future__ import annotations

import hashlib
import importlib.util
from typing import Any

import numpy as np

from .config import SearchConfig


def _is_importable(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


class ModelManager:
    def __init__(self, config: SearchConfig):
        self.config = config
        self.model: Any | None = None
        self.device = "cpu"
        self.dimension: int | None = None
        self.engine = config.engine

    def load(self) -> None:
        if self.config.model_id == "__fake__":
            self.model = _FakeSentenceTransformer(32)
            self.device = "cpu"
            self.dimension = 32
            return

        if self.engine == "onnx":
            self._load_onnx()
            return

        import torch
        from sentence_transformers import SentenceTransformer

        requested = self.config.device
        if requested == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available")
        self.device = "cuda" if requested == "cuda" or (
            requested == "auto" and torch.cuda.is_available()) else "cpu"
        try:
            self.model = SentenceTransformer(
                self.config.model_id,
                device=self.device,
                local_files_only=True,
            )
        except OSError as exc:
            if not _is_huggingface_cache_miss(exc):
                raise
            self.model = SentenceTransformer(self.config.model_id, device=self.device)
        getter = getattr(self.model, "get_embedding_dimension", None)
        dimension = getter() if getter else self.model.get_sentence_embedding_dimension()
        if dimension is None:
            probe = self.encode_query("dimension probe")
            dimension = int(probe.shape[-1])
        self.dimension = int(dimension)

    def _load_onnx(self) -> None:
        from .direct_onnx import DirectE5Onnx

        if self.config.model_id != "intfloat/multilingual-e5-base":
            raise RuntimeError(
                "engine=onnx currently supports only "
                "intfloat/multilingual-e5-base (derived pooled graph)")
        if not _is_importable("onnxruntime"):
            raise RuntimeError("onnxruntime is not installed in this runtime")
        if self.config.device == "cpu":
            raise RuntimeError("engine=onnx requires device=cuda on this build")
        import onnxruntime as ort
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError(
                "engine=onnx requires CUDAExecutionProvider, but it is not available")
        model_dir = _resolve_model_dir(self.config.model_id)
        if model_dir is None:
            raise RuntimeError(
                f"model snapshot not found locally: {self.config.model_id} "
                "(inference must not download)")
        try:
            self.model = DirectE5Onnx(
                model_dir,
                provider="CUDAExecutionProvider",
                normalize_embeddings=self.config.normalize_embeddings,
            )
        except OSError:
            raise
        self.device = "cuda"
        self.dimension = int(self.model.dimension)

    def release(self) -> None:
        """Release model resources (e.g. ORT session VRAM for engine=onnx)."""
        release = getattr(self.model, "release", None)
        if release is not None:
            release()
        self.model = None

    def ensure_loaded(self) -> Any:
        if self.model is None:
            raise RuntimeError("Embedding model is not loaded")
        return self.model

    def encode_query(self, query: str) -> np.ndarray:
        model = self.ensure_loaded()
        if self.engine == "onnx":
            vector = model.encode(self.config.query_prefix + query, batch_size=1)
            return np.atleast_2d(np.asarray(vector, dtype=np.float32))
        vector = model.encode(
            self.config.query_prefix + query,
            normalize_embeddings=self.config.normalize_embeddings,
            convert_to_numpy=True,
        )
        return np.atleast_2d(np.asarray(vector, dtype=np.float32))

    def encode_documents(self, texts: list[str], show_progress: bool = False) -> np.ndarray:
        model = self.ensure_loaded()
        prepared = [self.config.document_prefix + text for text in texts]
        batch_size = (self.config.embedding_batch_size_gpu if self.device == "cuda"
                      else self.config.embedding_batch_size_cpu)
        if self.engine == "onnx":
            return np.asarray(model.encode(prepared, batch_size=batch_size), dtype=np.float32)
        vectors = model.encode(
            prepared,
            batch_size=batch_size,
            normalize_embeddings=self.config.normalize_embeddings,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return np.asarray(vectors, dtype=np.float32)


class _FakeSentenceTransformer:
    """Deterministic dependency-free model used only by tests and smoke checks."""

    def __init__(self, dimension: int):
        self.dimension = dimension

    def get_sentence_embedding_dimension(self) -> int:
        return self.dimension

    def encode(self, texts: str | list[str], **_kwargs: Any) -> np.ndarray:
        single = isinstance(texts, str)
        values = [texts] if single else texts
        vectors = np.vstack([self._vector(value) for value in values]).astype(np.float32)
        return vectors[0] if single else vectors

    def _vector(self, text: str) -> np.ndarray:
        vector = np.zeros(self.dimension, dtype=np.float32)
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            vector[int.from_bytes(digest[:2], "little") % self.dimension] += 1.0
        norm = float(np.linalg.norm(vector))
        if norm:
            vector /= norm
        return vector


def _is_huggingface_cache_miss(error: BaseException) -> bool:
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if type(current).__name__ == "LocalEntryNotFoundError":
            return True
        current = current.__cause__ or current.__context__
    return False


def _resolve_model_dir(model_id: str) -> Path | None:
    """Resolve a local HF snapshot directory for a model id without downloading.

    Prefers huggingface_hub (respects HF_HOME / HF_HUB_CACHE), then falls back
    to the raw cache layout for offline environments.
    """
    try:
        from huggingface_hub import snapshot_download
        path = snapshot_download(model_id, local_files_only=True)
        if path:
            return Path(path)
    except Exception:
        pass

    from pathlib import Path
    import os

    cache_home = Path(os.environ.get("HF_HUB_CACHE") or os.environ.get(
        "HF_HOME", Path.home() / ".cache" / "huggingface"))
    hub_dir = cache_home / "hub"
    folder = "models--" + model_id.replace("/", "--")
    repo_dir = hub_dir / folder
    if not repo_dir.is_dir():
        return None
    refs = repo_dir / "refs" / "main"
    revision = None
    if refs.is_file():
        revision = refs.read_text(encoding="utf-8").strip()
    if revision and (repo_dir / "snapshots" / revision).is_dir():
        return repo_dir / "snapshots" / revision
    snapshots = sorted((repo_dir / "snapshots").iterdir()) if (repo_dir / "snapshots").is_dir() else []
    return snapshots[-1] if snapshots else None
