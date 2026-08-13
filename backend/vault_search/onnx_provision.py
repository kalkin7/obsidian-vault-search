"""Generate the derived pooled ONNX graph used by `engine=onnx`.

Appends masked mean pooling + L2 normalization to the published raw E5 export
(`onnx/model.onnx`, output `last_hidden_state`) and writes
`onnx/model-pooled-normalized.onnx`, whose single output is `sentence_embedding`
of shape [N, 768]. This is the graph that `backend/vault_search/direct_onnx.py`
loads, so pooling and normalization run inside the graph.

The pooling contract is the one validated by the direct ONNX prototype
(docs/direct-onnx-runtime-prototype-summary-2026-08-12.md):

    mask   = attention_mask[..., None]  (float32)
    summed = (last_hidden_state * mask).sum(axis=1)
    counts = clip(mask.sum(axis=1), 1e-9, None)
    mean   = summed / counts
    norms  = sqrt((mean * mean).sum(axis=1))
    out    = mean / clip(norms, 1e-12, None)

The graph is built at opset 11 with a Max(epsilon) lower clamp because recent
onnx checkers reject the opset-11 Clip min/max attributes. `onnx` and
`onnxruntime` must be importable in the process that runs `provision()`; they
are not imported by the embedding service itself.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from .direct_onnx import DERIVED_REL, POOLING_DIM

# Node name prefixes
_MASK_F = "mask_f"
_MASK_1 = "mask_1"
_MASKED = "masked"
_SUMMED = "summed"
_COUNTS = "counts"
_COUNTS_SAFE = "counts_safe"
_MEAN = "mean"
_SQ = "sq"
_SUM_SQ = "sum_sq"
_NORM = "norm"
_NORM_SAFE = "norm_safe"
_NORM_1 = "norm_1"
_OUT = "sentence_embedding"
_EPS_COUNTS = "eps_counts"
_EPS_NORM = "eps_norm"


def _require(config_name: str, path: Path, payload: dict) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"missing required model file {config_name}: {path}")
    payload[config_name] = path


def validate_contract(model_dir: Path) -> dict[str, Path]:
    required: dict[str, Path] = {}
    _require("tokenizer.json", model_dir / "tokenizer.json", required)
    _require("modules.json", model_dir / "modules.json", required)
    _require("1_Pooling/config.json", model_dir / "1_Pooling" / "config.json", required)
    _require("sentence_bert_config.json", model_dir / "sentence_bert_config.json", required)
    _require("onnx/model.onnx", model_dir / "onnx" / "model.onnx", required)

    modules = json.loads(required["modules.json"].read_text(encoding="utf-8"))
    if [m.get("type") for m in modules] != [
        "sentence_transformers.models.Transformer",
        "sentence_transformers.models.Pooling",
        "sentence_transformers.models.Normalize",
    ]:
        raise ValueError(f"unexpected modules.json types: {modules}")

    pooling = json.loads(required["1_Pooling/config.json"].read_text(encoding="utf-8"))
    if int(pooling.get("word_embedding_dimension", 0)) != POOLING_DIM:
        raise ValueError(f"unexpected pooling dimension: {pooling}")
    if not (
        pooling.get("pooling_mode_mean_tokens") is True
        and pooling.get("pooling_mode_cls_token") is False
        and pooling.get("pooling_mode_max_tokens") is False
        and pooling.get("pooling_mode_mean_sqrt_len_tokens") is False
    ):
        raise ValueError(f"unsupported pooling config: {pooling}")

    sbert = json.loads(required["sentence_bert_config.json"].read_text(encoding="utf-8"))
    if int(sbert.get("max_seq_length", 0)) != 512:
        raise ValueError(f"unexpected max_seq_length: {sbert}")
    if sbert.get("do_lower_case") is not False:
        raise ValueError(f"do_lower_case must be false: {sbert}")
    return required


def _append_pooling(model) -> None:
    import onnx

    graph = model.graph
    output_names = [o.name for o in graph.output]
    if output_names != ["last_hidden_state"]:
        raise ValueError(f"unexpected raw graph outputs; expected ['last_hidden_state'], got {output_names}")
    graph.output.pop()

    graph.initializer.extend([
        onnx.helper.make_tensor(_EPS_COUNTS, onnx.TensorProto.FLOAT, [1, 1], [1e-9]),
        onnx.helper.make_tensor(_EPS_NORM, onnx.TensorProto.FLOAT, [1], [1e-12]),
    ])

    nodes = [
        onnx.helper.make_node("Cast", ["attention_mask"], [_MASK_F], to=onnx.TensorProto.FLOAT),
        onnx.helper.make_node("Unsqueeze", [_MASK_F], [_MASK_1], axes=[2]),
        onnx.helper.make_node("Mul", ["last_hidden_state", _MASK_1], [_MASKED]),
        onnx.helper.make_node("ReduceSum", [_MASKED], [_SUMMED], axes=[1], keepdims=0),
        onnx.helper.make_node("ReduceSum", [_MASK_1], [_COUNTS], axes=[1], keepdims=0),
        onnx.helper.make_node("Max", [_COUNTS, _EPS_COUNTS], [_COUNTS_SAFE]),
        onnx.helper.make_node("Div", [_SUMMED, _COUNTS_SAFE], [_MEAN]),
        onnx.helper.make_node("Mul", [_MEAN, _MEAN], [_SQ]),
        onnx.helper.make_node("ReduceSum", [_SQ], [_SUM_SQ], axes=[1], keepdims=0),
        onnx.helper.make_node("Sqrt", [_SUM_SQ], [_NORM]),
        onnx.helper.make_node("Max", [_NORM, _EPS_NORM], [_NORM_SAFE]),
        onnx.helper.make_node("Unsqueeze", [_NORM_SAFE], [_NORM_1], axes=[1]),
        onnx.helper.make_node("Div", [_MEAN, _NORM_1], [_OUT]),
    ]
    graph.node.extend(nodes)
    graph.output.append(
        onnx.helper.make_tensor_value_info(_OUT, onnx.TensorProto.FLOAT, [None, POOLING_DIM]))
    onnx.checker.check_model(model)


def verify(model_dir: Path, model) -> None:
    """Check the derived graph with onnxruntime against explicit numpy pooling."""
    import onnx
    import numpy as np
    import onnxruntime as ort

    raw_path = model_dir / "onnx" / "model.onnx"
    raw_session = ort.InferenceSession(str(raw_path), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(7)
    seq = rng.integers(3, 500, size=(4, 64))
    mask = np.ones_like(seq)
    mask[:, -5:] = 0

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        derived_path = Path(tmp) / "derived.onnx"
        onnx.save(model, derived_path)
        session = ort.InferenceSession(str(derived_path), providers=["CPUExecutionProvider"])
        emb = session.run(["sentence_embedding"], {"input_ids": seq, "attention_mask": mask})[0]
        hidden = raw_session.run(
            ["last_hidden_state"], {"input_ids": seq, "attention_mask": mask})[0]

    if hidden.shape[2] != POOLING_DIM or emb.shape != (4, POOLING_DIM):
        raise RuntimeError(f"unexpected shapes: hidden={hidden.shape} emb={emb.shape}")
    if not np.isfinite(emb).all():
        raise RuntimeError("derived embedding contains NaN/inf")
    if not np.allclose(np.linalg.norm(emb, axis=1), 1.0, atol=1e-5):
        raise RuntimeError("derived embedding norms not ~1")
    m = mask[:, :, None].astype(np.float32)
    expected_mean = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
    expected = expected_mean / np.clip(
        np.linalg.norm(expected_mean, axis=1, keepdims=True), 1e-12, None)
    if float(np.abs(emb - expected).max()) > 1e-5:
        raise RuntimeError("derived vs explicit pooling max diff too large")


def derived_available(model_dir: Path) -> bool:
    return (Path(model_dir) / DERIVED_REL).is_file()


def provision(model_dir: Path, verify_graph: bool = True) -> Path:
    """Generate the derived pooled graph if missing; returns its path.

    Idempotent: if `onnx/model-pooled-normalized.onnx` already exists it is
    returned unchanged. The graph is written to a temporary file, verified with
    onnxruntime (when requested), then atomically replaced.
    """
    import onnx

    model_dir = Path(model_dir)
    validate_contract(model_dir)
    target = model_dir / DERIVED_REL
    if target.is_file():
        return target

    raw = model_dir / "onnx" / "model.onnx"
    model = onnx.load(raw)
    _append_pooling(model)

    tmp = target.with_suffix(".provision.tmp.onnx")
    onnx.save(model, tmp)
    try:
        if verify_graph:
            verify(model_dir, model)
        shutil.move(str(tmp), str(target))
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return target


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True,
                        help="exact local HF snapshot directory for intfloat/multilingual-e5-base")
    parser.add_argument("--verify", action="store_true",
                        help="run an onnxruntime parity check on the generated graph")
    args = parser.parse_args(argv)

    path = provision(Path(args.model_dir), verify_graph=bool(args.verify))
    print(f"ok: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
