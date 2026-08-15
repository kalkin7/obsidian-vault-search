"""Production ONNX Runtime embedding backend (CPU / CUDA / TensorRT).

Loads the derived pooled ONNX model (onnx/model-pooled-normalized.onnx) via
onnxruntime with CPUExecutionProvider (device=cpu), CUDAExecutionProvider, or
TensorrtExecutionProvider. Mean pooling and L2 normalization run inside the
ONNX graph; only [N, 768] sentence vectors are returned to the host.
Reproduces SentenceTransformers semantics: inputs are sorted by character
length (descending) before internal batching and restored to the original
order afterwards.

On CUDA, provider="auto" (default) prefers TensorRT when available because it
is substantially faster than the CUDA EP for this encoder; the CUDA EP is used
as a fallback. TRT engines are cached on disk keyed by the ONNX path hash so
the one-time engine build (~30 s) is not repeated. On CPU the provider setting
is ignored and the CPU execution provider is always used.

This is the production twin of the benchmark tool direct_e5_onnx.py. Unlike
the benchmark, it must run inside the managed venv which also imports
torch/kiwipiepy, so the "forbidden imports" check is omitted.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

POOLING_DIM = 768
MAX_SEQ = 512

DERIVED_REL = "onnx/model-pooled-normalized.onnx"

TRT_WORKSPACE_BYTES = 4 * 1024 ** 3
TRT_OPT_SEQ = 256
TRT_CACHE_MAX_BYTES = 6 * 1024 ** 3


def _find_trt_lib_dir() -> Path | None:
    """Locate the directory containing the TensorRT DLLs on Windows.

    The `tensorrt` pip package installs nvinfer*.dll into a site-packages
    directory (tensorrt_libs). ORT's TensorrtExecutionProvider resolves the
    library through the DLL search path, so we prepend that directory to PATH
    before creating the session. Only the interpreter's real site-packages
    (purelib/platlib) are accepted to avoid picking up arbitrary DLLs from
    unrelated directories.
    """
    import sysconfig
    candidate_dirs = set()
    for key in ("purelib", "platlib"):
        value = sysconfig.get_path(key)
        if value:
            candidate_dirs.add(str(Path(value).resolve()))
    for entry in sys.path:
        candidate = Path(entry)
        if not candidate.is_dir():
            continue
        resolved = str(candidate.resolve()).lower()
        if not any(resolved == base or resolved.startswith(base + os.sep)
                   for base in (b.lower() for b in candidate_dirs)):
            continue
        libs = candidate / "tensorrt_libs"
        if libs.is_dir() and (libs / "nvinfer_10.dll").exists():
            return libs
    return None


def _prepare_trt_dll_path() -> None:
    """Make the TensorRT DLLs resolvable for ORT's TensorrtExecutionProvider.

    ORT loads nvinfer via LoadLibrary, whose standard search order does not
    consult os.add_dll_directory, so PATH must be prepended for the session
    process. The service is long-lived and the directory is only added once.
    """
    if os.name != "nt":
        return
    lib_dir = _find_trt_lib_dir()
    if lib_dir is None:
        return
    current = os.environ.get("PATH", "")
    if str(lib_dir) in current.split(os.pathsep):
        return
    os.environ["PATH"] = str(lib_dir) + os.pathsep + current


def _trt_available() -> bool:
    try:
        import onnxruntime as ort
    except Exception:
        return False
    if "TensorrtExecutionProvider" not in ort.get_available_providers():
        return False
    if os.name == "nt":
        return _find_trt_lib_dir() is not None
    return True


def _require_cuda_primary(session: Any) -> None:
    """Ensure a built session actually runs on the CUDA EP as its primary EP.

    ORT can silently drop an execution provider and return a lower one (e.g.
    CPU) without raising; recording that session as CUDA would be wrong.
    """
    primary = session.get_providers()[0] if session.get_providers() else ""
    if primary != "CUDAExecutionProvider":
        raise RuntimeError(
            f"CUDA session could not be created; primary EP is {primary!r}: "
            f"{session.get_providers()}")


def _trt_provider_options(engine_cache_dir: Path, max_batch: int) -> dict[str, Any]:
    return {
        "trt_engine_cache_enable": True,
        "trt_engine_cache_path": str(engine_cache_dir),
        "trt_fp16_enable": False,
        "trt_max_workspace_size": TRT_WORKSPACE_BYTES,
        "trt_profile_min_shapes": "input_ids:1x1,attention_mask:1x1",
        "trt_profile_opt_shapes": f"input_ids:{max_batch}x{TRT_OPT_SEQ},"
                                  f"attention_mask:{max_batch}x{TRT_OPT_SEQ}",
        "trt_profile_max_shapes": f"input_ids:{max_batch}x{MAX_SEQ},"
                                  f"attention_mask:{max_batch}x{MAX_SEQ}",
    }


def _trt_cache_key(onnx_path: Path, max_batch: int) -> str:
    """Cache namespace for a TRT engine.

    Keys on the ONNX path plus the runtime/GPU inputs that invalidate a built
    engine (ORT/TRT versions, batch profile). Precision is fixed fp32.
    """
    import onnxruntime as ort
    parts = [
        hashlib.sha256(str(onnx_path.resolve()).encode("utf-8")).hexdigest()[:16],
        ort.__version__,
    ]
    try:
        import tensorrt as trt
        parts.append(trt.__version__)
    except Exception:
        parts.append("notrt")
    parts.append(str(max_batch))
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:24]


def _enforce_cache_quota(cache_root: Path, keep: Path) -> None:
    """Best-effort cap on the TRT engine cache directory size.

    Engines are ~1 GB each; without a cap repeated snapshot/runtime changes
    would accumulate stale engines. Oldest directories are removed first, the
    directory in active use is always kept, and low disk space failures are
    ignored (the caller can fall back to the CUDA EP).
    """
    try:
        subdirs = [d for d in cache_root.iterdir() if d.is_dir() and d != keep]
        total = sum(f.stat().st_size for d in cache_root.iterdir()
                    for f in d.glob("**/*") if f.is_file())
        if total <= TRT_CACHE_MAX_BYTES:
            return
        for d in sorted(subdirs, key=lambda p: p.stat().st_mtime):
            if total <= TRT_CACHE_MAX_BYTES:
                break
            for f in d.rglob("*"):
                if f.is_file():
                    total -= f.stat().st_size
            import shutil
            shutil.rmtree(d, ignore_errors=True)
    except Exception:
        pass


def _resolve_provider(provider: str) -> str:
    """Resolve the config value to an actual ONNX Runtime EP name.

    "auto" prefers TensorRT when it is actually usable, otherwise CUDA.
    "cpu" selects the CPU execution provider (used when the ONNX engine
    runs on a CPU-only runtime or when device=cpu).
    """
    if provider == "cpu":
        return "CPUExecutionProvider"
    if provider == "cuda":
        return "CUDAExecutionProvider"
    if provider == "tensorrt":
        return "TensorrtExecutionProvider"
    return "TensorrtExecutionProvider" if _trt_available() else "CUDAExecutionProvider"


def runtime_capabilities() -> dict[str, bool]:
    """Report what the current runtime's onnxruntime can actually execute.

    Drives conditional UI exposure: the TensorRT provider option is only
    shown when the runtime really has a usable TRT installation, and the CUDA
    provider option only when a CUDA-capable EP is present. The values are
    stable for the process lifetime (the managed runtime is fixed), so the
    service caches the result.
    """
    caps = {
        "onnx_available": False,
        "cuda_available": False,
        "tensorrt_available": False,
    }
    try:
        import onnxruntime as ort
    except Exception:
        return caps
    caps["onnx_available"] = True
    providers = ort.get_available_providers()
    caps["cuda_available"] = "CUDAExecutionProvider" in providers
    caps["tensorrt_available"] = _trt_available()
    return caps


class DirectE5Onnx:
    def __init__(self, model_dir: Path, provider: str = "auto",
                 normalize_embeddings: bool = True, max_seq_length: int = MAX_SEQ,
                 trt_cache_dir: Path | None = None,
                 trt_max_batch: int = 64):
        model_dir = Path(model_dir)

        if not normalize_embeddings:
            raise RuntimeError(
                "engine=onnx always produces L2-normalized embeddings; "
                "normalize_embeddings must be true for this engine")

        pooling = json.loads((model_dir / "1_Pooling" / "config.json").read_text(encoding="utf-8"))
        sentence_cfg = json.loads((model_dir / "sentence_bert_config.json").read_text(encoding="utf-8"))
        if int(pooling.get("word_embedding_dimension", 0)) != POOLING_DIM:
            raise RuntimeError(f"unexpected embedding dimension: {pooling.get('word_embedding_dimension')}")
        if not pooling.get("pooling_mode_mean_tokens"):
            raise RuntimeError("pooling_mode_mean_tokens must be true")
        for key in ("pooling_mode_cls_token", "pooling_mode_max_tokens",
                    "pooling_mode_mean_sqrt_len_tokens"):
            if pooling.get(key):
                raise RuntimeError(f"unsupported pooling flag enabled: {key}")
        if int(sentence_cfg.get("max_seq_length", 0)) != max_seq_length:
            raise RuntimeError(f"max_seq_length mismatch: {sentence_cfg.get('max_seq_length')}")
        if sentence_cfg.get("do_lower_case", False):
            raise RuntimeError("do_lower_case must be false")

        import tokenizers
        self.tokenizer = tokenizers.Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=max_seq_length, strategy="longest_first")
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>", direction="right")

        import onnxruntime as ort
        available = ort.get_available_providers()
        if provider == "tensorrt" and "TensorrtExecutionProvider" not in available:
            raise RuntimeError(
                f"provider=tensorrt requested but not available; got {available}")
        if provider == "cuda" and "CUDAExecutionProvider" not in available:
            raise RuntimeError(
                f"provider=cuda requested but not available; got {available}")
        onnx_path = model_dir / DERIVED_REL
        if not onnx_path.is_file():
            raise RuntimeError(
                f"missing derived pooled model: {onnx_path} "
                f"(run append_e5_pooling.py on this snapshot first)")
        session, resolved = self._create_session(
            provider, onnx_path, trt_cache_dir, trt_max_batch)
        self.session = session
        for inp in self.session.get_inputs():
            if inp.name not in {"input_ids", "attention_mask"} or inp.type != "tensor(int64)":
                raise RuntimeError(f"unexpected session input: {inp}")
        output_names = [out.name for out in self.session.get_outputs()]
        if output_names != ["sentence_embedding"]:
            raise RuntimeError(
                f"unexpected session outputs; expected ['sentence_embedding'], got {output_names}")
        output_shape = self.session.get_outputs()[0].shape
        if len(output_shape) != 2 or output_shape[1] != POOLING_DIM:
            raise RuntimeError(f"unexpected sentence_embedding shape: {output_shape}")

        self.dimension = POOLING_DIM
        self.provider = resolved
        self.trt_max_batch = int(trt_max_batch)
        self.normalize = normalize_embeddings
        self.max_seq_length = max_seq_length
        self.model_dir = model_dir

    @staticmethod
    def _create_session(requested: str, onnx_path: Path,
                        trt_cache_dir: Path | None, trt_max_batch: int) -> tuple[Any, str]:
        """Build the ORT session for the requested provider and return
        (session, effective EP name).

        TensorRT is preferred for "auto" and falls back to the CUDA EP both
        when the TRT engine build raises and when ORT silently returns a CUDA
        primary session (TRT registration failure). Explicit "tensorrt"
        requests surface errors instead of falling back. A CUDA session must
        also have CUDA as its primary EP; there is no lower fallback.
        """
        resolved = _resolve_provider(requested)
        if resolved == "CPUExecutionProvider":
            session = DirectE5Onnx._build_session(
                onnx_path, "CPUExecutionProvider", trt_cache_dir, trt_max_batch)
            return session, "CPUExecutionProvider"
        if resolved != "TensorrtExecutionProvider":
            session = DirectE5Onnx._build_session(
                onnx_path, "CUDAExecutionProvider", trt_cache_dir, trt_max_batch)
            _require_cuda_primary(session)
            return session, "CUDAExecutionProvider"

        try:
            session = DirectE5Onnx._build_session(
                onnx_path, "TensorrtExecutionProvider", trt_cache_dir, trt_max_batch)
        except Exception:
            if requested != "auto":
                raise
            session = DirectE5Onnx._build_session(
                onnx_path, "CUDAExecutionProvider", trt_cache_dir, trt_max_batch)
            _require_cuda_primary(session)
            return session, "CUDAExecutionProvider"

        primary = session.get_providers()[0] if session.get_providers() else ""
        if primary == "TensorrtExecutionProvider":
            return session, "TensorrtExecutionProvider"
        if requested != "auto":
            raise RuntimeError(
                f"provider=tensorrt requested but the primary EP is {primary!r}: "
                f"{session.get_providers()}")
        session = DirectE5Onnx._build_session(
            onnx_path, "CUDAExecutionProvider", trt_cache_dir, trt_max_batch)
        _require_cuda_primary(session)
        return session, "CUDAExecutionProvider"

    @staticmethod
    def _build_session(onnx_path: Path, provider: str,
                       trt_cache_dir: Path | None, trt_max_batch: int) -> Any:
        """Create the ORT session for the chosen provider.

        TensorRT engines are cached on disk keyed by the model path plus the
        runtime/GPU/batch inputs so the one-time build is amortized and stale
        engines are not reused. CUDA is the fallback, so it is always appended
        for the cases TRT cannot take over.
        """
        import onnxruntime as ort

        if provider == "TensorrtExecutionProvider":
            _prepare_trt_dll_path()
            cache_dir = trt_cache_dir
            if cache_dir is None:
                cache_dir = Path(os.environ.get(
                    "LOCALAPPDATA", Path.home())) / "ObsidianVaultSearch" / "trt-cache"
            cache_root = cache_dir
            cache_dir = cache_dir / _trt_cache_key(onnx_path, trt_max_batch)
            cache_dir.mkdir(parents=True, exist_ok=True)
            _enforce_cache_quota(cache_root, cache_dir)
            session_options = ort.SessionOptions()
            session = ort.InferenceSession(
                str(onnx_path),
                sess_options=session_options,
                providers=[("TensorrtExecutionProvider",
                            _trt_provider_options(cache_dir, trt_max_batch)),
                           "CUDAExecutionProvider"])
            _enforce_cache_quota(cache_root, cache_dir)
            return session

        if provider == "CPUExecutionProvider":
            return ort.InferenceSession(
                str(onnx_path),
                sess_options=ort.SessionOptions(),
                providers=["CPUExecutionProvider"])

        session_options = ort.SessionOptions()
        session_options.add_session_config_entry("session.enable_cuda_mem_arena", "0")
        return ort.InferenceSession(
            str(onnx_path), sess_options=session_options,
            providers=["CUDAExecutionProvider"])

    def tokenize(self, texts: list[str]) -> dict[str, np.ndarray]:
        encoded = self.tokenizer.encode_batch(list(texts), add_special_tokens=True)
        input_ids = np.asarray([item.ids for item in encoded], dtype=np.int64)
        attention_mask = np.asarray([item.attention_mask for item in encoded], dtype=np.int64)
        return {
            "input_ids": np.ascontiguousarray(input_ids),
            "attention_mask": np.ascontiguousarray(attention_mask),
        }

    def encode(self, texts: str | list[str], batch_size: int = 32) -> np.ndarray:
        single = isinstance(texts, str)
        values = [texts] if single else list(texts)
        count = len(values)
        if count == 0:
            return np.empty((0, POOLING_DIM), dtype=np.float32)
        if self.provider == "TensorrtExecutionProvider" and batch_size > self.trt_max_batch:
            raise ValueError(
                f"batch_size {batch_size} exceeds the TensorRT engine profile max "
                f"({self.trt_max_batch}); rebuild the engine with a larger "
                "trt_max_batch or lower the batch size")

        order = np.argsort([len(v) for v in values])[::-1]
        restore = np.argsort(order)

        vectors = np.empty((count, POOLING_DIM), dtype=np.float32)
        for start in range(0, count, batch_size):
            batch = [values[int(i)] for i in order[start:start + batch_size]]
            tokens = self.tokenize(batch)
            out = self.session.run(
                ["sentence_embedding"],
                {"input_ids": tokens["input_ids"], "attention_mask": tokens["attention_mask"]},
            )[0]
            vectors[start:start + batch_size] = out
        result = vectors[restore]
        result = np.ascontiguousarray(result, dtype=np.float32)
        if single:
            return result.reshape(1, -1)
        return result

    def release(self) -> None:
        """Destroy the ORT session to release VRAM. The model cannot encode
        afterwards; a new instance must be created."""
        session = getattr(self, "session", None)
        if session is not None:
            del session
            self.session = None  # type: ignore[assignment]

    @property
    def providers(self) -> list[str]:
        if self.session is None:
            return []
        return list(self.session.get_providers())
