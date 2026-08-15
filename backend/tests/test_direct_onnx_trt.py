"""Unit tests for the TRT provider resolution in direct_onnx."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from vault_search import direct_onnx
from vault_search.direct_onnx import (
    DirectE5Onnx,
    _find_trt_lib_dir,
    _resolve_provider,
    _trt_cache_key,
    _trt_provider_options,
)


def test_resolve_explicit_providers() -> None:
    assert _resolve_provider("cpu") == "CPUExecutionProvider"
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
    import sysconfig as _sc
    libs = tmp_path / "tensorrt_libs"
    libs.mkdir()
    (libs / "nvinfer_10.dll").write_bytes(b"x")
    monkeypatch.setattr(_sc, "get_path", lambda key: str(tmp_path))
    fake_sys = type("S", (), {"path": [str(tmp_path)]})()
    monkeypatch.setattr("vault_search.direct_onnx.sys", fake_sys)
    assert _find_trt_lib_dir() == libs


def test_find_trt_lib_dir_rejects_foreign_paths(tmp_path: Path, monkeypatch) -> None:
    import sysconfig as _sc
    outside = tmp_path.parent / "unrelated"
    outside.mkdir(exist_ok=True)
    libs = outside / "tensorrt_libs"
    libs.mkdir()
    (libs / "nvinfer_10.dll").write_bytes(b"x")
    monkeypatch.setattr(_sc, "get_path", lambda key: str(tmp_path))
    fake_sys = type("S", (), {"path": [str(outside)]})()
    monkeypatch.setattr("vault_search.direct_onnx.sys", fake_sys)
    assert _find_trt_lib_dir() is None


def test_encode_rejects_batch_over_trt_profile() -> None:
    obj = DirectE5Onnx.__new__(DirectE5Onnx)
    obj.provider = "TensorrtExecutionProvider"
    obj.trt_max_batch = 64
    try:
        obj.encode(["a"], batch_size=128)
        raise AssertionError("expected ValueError for batch over TRT profile max")
    except ValueError as exc:
        assert "exceeds the TensorRT engine profile max" in str(exc)


class _FakeSession:
    def __init__(self, providers: list[str]):
        self._providers = providers

    def get_providers(self):
        return list(self._providers)


def _auto_trt_resolve(provider: str) -> str:
    return "TensorrtExecutionProvider" if provider == "auto" else \
        "CUDAExecutionProvider" if provider == "cuda" else "TensorrtExecutionProvider"


def test_runtime_capabilities_reports_providers(monkeypatch) -> None:
    import torch
    from vault_search.direct_onnx import runtime_capabilities

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setitem(
        sys.modules, "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]))
    monkeypatch.setattr(direct_onnx, "_trt_available", lambda: False)
    assert runtime_capabilities() == {
        "onnx_available": True, "cuda_available": True, "tensorrt_available": False}


def test_runtime_capabilities_provider_registered_but_cuda_unusable(monkeypatch) -> None:
    """A registered CUDA EP is not proof of usability: without an actual torch
    CUDA init, the capability must report false so the UI does not disable
    installation while explicit CUDA startup would still fail."""
    import torch
    from vault_search.direct_onnx import runtime_capabilities

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    monkeypatch.setitem(
        sys.modules, "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["CUDAExecutionProvider", "TensorrtExecutionProvider", "CPUExecutionProvider"]))
    monkeypatch.setattr(direct_onnx, "_trt_available", lambda: True)
    assert runtime_capabilities() == {
        "onnx_available": True, "cuda_available": False, "tensorrt_available": False}


def test_runtime_capabilities_tensorrt_usable(monkeypatch) -> None:
    import torch
    from vault_search.direct_onnx import runtime_capabilities

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setitem(
        sys.modules, "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["TensorrtExecutionProvider", "CPUExecutionProvider"]))
    monkeypatch.setattr(direct_onnx, "_trt_available", lambda: True)
    caps = runtime_capabilities()
    assert caps["onnx_available"] is True
    assert caps["tensorrt_available"] is True


def test_runtime_capabilities_missing_onnxruntime(monkeypatch) -> None:
    import builtins

    from vault_search.direct_onnx import runtime_capabilities

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "onnxruntime" or name.startswith("onnxruntime."):
            raise ModuleNotFoundError("No module named 'onnxruntime'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert runtime_capabilities() == {
        "onnx_available": False, "cuda_available": False, "tensorrt_available": False}


def test_cpu_session_builds_cpu_only(monkeypatch) -> None:
    calls: list[str] = []

    def fake_build(path, provider, cache_dir, max_batch):
        calls.append(provider)
        return _FakeSession(["CPUExecutionProvider"])

    monkeypatch.setattr(DirectE5Onnx, "_build_session", staticmethod(fake_build))
    session, resolved = DirectE5Onnx._create_session("cpu", Path("x.onnx"), None, 64)
    assert resolved == "CPUExecutionProvider"
    assert calls == ["CPUExecutionProvider"]
    assert session.get_providers() == ["CPUExecutionProvider"]


def test_auto_silent_cuda_fallback(monkeypatch) -> None:
    """ORT can return a CUDA-primary session instead of raising when TRT
    registration fails; auto must then fall back to a CUDA-only session."""
    calls: list[str] = []

    def fake_build(path, provider, cache_dir, max_batch):
        calls.append(provider)
        return _FakeSession(["CUDAExecutionProvider"])

    monkeypatch.setattr(direct_onnx, "_resolve_provider", _auto_trt_resolve)
    monkeypatch.setattr(DirectE5Onnx, "_build_session", staticmethod(fake_build))
    session, resolved = DirectE5Onnx._create_session("auto", Path("x.onnx"), None, 64)
    assert resolved == "CUDAExecutionProvider"
    assert calls == ["TensorrtExecutionProvider", "CUDAExecutionProvider"]
    assert session.get_providers() == ["CUDAExecutionProvider"]


def test_explicit_tensorrt_silent_fallback_raises(monkeypatch) -> None:
    def fake_build(path, provider, cache_dir, max_batch):
        return _FakeSession(["CUDAExecutionProvider"])

    monkeypatch.setattr(direct_onnx, "_resolve_provider", _auto_trt_resolve)
    monkeypatch.setattr(DirectE5Onnx, "_build_session", staticmethod(fake_build))
    with pytest.raises(RuntimeError, match="primary EP"):
        DirectE5Onnx._create_session("tensorrt", Path("x.onnx"), None, 64)


def test_auto_trt_build_exception_falls_back(monkeypatch) -> None:
    calls: list[str] = []

    def fake_build(path, provider, cache_dir, max_batch):
        calls.append(provider)
        if provider == "TensorrtExecutionProvider":
            raise RuntimeError("engine build failed")
        return _FakeSession(["CUDAExecutionProvider"])

    monkeypatch.setattr(direct_onnx, "_resolve_provider", _auto_trt_resolve)
    monkeypatch.setattr(DirectE5Onnx, "_build_session", staticmethod(fake_build))
    _, resolved = DirectE5Onnx._create_session("auto", Path("x.onnx"), None, 64)
    assert resolved == "CUDAExecutionProvider"
    assert calls == ["TensorrtExecutionProvider", "CUDAExecutionProvider"]


def test_trt_cache_key_changes_with_batch_and_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setitem(
        sys.modules, "onnxruntime",
        SimpleNamespace(__version__="1.25.1"))
    k1 = _trt_cache_key(Path(r"C:\models\m.onnx"), 32)
    k2 = _trt_cache_key(Path(r"C:\models\m.onnx"), 64)
    assert k1 != k2
    k3 = _trt_cache_key(Path(r"C:\models\other.onnx"), 32)
    assert k1 != k3


def test_cuda_session_requires_cuda_primary(monkeypatch) -> None:
    def fake_build(path, provider, cache_dir, max_batch):
        return _FakeSession(["CPUExecutionProvider"])

    monkeypatch.setattr(direct_onnx, "_resolve_provider", _auto_trt_resolve)
    monkeypatch.setattr(DirectE5Onnx, "_build_session", staticmethod(fake_build))
    with pytest.raises(RuntimeError, match="primary EP is"):
        DirectE5Onnx._create_session("cuda", Path("x.onnx"), None, 64)


def test_cache_quota_removes_oldest_keeps_active(tmp_path: Path, monkeypatch) -> None:
    import os
    import time

    from vault_search.direct_onnx import _enforce_cache_quota

    monkeypatch.setattr("vault_search.direct_onnx.TRT_CACHE_MAX_BYTES", 2 * 1024 * 1024)
    old = tmp_path / "old"
    old.mkdir()
    (old / "engine.bin").write_bytes(b"x" * (1024 * 1024))
    newer = tmp_path / "newer"
    newer.mkdir()
    (newer / "engine.bin").write_bytes(b"x" * (1024 * 1024))
    keep = tmp_path / "keep"
    keep.mkdir()
    (keep / "engine.bin").write_bytes(b"x" * (1024 * 1024))

    # Directory mtimes can collide on fast filesystems, making the eviction
    # order nondeterministic; pin distinct ages so `old` is evicted first.
    now = time.time()
    os.utime(old, (now, now))
    os.utime(newer, (now, now + 10))
    os.utime(keep, (now, now + 20))

    _enforce_cache_quota(tmp_path, keep)

    assert not old.exists()
    assert newer.exists()
    assert keep.exists()
