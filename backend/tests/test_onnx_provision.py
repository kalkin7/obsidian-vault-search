"""Tests for the derived pooled ONNX graph generation."""
from __future__ import annotations

from pathlib import Path

import pytest


def _write_contract_files(model_dir: Path) -> None:
    (model_dir / "onnx").mkdir(parents=True, exist_ok=True)
    (model_dir / "1_Pooling").mkdir(parents=True, exist_ok=True)
    (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
    (model_dir / "modules.json").write_text(json_dump([
        {"type": "sentence_transformers.models.Transformer"},
        {"type": "sentence_transformers.models.Pooling"},
        {"type": "sentence_transformers.models.Normalize"},
    ]), encoding="utf-8")
    (model_dir / "1_Pooling" / "config.json").write_text(json_dump({
        "word_embedding_dimension": 768,
        "pooling_mode_cls_token": False,
        "pooling_mode_mean_tokens": True,
        "pooling_mode_max_tokens": False,
        "pooling_mode_mean_sqrt_len_tokens": False,
    }), encoding="utf-8")
    (model_dir / "sentence_bert_config.json").write_text(json_dump({
        "max_seq_length": 512,
        "do_lower_case": False,
    }), encoding="utf-8")


def json_dump(value) -> str:
    import json
    return json.dumps(value)


def test_provision_builds_derived_graph(tmp_path: Path) -> None:
    onnx = pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")

    from vault_search.onnx_provision import derived_available, provision, validate_contract

    model_dir = tmp_path / "snap"
    _write_contract_files(model_dir)

    value = [[[0.1] * 768]]
    const = onnx.helper.make_node(
        "Constant", [], ["last_hidden_state"],
        value=onnx.helper.make_tensor(
            "v", onnx.TensorProto.FLOAT, [1, 1, 768], value))
    input_ids = onnx.helper.make_tensor_value_info(
        "input_ids", onnx.TensorProto.INT64, ["batch", "seq"])
    attention_mask = onnx.helper.make_tensor_value_info(
        "attention_mask", onnx.TensorProto.INT64, ["batch", "seq"])
    last = onnx.helper.make_tensor_value_info(
        "last_hidden_state", onnx.TensorProto.FLOAT, [1, 1, 768])
    graph = onnx.helper.make_graph(
        [const], "raw", [input_ids, attention_mask], [last])
    model = onnx.helper.make_model(
        graph, opset_imports=[onnx.helper.make_opsetid("", 11)])
    onnx.save(model, model_dir / "onnx" / "model.onnx")

    assert derived_available(model_dir) is False
    validate_contract(model_dir)
    target = provision(model_dir, verify_graph=False)

    assert target.is_file()
    assert target.name == "model-pooled-normalized.onnx"
    assert derived_available(model_dir) is True

    loaded = onnx.load(target)
    assert [o.name for o in loaded.graph.output] == ["sentence_embedding"]

    # idempotent: a second provision returns the existing file unchanged
    assert provision(model_dir, verify_graph=False) == target


def test_provision_rejects_wrong_raw_output(tmp_path: Path) -> None:
    onnx = pytest.importorskip("onnx")

    from vault_search.onnx_provision import provision

    model_dir = tmp_path / "snap"
    _write_contract_files(model_dir)
    input_ids = onnx.helper.make_tensor_value_info(
        "input_ids", onnx.TensorProto.INT64, ["batch", "seq"])
    output = onnx.helper.make_tensor_value_info(
        "hidden", onnx.TensorProto.FLOAT, [1, 1, 768])
    graph = onnx.helper.make_graph([], "raw", [input_ids], [output])
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 11)])
    onnx.save(model, model_dir / "onnx" / "model.onnx")

    with pytest.raises(ValueError, match="last_hidden_state"):
        provision(model_dir, verify_graph=False)


def test_provision_validates_contract(tmp_path: Path) -> None:
    pytest.importorskip("onnx")

    from vault_search.onnx_provision import provision

    model_dir = tmp_path / "snap"
    (model_dir / "onnx").mkdir(parents=True, exist_ok=True)

    with pytest.raises(FileNotFoundError, match="tokenizer.json"):
        provision(model_dir, verify_graph=False)
