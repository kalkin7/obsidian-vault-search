from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.protocol import request
from vault_search.service import SearchService, ServiceError

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _start(tmp_path: Path, lazy: bool = False) -> tuple[subprocess.Popen[str], dict, Path]:
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    data = tmp_path / "data"
    config = tmp_path / "config.json"
    config.write_text(json.dumps({
        "vaultPath": str(vault), "dataDir": str(data), "modelId": "__fake__",
        "includeGlobs": ["**/*.md"], "excludeGlobs": [".obsidian/**"],
        "loadPolicy": "first-search" if lazy else "vault-open",
        "heartbeatTimeoutSeconds": 60,
    }), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    process = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-m", "vault_search", "serve",
         "--config", str(config), "--watch-stdin"],
        cwd=BACKEND_ROOT, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    runtime_path = data / "runtime.json"
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if runtime_path.exists():
            return process, json.loads(runtime_path.read_text(encoding="utf-8")), runtime_path
        if process.poll() is not None:
            raise AssertionError(process.stderr.read() if process.stderr else "backend exited")
        time.sleep(0.05)
    process.kill()
    raise AssertionError("runtime.json was not created")


def _wait_ready(runtime: dict, timeout: float = 10) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = request(runtime["host"], runtime["port"], runtime["token"], "status", timeout=1)
        if response["data"]["state"] in {"ready", "ready_no_index"}:
            return response["data"]
        if response["data"]["state"] == "error":
            raise AssertionError(response["data"]["error"])
        time.sleep(0.05)
    raise AssertionError("backend did not become ready")


def test_service_build_search_auth_and_shutdown(tmp_path: Path):
    process, runtime, runtime_path = _start(tmp_path)
    unauthorized = request(runtime["host"], runtime["port"], "wrong", "status")
    assert unauthorized["error"]["code"] == "UNAUTHORIZED"
    _wait_ready(runtime)
    rebuilt = request(runtime["host"], runtime["port"], runtime["token"], "rebuild_all", timeout=10)
    assert rebuilt["ok"] and rebuilt["data"]["files"] == 1
    searched = request(runtime["host"], runtime["port"], runtime["token"], "search",
                       {"query": "전기차 충전기", "top_k": 5}, timeout=5)
    assert searched["ok"] and searched["data"]["results"]
    request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
    process.wait(timeout=5)
    assert not runtime_path.exists()


def test_lazy_model_and_parent_eof(tmp_path: Path):
    process, runtime, runtime_path = _start(tmp_path, lazy=True)
    status = request(runtime["host"], runtime["port"], runtime["token"], "status")
    assert status["data"]["state"] == "idle"
    first = request(runtime["host"], runtime["port"], runtime["token"], "search", {"query": "전기차"})
    assert first["error"]["code"] == "MODEL_LOADING"
    _wait_ready(runtime)
    assert process.stdin is not None
    process.stdin.close()
    process.wait(timeout=5)
    assert not runtime_path.exists()


def test_invalid_match_mode_is_invalid_params(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ServiceError) as error:
        service.call("search", {"query": "test", "match_mode": "invalid"})
    assert error.value.code == "INVALID_PARAMS"
