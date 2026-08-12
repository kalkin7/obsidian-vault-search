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
