from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.model_manager import ModelManager


class LocalEntryNotFoundError(Exception):
    pass


def _config(tmp_path: Path) -> SearchConfig:
    return SearchConfig(
        vault_path=tmp_path / "vault",
        data_dir=tmp_path / "data",
        model_id="example/model",
        device="cpu",
    )


def _install_modules(monkeypatch: pytest.MonkeyPatch, loader: type) -> None:
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
    )
    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        SimpleNamespace(SentenceTransformer=loader),
    )


def test_load_prefers_local_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[dict[str, object]] = []

    class Loader:
        def __init__(self, _model_id: str, **kwargs: object):
            calls.append(kwargs)

        def get_embedding_dimension(self) -> int:
            return 768

    _install_modules(monkeypatch, Loader)
    manager = ModelManager(_config(tmp_path))

    manager.load()

    assert calls == [{"device": "cpu", "local_files_only": True}]
    assert manager.dimension == 768


def test_load_downloads_only_after_cache_miss(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[dict[str, object]] = []

    class Loader:
        def __init__(self, _model_id: str, **kwargs: object):
            calls.append(kwargs)
            if kwargs.get("local_files_only"):
                cause = LocalEntryNotFoundError("not cached")
                raise OSError("local model unavailable") from cause

        def get_embedding_dimension(self) -> int:
            return 768

    _install_modules(monkeypatch, Loader)
    manager = ModelManager(_config(tmp_path))

    manager.load()

    assert calls == [
        {"device": "cpu", "local_files_only": True},
        {"device": "cpu"},
    ]


def test_load_does_not_retry_other_model_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[dict[str, object]] = []

    class Loader:
        def __init__(self, _model_id: str, **kwargs: object):
            calls.append(kwargs)
            raise RuntimeError("model initialization failed")

    _install_modules(monkeypatch, Loader)
    manager = ModelManager(_config(tmp_path))

    with pytest.raises(RuntimeError, match="model initialization failed"):
        manager.load()

    assert calls == [{"device": "cpu", "local_files_only": True}]


def test_load_onnx_builds_direct_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    built: list[dict[str, object]] = []

    class DirectLoader:
        def __init__(self, model_dir, provider=None, **kwargs):
            built.append({"model_dir": str(model_dir), "provider": provider, **kwargs})
            self.dimension = 768

        def encode(self, texts, batch_size=32):
            import numpy as np
            count = 1 if isinstance(texts, str) else len(texts)
            return np.zeros((count, 768), dtype=np.float32)

    monkeypatch.setattr(
        "vault_search.model_manager._is_importable",
        lambda name: name != "onnxruntime" or True)
    monkeypatch.setitem(
        sys.modules, "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader))
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap")
    cfg = _config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    manager.load()

    assert built == [{
        "model_dir": str(tmp_path / "snap"),
        "provider": "CUDAExecutionProvider",
        "normalize_embeddings": True,
    }]
    assert manager.device == "cuda"
    assert manager.dimension == 768


def test_load_onnx_requires_cuda(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    cfg = _config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cpu"
    manager = ModelManager(cfg)

    with pytest.raises(RuntimeError, match="requires device=cuda"):
        manager.load()


def test_load_onnx_requires_onnxruntime(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "vault_search.model_manager._is_importable",
        lambda name: False)
    cfg = _config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    with pytest.raises(RuntimeError, match="onnxruntime is not installed"):
        manager.load()


def test_release_unloads_onnx_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    released = []

    class DirectLoader:
        def __init__(self, *args, **kwargs):
            self.dimension = 768

        def release(self):
            released.append(True)

    monkeypatch.setattr(
        "vault_search.model_manager._is_importable",
        lambda name: True)
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap")
    monkeypatch.setitem(
        sys.modules, "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader))
    cfg = _config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)
    manager.load()
    assert manager.model is not None

    manager.release()

    assert released == [True]
    assert manager.model is None
