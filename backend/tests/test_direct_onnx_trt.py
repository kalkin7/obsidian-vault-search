"""Unit tests for the TRT provider resolution in direct_onnx."""
from __future__ import annotations

from pathlib import Path

from vault_search.direct_onnx import (
    _find_trt_lib_dir,
    _resolve_provider,
    _trt_available,
    _trt_provider_options,
)


def test_resolve_explicit_providers() -> None:
    assert _resolve_provider("cuda") == "CUDAExecutionProvider"
    assert _resolve_provider("tensorrt") == "TensorrtExecutionProvider"


def test_resolve_auto_prefers_trt(monkeypatch) -> None:
    monkeypatch.setattr("vault_search.direct_onnx._trt_available", lambda: True)
    assert _resolve_provider("auto") == "TensorrtExecutionProvider"


def test_resolve_auto_falls_back_to_cuda(monkeypatch) -> None:
    monkeypatch.setattr("vault_search.direct_onnx._trt_available", lambda: False)
    assert _resolve_provider("auto") == "CUDAExecutionProvider"


def test_trt_provider_options_shape_profile() -> None:
    opts = _trt_provider_options(Path("C:/cache"), max_batch=64)
    assert opts["trt_engine_cache_enable"] is True
    assert opts["trt_fp16_enable"] is False
    assert opts["trt_profile_min_shapes"] == "input_ids:1x1,attention_mask:1x1"
    assert opts["trt_profile_opt_shapes"] == "input_ids:64x256,attention_mask:64x256"
    assert opts["trt_profile_max_shapes"] == "input_ids:64x512,attention_mask:64x512"


def test_find_trt_lib_dir_detects_site_packages(tmp_path: Path, monkeypatch) -> None:
    libs = tmp_path / "tensorrt_libs"
    libs.mkdir()
    (libs / "nvinfer_10.dll").write_bytes(b"x")
    (tmp_path / "site").mkdir()
    monkeypatch.setattr("vault_search.direct_onnx.sys", type("S", (), {"path": [str(tmp_path)]})())
    assert _find_trt_lib_dir() == libs


def test_encode_rejects_batch_over_trt_profile() -> None:
    from vault_search.direct_onnx import DirectE5Onnx
    obj = DirectE5Onnx.__new__(DirectE5Onnx)
    obj.provider = "TensorrtExecutionProvider"
    obj.trt_max_batch = 64
    try:
        obj.encode(["a"], batch_size=128)
        raise AssertionError("expected ValueError for batch over TRT profile max")
    except ValueError as exc:
        assert "exceeds the TensorRT engine profile max" in str(exc)
