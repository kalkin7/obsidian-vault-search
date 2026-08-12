"""Production ONNX Runtime embedding backend (CUDA-only path).

Loads the derived pooled ONNX model (onnx/model-pooled-normalized.onnx) via
onnxruntime-gpu with CUDAExecutionProvider only. Mean pooling and L2
normalization run inside the ONNX graph on the GPU; only [N, 768] sentence
vectors are returned to the host. Reproduces SentenceTransformers semantics:
inputs are sorted by character length (descending) before internal batching
and restored to the original order afterwards.

This is the production twin of the benchmark tool direct_e5_onnx.py. Unlike
the benchmark, it must run inside the managed CUDA venv which also imports
torch/kiwipiepy, so the "forbidden imports" check is omitted.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

POOLING_DIM = 768
MAX_SEQ = 512

DERIVED_REL = "onnx/model-pooled-normalized.onnx"


class DirectE5Onnx:
    def __init__(self, model_dir: Path, provider: str = "CUDAExecutionProvider",
                 normalize_embeddings: bool = True, max_seq_length: int = MAX_SEQ):
        model_dir = Path(model_dir)

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
        if provider not in available:
            raise RuntimeError(f"provider {provider} not available; got {available}")
        onnx_path = model_dir / DERIVED_REL
        if not onnx_path.is_file():
            raise RuntimeError(
                f"missing derived pooled model: {onnx_path} "
                f"(run append_e5_pooling.py on this snapshot first)")
        session_options = ort.SessionOptions()
        session_options.add_session_config_entry("session.enable_cuda_mem_arena", "0")
        self.session = ort.InferenceSession(
            str(onnx_path), sess_options=session_options, providers=[provider])
        if not self.session.get_providers() or self.session.get_providers()[0] != provider:
            raise RuntimeError(f"provider {provider} is not the primary EP: {self.session.get_providers()}")
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
        self.provider = provider
        self.normalize = normalize_embeddings
        self.max_seq_length = max_seq_length
        self.model_dir = model_dir

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
