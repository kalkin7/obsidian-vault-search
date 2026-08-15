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
from vault_search.runtime import default_data_dir
from vault_search.service import SearchService, ServiceError
import vault_search.cli as cli
from vault_search.cli import call_runtime

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

    def _drain_stdout() -> None:
        for _line in process.stdout or ():
            pass
    # The server emits every state transition on stdout. Without a reader the
    # pipe buffer fills and the server blocks on print(); drain it on a daemon
    # thread so shutdown can complete. stderr stays attached for diagnostics.
    threading.Thread(target=_drain_stdout, daemon=True).start()
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
    assert status["data"]["index_validation_state"] == "pending"
    first = request(runtime["host"], runtime["port"], runtime["token"], "search", {"query": "전기차"})
    assert first["error"]["code"] == "MODEL_LOADING"
    _wait_ready(runtime)
    assert process.stdin is not None
    process.stdin.close()
    process.wait(timeout=5)
    assert not runtime_path.exists()


def test_lazy_first_search_builds_index_and_retries_success(tmp_path: Path):
    process, runtime, runtime_path = _start(tmp_path, lazy=True)
    try:
        first = request(runtime["host"], runtime["port"], runtime["token"], "search",
                        {"query": "전기차"})
        assert first["error"]["code"] == "MODEL_LOADING"
        _wait_ready(runtime)
        rebuilt = request(runtime["host"], runtime["port"], runtime["token"],
                          "rebuild_all", timeout=10)
        assert rebuilt["ok"] and rebuilt["data"]["files"] == 1
        status = request(runtime["host"], runtime["port"], runtime["token"], "status")
        assert status["data"]["index_validation_state"] == "compatible"
        assert status["data"]["index_rebuild_required"] is False
        searched = request(runtime["host"], runtime["port"], runtime["token"], "search",
                           {"query": "전기차", "top_k": 5}, timeout=5)
        assert searched["ok"] and searched["data"]["results"]
    finally:
        request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
        process.wait(timeout=5)


def test_index_rebuild_required_exposes_cached_state(tmp_path: Path):
    process, runtime, runtime_path = _start(tmp_path)
    try:
        _wait_ready(runtime)
        status = request(runtime["host"], runtime["port"], runtime["token"], "status")
        assert status["data"]["index_validation_state"] == "incompatible"
        assert status["data"]["index_rebuild_required"] is True
        assert status["data"]["recommended_action"] == "rebuild_all"
        assert status["data"]["index_problems"]
        searched = request(runtime["host"], runtime["port"], runtime["token"], "search",
                           {"query": "전기차", "top_k": 5})
        assert searched["error"]["code"] == "INDEX_REBUILD_REQUIRED"
        assert searched["error"]["details"]["recommended_action"] == "rebuild_all"
    finally:
        request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
        process.wait(timeout=5)


def test_standalone_server_ignores_heartbeat_and_exits_on_idle(tmp_path: Path):
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
        "loadPolicy": "first-search", "heartbeatTimeoutSeconds": 5,
    }), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    process = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-m", "vault_search", "serve",
         "--config", str(config), "--owner", "standalone", "--lazy-model",
         "--idle-exit-seconds", "3"],
        cwd=BACKEND_ROOT, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")

    def _drain_stdout() -> None:
        for _line in process.stdout or ():
            pass
    threading.Thread(target=_drain_stdout, daemon=True).start()

    runtime_path = data / "runtime.json"
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if runtime_path.exists():
            break
        time.sleep(0.05)
    else:
        process.kill()
        raise AssertionError("runtime.json was not created")
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    try:
        assert runtime["owner"] == "standalone"
        # Heartbeat is not required for standalone: it must stay alive far
        # beyond the 5s heartbeat timeout as long as it is not idle.
        status = request(runtime["host"], runtime["port"], runtime["token"], "status")
        assert status["ok"]
        # No heartbeat sent; the idle-exit watcher should terminate the process
        # after ~3s of inactivity.
        process.wait(timeout=15)
        assert not runtime_path.exists()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_standalone_idle_exit_suppressed_during_rebuild(tmp_path: Path):
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
        "loadPolicy": "first-search", "heartbeatTimeoutSeconds": 5,
    }), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    process = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-m", "vault_search", "serve",
         "--config", str(config), "--owner", "standalone", "--lazy-model",
         "--idle-exit-seconds", "3"],
        cwd=BACKEND_ROOT, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")

    def _drain_stdout() -> None:
        for _line in process.stdout or ():
            pass
    threading.Thread(target=_drain_stdout, daemon=True).start()

    runtime_path = data / "runtime.json"
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if runtime_path.exists():
            break
        time.sleep(0.05)
    else:
        process.kill()
        raise AssertionError("runtime.json was not created")
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    try:
        # Keep the service busy with a long-ish operation well past the 3s
        # idle window; the watcher must not shut it down mid-operation.
        request(runtime["host"], runtime["port"], runtime["token"],
                "load_model", timeout=10)
        request(runtime["host"], runtime["port"], runtime["token"],
                "rebuild_all", timeout=15)
        time.sleep(2)
        assert process.poll() is None
        status = request(runtime["host"], runtime["port"], runtime["token"], "status")
        assert status["ok"] and status["data"]["state"] in {"ready", "ready_no_index"}
    finally:
        if process.poll() is None:
            request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_cli_spawn_standalone_and_attach(tmp_path: Path):
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    data = default_data_dir(vault)
    index = data / "index"
    index.mkdir(parents=True)
    config = data / "service-config.json"
    config.write_text(json.dumps({
        "vaultPath": str(vault), "dataDir": str(data), "modelId": "__fake__",
        "includeGlobs": ["**/*.md"], "excludeGlobs": [".obsidian/**"],
        "loadPolicy": "first-search", "heartbeatTimeoutSeconds": 60,
    }), encoding="utf-8")
    machine = data / "machine.json"
    machine.write_text(json.dumps({"pythonExecutable": sys.executable}), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cli, "_backend_root_for", lambda _vault: BACKEND_ROOT)
    try:
        runtime = cli._spawn_standalone(vault, timeout=20, idle_exit_seconds=0)
        assert runtime["owner"] == "standalone"
        # A second spawn must not win the ServiceLock; it either fails or a
        # runtime already exists. call_runtime must reach the first backend.
        try:
            cli._spawn_standalone(vault, timeout=5, idle_exit_seconds=0)
        except cli.ServiceUnavailable:
            pass
        status = call_runtime(vault, "status", {}, 10)
        assert status["ok"]
        request(runtime["host"], runtime["port"], runtime["token"], "shutdown")
    finally:
        monkeypatch.undo()


def test_rebuild_vectors_rejects_tokenizer_mismatch(tmp_path: Path):
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    config = SearchConfig(vault_path=vault, data_dir=tmp_path / "data", model_id="__fake__")
    config.index_dir.mkdir(parents=True, exist_ok=True)
    from vault_search.indexing import IndexManager
    from vault_search.model_manager import ModelManager
    model = ModelManager(config)
    model.load()
    index = IndexManager(config, model, None)
    index.rebuild_all()
    # Corrupt the tokenizer metadata to simulate a tokenizer change.
    import json
    metadata = json.loads(config.metadata_path.read_text(encoding="utf-8"))
    metadata["tokenizer_version"] = "some-other-tokenizer"
    config.metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(RuntimeError, match="rebuild_all"):
        index.rebuild_vectors()


def test_rebuild_vectors_rejects_scope_mismatch(tmp_path: Path):
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    config = SearchConfig(vault_path=vault, data_dir=tmp_path / "data", model_id="__fake__")
    config.index_dir.mkdir(parents=True, exist_ok=True)
    from vault_search.indexing import IndexManager
    from vault_search.model_manager import ModelManager
    model = ModelManager(config)
    model.load()
    index = IndexManager(config, model, None)
    index.rebuild_all()
    # Changing the scope hash forces rebuild_all, not a silent vector rebuild.
    config.include_globs = ["**/*.md", "extra/**"]
    with pytest.raises(RuntimeError, match="rebuild_all"):
        index.rebuild_vectors()


def test_rebuild_all_archives_future_schema_and_recovers(tmp_path: Path):
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text(
        "# 전기차 충전기\n\n전기차 충전기 설치 경과와 안전 검토 내용입니다.", encoding="utf-8")
    config = SearchConfig(vault_path=vault, data_dir=tmp_path / "data", model_id="__fake__")
    config.index_dir.mkdir(parents=True)
    connection = sqlite3.connect(str(config.db_path))
    connection.executescript("""
        PRAGMA user_version=3;
        CREATE TABLE file_state (broken TEXT);
    """)
    connection.commit()
    connection.close()
    from vault_search.indexing import IndexManager
    from vault_search.model_manager import ModelManager
    model = ModelManager(config)
    model.load()
    index = IndexManager(config, model, None)
    result = index.rebuild_all()
    assert result["files"] == 1 and result["chunks"] == 1
    assert list(config.index_dir.glob("chunks.db.unreadable-*.bak"))
    from vault_search.search import SearchEngine
    engine = SearchEngine(config, model, None)
    results = engine.search("전기차", top_k=5)
    assert results and results[0]["file_path"] == "notes/sample.md"


def test_listening_event_never_contains_token(tmp_path: Path):
    vault = tmp_path / "vault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "notes").mkdir()
    (vault / "notes" / "sample.md").write_text("# 전기차 충전기\n\n본문", encoding="utf-8")
    data = tmp_path / "data"
    config = tmp_path / "config.json"
    config.write_text(json.dumps({
        "vaultPath": str(vault), "dataDir": str(data), "modelId": "__fake__",
        "includeGlobs": ["**/*.md"], "excludeGlobs": [".obsidian/**"],
        "loadPolicy": "first-search", "heartbeatTimeoutSeconds": 60,
    }), encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_ROOT)
    process = subprocess.Popen(
        [sys.executable, "-X", "utf8", "-m", "vault_search", "serve",
         "--config", str(config), "--watch-stdin"],
        cwd=BACKEND_ROOT, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    try:
        runtime_path = data / "runtime.json"
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if runtime_path.exists():
                break
            time.sleep(0.05)
        runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
        token = runtime["token"]
        assert len(token) > 16
        first_line = process.stdout.readline()  # listening event
        assert token not in first_line
        assert "<redacted>" in first_line
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


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


def test_idle_unload_releases_model_after_timeout(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.model.model = object()  # fake a loaded model
    service.state = "ready"
    service.last_activity = time.monotonic() - 100
    service.config.model_idle_timeout_seconds = 5

    service._maybe_unload_if_idle()

    assert service.state == "idle"
    assert service.model.model is None
    assert service.search_engine is None
    assert service.index is None


def test_idle_unload_skips_recent_activity(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.model.model = object()
    service.state = "ready"
    service.last_activity = time.monotonic()
    service.config.model_idle_timeout_seconds = 5

    service._maybe_unload_if_idle()

    assert service.state == "ready"
    assert service.model.model is not None


def test_idle_unload_disabled_by_default(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.model.model = object()
    service.state = "ready"
    service.last_activity = time.monotonic() - 1000

    service._maybe_unload_if_idle()

    assert service.state == "ready"
    assert service.model.model is not None


def test_search_updates_last_activity(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.last_activity = time.monotonic() - 100
    service.index = SimpleNamespace()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(
        search_detailed=lambda query, **kwargs: SimpleNamespace(
            results=[], candidate_pool_size=0, requested_top_k=5, returned_count=0,
            to_dict=lambda: {"results": [], "diagnostics": {
                "candidate_pool_size": 0, "requested_top_k": 5, "returned_count": 0}})
    )  # type: ignore[assignment]
    (tmp_path / "data" / "index").mkdir(parents=True, exist_ok=True)
    (tmp_path / "data" / "index" / "chunks.db").write_text("", encoding="utf-8")

    service.call("search", {"query": "test"})

    assert time.monotonic() - service.last_activity < 1.0


def test_status_includes_capabilities(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service._capabilities = None

    status = service.status()

    assert set(status["capabilities"]) == {
        "onnx_available", "cuda_available", "tensorrt_available",
        "model_available", "derived_model_available"}
    assert set(status["capabilities"].values()) <= {True, False}


def test_provision_onnx_requires_onnx_engine(tmp_path: Path):
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)

    with pytest.raises(ServiceError) as error:
        service.provision_onnx()
    assert error.value.code == "INVALID_PARAMS"


def test_provision_onnx_generates_derived(monkeypatch, tmp_path: Path):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data",
        model_id="intfloat/multilingual-e5-base", engine="onnx")
    service = SearchService(config, lambda _event, _data: None)
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir", lambda model_id: tmp_path)
    target = tmp_path / "onnx" / "model-pooled-normalized.onnx"
    monkeypatch.setattr(
        "vault_search.onnx_provision.provision", lambda model_dir, verify_graph=True: target)

    result = service.provision_onnx()

    assert result["provisioned"] is True
    assert result["path"] == str(target)
    assert service._capabilities is None


def test_provision_onnx_model_not_found(monkeypatch, tmp_path: Path):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data",
        model_id="intfloat/multilingual-e5-base", engine="onnx")
    service = SearchService(config, lambda _event, _data: None)
    monkeypatch.setattr(
        "vault_search.model_manager._resolve_model_dir", lambda model_id: None)

    with pytest.raises(ServiceError) as error:
        service.provision_onnx()
    assert error.value.code == "MODEL_NOT_FOUND"
