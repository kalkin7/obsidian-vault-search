from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.database import init_db
from vault_search.protocol import request
from vault_search.service import SearchService, ServiceError

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _start(tmp_path: Path, lazy: bool = False,
           stale_artifacts: list[str] | None = None) -> tuple[subprocess.Popen[str], dict, Path]:
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    data = tmp_path / "data"
    if stale_artifacts:
        index = data / "index"
        index.mkdir(parents=True)
        for name in stale_artifacts:
            (index / name).write_text("stale", encoding="utf-8")
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


def test_second_backend_for_same_data_dir_fails_cleanly(tmp_path: Path):
    process, runtime, _runtime_path = _start(tmp_path)
    config = tmp_path / "config.json"
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    second = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-m", "vault_search", "serve",
         "--config", str(config), "--watch-stdin"],
        cwd=BACKEND_ROOT, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    try:
        stdout, stderr = second.communicate(timeout=5)
        assert second.returncode == 2
        assert stdout == ""
        assert "Another Vault Search backend owns the data directory" in stderr
    finally:
        request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
        process.wait(timeout=5)


def test_backend_startup_removes_unreferenced_operation_artifacts(tmp_path: Path):
    operation_id = "a" * 32
    artifacts = [
        f"chunks.db.building.{operation_id}.tmp",
        f"metadata.json.building.{operation_id}.tmp.tmp",
        f"chunks.db.backup.{operation_id}",
    ]
    process, runtime, _runtime_path = _start(tmp_path, stale_artifacts=artifacts)
    try:
        index = tmp_path / "data" / "index"
        assert not any((index / name).exists() for name in artifacts)
    finally:
        request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
        process.wait(timeout=5)


def test_invalid_match_mode_is_invalid_params(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ServiceError) as error:
        service.call("search", {"query": "test", "match_mode": "invalid"})
    assert error.value.code == "INVALID_PARAMS"


def test_invalid_search_intent_is_invalid_params(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ServiceError) as error:
        service.call("search", {"query": "test", "intent": "invalid"})
    assert error.value.code == "INVALID_PARAMS"


def test_invalid_reconcile_mode_is_invalid_params(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    with pytest.raises(ServiceError) as error:
        service.call("reconcile", {"mode": "invalid"})
    assert error.value.code == "INVALID_PARAMS"


def test_reconcile_defaults_to_fast_and_forwards_mode(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    modes: list[str] = []
    service.index = SimpleNamespace(
        reconcile=lambda mode: modes.append(mode) or {"mode": mode})  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    assert service.call("reconcile", {}) == {"mode": "fast"}
    assert service.call("reconcile", {"mode": "strict"}) == {"mode": "strict"}
    assert modes == ["fast", "strict"]


def test_status_and_heartbeat_use_cached_counts_during_index_operation(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service._cached_counts = {"files": 7, "chunks": 11}
    service._count_available = True
    count_calls: list[tuple[int, bool]] = []

    def guarded_counts(_path):
        count_calls.append((threading.get_ident(), service._index_operation_active))
        assert service._index_operation_active is True
        return {"files": 8, "chunks": 12}

    monkeypatch.setattr("vault_search.service.index_counts", guarded_counts)

    def operation():
        failures: list[BaseException] = []

        def heartbeat_reader():
            try:
                for _ in range(100):
                    status = service.call("heartbeat", {})
                    assert status["files"] == 7
                    assert status["chunks"] == 11
            except BaseException as exc:
                failures.append(exc)

        reader = threading.Thread(target=heartbeat_reader)
        reader.start()
        reader.join(timeout=5)
        assert not reader.is_alive()
        assert failures == []
        return {"files": 8, "chunks": 12}

    result = service._run_index_operation("reconciling", operation)
    assert result == {"files": 8, "chunks": 12}
    assert service._cached_counts == {"files": 8, "chunks": 12}
    assert len(count_calls) == 1
    assert count_calls[0][1] is True


def test_future_schema_with_missing_tables_reports_controlled_incompatibility(tmp_path: Path):
    data = tmp_path / "data"
    index = data / "index"
    index.mkdir(parents=True)
    config = SearchConfig(vault_path=tmp_path, data_dir=data, model_id="__fake__")
    connection = sqlite3.connect(str(config.db_path))
    connection.executescript("""
        PRAGMA user_version=3;
        CREATE TABLE file_state (broken TEXT);
    """)
    connection.commit()
    connection.close()
    service = SearchService(config, lambda _event, _data: None)
    assert service.status()["count_available"] is False

    service.initialize()
    assert service.state == "ready"
    assert service.index_rebuild_reason == "Unsupported future state schema version 3"
    status = service.status()
    assert status["count_available"] is False
    assert status["files"] == 0 and status["chunks"] == 0
    with pytest.raises(ServiceError) as error:
        service.call("search", {"query": "test"})
    assert error.value.code == "INDEX_REBUILD_REQUIRED"


def test_pending_recovery_failure_keeps_service_ready_with_retry_warning(tmp_path: Path):
    events: list[tuple[str, dict]] = []
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    config.index_dir.mkdir(parents=True)
    connection = init_db(config.db_path)
    connection.execute(
        "INSERT INTO pending_paths (file_path, operation, queued_at)"
        " VALUES ('note.md', 'changed', 0)")
    connection.commit()
    connection.close()
    service = SearchService(config, lambda event, data: events.append((event, data)))
    service.state = "ready"

    def fail_recovery():
        raise OSError("transient sharing violation")

    service.index = SimpleNamespace(
        recover_pending_paths=fail_recovery,
        sync_paths=lambda _changed, _deleted: {"changed": 1, "deleted": 0},
    )  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    result = service._recover_pending_paths()
    assert result["retry_required"] is True
    assert service.state == "ready"
    assert service.status()["pending_recovery_required"] is True
    assert events[-1][0] == "warning"
    assert events[-1][1]["code"] == "PENDING_RECOVERY_RETRY_REQUIRED"
    connection = sqlite3.connect(str(config.db_path))
    try:
        assert connection.execute("SELECT file_path FROM pending_paths").fetchall() == [
            ("note.md",)]
    finally:
        connection.close()
    service.call("sync_paths", {"changed": ["note.md"], "deleted": []})
    assert service.status()["pending_recovery_required"] is False


def test_startup_lexical_migration_failure_routes_rebuild_required(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace()  # type: ignore[assignment]
    service.index_rebuild_reason = "Lexical migration failed"
    with pytest.raises(ServiceError) as error:
        service.call("search", {"query": "test"})
    assert error.value.code == "INDEX_REBUILD_REQUIRED"
