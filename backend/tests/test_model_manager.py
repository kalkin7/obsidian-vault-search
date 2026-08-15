from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from vault_search.config import SearchConfig
from vault_search.model_manager import ModelManager


class LocalEntryNotFoundError(Exception):
    pass


def _config(tmp_path: Path, *, model_id: str = "example/model") -> SearchConfig:
    return SearchConfig(
        vault_path=tmp_path / "vault",
        data_dir=tmp_path / "data",
        model_id=model_id,
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


def test_resolve_expected_device_before_load(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The pre-load device resolves from config + runtime so idle/loading
    status reports the real device instead of a hardcoded 'cpu'."""
    cfg = _config(tmp_path, model_id="__fake__")

    cfg.device = "cpu"
    assert ModelManager(cfg).device == "cpu"

    # Explicit cuda reports intent even when the runtime lacks CUDA: the
    # failure surfaces as a load error, not a misleading 'cpu' report.
    cfg.device = "cuda"
    assert ModelManager(cfg).device == "cuda"

    # auto + pytorch with torch.cuda unavailable -> cpu
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
    )
    cfg.device = "auto"
    cfg.engine = "pytorch"
    assert ModelManager(cfg).device == "cpu"

    # auto + onnx with a CUDA-capable EP -> cuda
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            get_available_providers=lambda: [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        ),
    )
    cfg.engine = "onnx"
    assert ModelManager(cfg).device == "cuda"

    # expected_provider mirrors the device resolution for the ONNX engine
    cfg.provider = "auto"
    assert ModelManager(cfg).expected_provider() == "CUDAExecutionProvider"
    cfg.device = "cpu"
    assert ModelManager(cfg).expected_provider() == "CPUExecutionProvider"
    cfg.engine = "pytorch"
    assert ModelManager(cfg).expected_provider() is None


def test_load_prefers_local_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
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


def test_load_onnx_builds_direct_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
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
        lambda name: name != "onnxruntime" or True,
    )
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            get_available_providers=lambda: [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    manager.load()

    assert built[0]["model_dir"] == str(tmp_path / "snap")
    assert built[0]["provider"] == "auto"
    assert built[0]["normalize_embeddings"] is True
    assert str(built[0]["trt_cache_dir"]) == str(tmp_path / "data" / "trt-cache")
    assert built[0]["trt_max_batch"] == 64
    assert manager.device == "cuda"
    assert manager.dimension == 768


def test_load_onnx_builds_cpu_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    built: list[dict[str, object]] = []

    class DirectLoader:
        def __init__(self, model_dir, provider=None, **kwargs):
            built.append({"provider": provider})
            self.dimension = 768
            self.provider = "CPUExecutionProvider"

        def encode(self, texts, batch_size=32):
            import numpy as np

            count = 1 if isinstance(texts, str) else len(texts)
            return np.zeros((count, 768), dtype=np.float32)

    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"]),
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cpu"
    manager = ModelManager(cfg)

    manager.load()

    assert built[0]["provider"] == "cpu"
    assert manager.device == "cpu"
    assert manager.dimension == 768
    assert manager.effective_provider() == "CPUExecutionProvider"


def test_load_onnx_auto_falls_back_to_cpu(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    built: list[dict[str, object]] = []

    class DirectLoader:
        def __init__(self, model_dir, provider=None, **kwargs):
            built.append({"provider": provider})
            self.dimension = 768

    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"]),
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "auto"
    manager = ModelManager(cfg)

    manager.load()

    assert built[0]["provider"] == "cpu"
    assert manager.device == "cpu"


def test_load_onnx_auto_retries_cpu_on_session_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    attempts: list[str] = []

    class DirectLoader:
        def __init__(self, model_dir, provider: str = "cpu", **kwargs):
            attempts.append(provider)
            if provider != "cpu":
                raise RuntimeError("CUDA session creation failed")
            self.dimension = 768
            self.provider = "CPUExecutionProvider"

        def encode(self, texts, batch_size=32):
            import numpy as np

            count = 1 if isinstance(texts, str) else len(texts)
            return np.zeros((count, 768), dtype=np.float32)

    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            get_available_providers=lambda: [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "auto"
    manager = ModelManager(cfg)

    manager.load()

    assert attempts == ["auto", "cpu"]
    assert manager.device == "cpu"
    assert manager.effective_provider() == "CPUExecutionProvider"


def test_load_onnx_cuda_explicit_does_not_fall_back(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    attempts: list[str] = []

    class DirectLoader:
        def __init__(self, model_dir, provider: str = "cpu", **kwargs):
            attempts.append(provider)
            raise RuntimeError("CUDA session creation failed")

    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            get_available_providers=lambda: [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    with pytest.raises(RuntimeError, match="CUDA session creation failed"):
        manager.load()
    assert attempts == ["auto"]


def test_load_onnx_requires_cuda_provider(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"]),
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    with pytest.raises(
        RuntimeError, match="requires a CUDA-capable execution provider"
    ):
        manager.load()


def test_load_onnx_requires_onnxruntime(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: False)
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)

    with pytest.raises(RuntimeError, match="onnxruntime is not installed"):
        manager.load()


def test_release_unloads_onnx_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    released = []

    class DirectLoader:
        def __init__(self, *args, **kwargs):
            self.dimension = 768

        def release(self):
            released.append(True)

    monkeypatch.setattr("vault_search.model_manager._is_importable", lambda name: True)
    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(
            get_available_providers=lambda: [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
        ),
    )
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir",
        lambda model_id: tmp_path / "snap",
    )
    monkeypatch.setitem(
        sys.modules,
        "vault_search.direct_onnx",
        SimpleNamespace(DirectE5Onnx=DirectLoader),
    )
    cfg = _config(tmp_path, model_id="intfloat/multilingual-e5-base")
    cfg.engine = "onnx"
    cfg.device = "cuda"
    manager = ModelManager(cfg)
    manager.load()
    assert manager.model is not None

    manager.release()

    assert released == [True]
    assert manager.model is None


def test_direct_onnx_rejects_non_normalized(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from vault_search.direct_onnx import DirectE5Onnx

    snapshot = tmp_path / "snap"
    (snapshot / "1_Pooling").mkdir(parents=True)
    (snapshot / "1_Pooling" / "config.json").write_text(
        '{"word_embedding_dimension": 768, "pooling_mode_mean_tokens": true}',
        encoding="utf-8",
    )
    (snapshot / "sentence_bert_config.json").write_text(
        '{"max_seq_length": 512, "do_lower_case": false}', encoding="utf-8"
    )

    with pytest.raises(RuntimeError, match="normalize_embeddings must be true"):
        DirectE5Onnx(snapshot, normalize_embeddings=False)
