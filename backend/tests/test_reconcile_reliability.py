from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from pathlib import Path

import pytest

from vault_search.config import SearchConfig
from vault_search.database import compute_hash, init_db
from vault_search.indexing import OPERATION_ARTIFACT, IndexManager
from vault_search.model_manager import ModelManager
from vault_search.search import SearchEngine


def _manager(tmp_path: Path) -> tuple[SearchConfig, ModelManager, IndexManager]:
    vault = tmp_path / "vault"
    vault.mkdir()
    data = tmp_path / "data"
    (data / "index").mkdir(parents=True)
    config = SearchConfig(
        vault_path=vault, data_dir=data, model_id="__fake__",
        include_globs=["**/*.md"], exclude_globs=[],
    )
    model = ModelManager(config)
    model.load()
    return config, model, IndexManager(config, model, None)


def _pending(config: SearchConfig) -> list[tuple[str, str]]:
    connection = sqlite3.connect(str(config.db_path))
    try:
        return connection.execute(
            "SELECT file_path, operation FROM pending_paths ORDER BY file_path").fetchall()
    finally:
        connection.close()


def test_state_schema_migration_replaces_only_database(tmp_path: Path):
    config, _model, manager = _manager(tmp_path)
    connection = sqlite3.connect(str(config.db_path))
    connection.executescript("""
        CREATE TABLE file_state (
            file_path TEXT PRIMARY KEY,
            file_hash TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            indexed_at REAL NOT NULL
        );
    """)
    connection.commit()
    connection.close()
    config.vector_path.write_bytes(b"vector-generation")
    config.metadata_path.write_bytes(b'{"index_generation":"same"}')
    vector_hash = hashlib.sha256(config.vector_path.read_bytes()).hexdigest()
    metadata = config.metadata_path.read_bytes()

    assert manager.ensure_state_schema() == {"migrated": True}
    assert hashlib.sha256(config.vector_path.read_bytes()).hexdigest() == vector_hash
    assert config.metadata_path.read_bytes() == metadata
    connection = sqlite3.connect(str(config.db_path))
    try:
        columns = {row[1]: row for row in connection.execute("PRAGMA table_info(file_state)")}
        assert columns["file_size"][2:4] == ("INTEGER", 1)
        assert columns["modified_ns"][2:4] == ("INTEGER", 1)
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE name='pending_paths'").fetchone()
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
    finally:
        connection.close()


def test_future_state_schema_is_rejected_without_downgrade(tmp_path: Path):
    config, _model, manager = _manager(tmp_path)
    (config.vault_path / "note.md").write_text("future schema body", encoding="utf-8")
    manager.rebuild_all()
    connection = sqlite3.connect(str(config.db_path))
    connection.execute("PRAGMA user_version=3")
    connection.commit()
    connection.close()
    before = hashlib.sha256(config.db_path.read_bytes()).hexdigest()

    result = manager.ensure_state_schema()
    assert result["rebuild_required"] is True
    assert "future state schema version 3" in result["reason"]
    assert hashlib.sha256(config.db_path.read_bytes()).hexdigest() == before
    with pytest.raises(RuntimeError, match="future state schema version 3"):
        init_db(config.db_path)
    # rebuild_all archives the unreadable DB and rebuilds from the vault
    # instead of being blocked forever by the future schema.
    rebuilt = manager.rebuild_all()
    assert rebuilt["files"] == 1
    assert list(config.index_dir.glob("chunks.db.unreadable-*.bak"))
    connection = sqlite3.connect(str(config.db_path))
    try:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0] == 1
    finally:
        connection.close()


def test_fast_reconcile_does_not_read_unchanged_bodies(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, _model, manager = _manager(tmp_path)
    for index in range(3):
        (config.vault_path / f"note-{index}.md").write_text(f"body {index}", encoding="utf-8")
    manager.rebuild_all()
    reads = 0
    original = Path.read_text

    def counted(path: Path, *args, **kwargs):
        nonlocal reads
        if path.suffix == ".md":
            reads += 1
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counted)
    result = manager.reconcile(mode="fast")
    assert result["changed"] == 0
    assert reads == 0


def test_fast_reconcile_mtime_only_change_updates_stat_without_embedding(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("same body", encoding="utf-8")
    manager.rebuild_all()
    before = note.stat()
    os.utime(note, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000))
    encoded = 0
    original = model.encode_documents

    def counted(texts: list[str], show_progress: bool = False):
        nonlocal encoded
        encoded += len(texts)
        return original(texts, show_progress)

    monkeypatch.setattr(model, "encode_documents", counted)
    manager.reconcile(mode="fast")
    assert encoded == 0
    connection = sqlite3.connect(str(config.db_path))
    try:
        size, modified_ns = connection.execute(
            "SELECT file_size, modified_ns FROM file_state WHERE file_path='note.md'").fetchone()
    finally:
        connection.close()
    assert (size, modified_ns) == (note.stat().st_size, note.stat().st_mtime_ns)


def test_strict_reconcile_hashes_every_current_file(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, _model, manager = _manager(tmp_path)
    for index in range(4):
        (config.vault_path / f"note-{index}.md").write_text(f"body {index}", encoding="utf-8")
    manager.rebuild_all()
    reads = 0
    original = Path.read_text

    def counted(path: Path, *args, **kwargs):
        nonlocal reads
        if path.suffix == ".md":
            reads += 1
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counted)
    manager.reconcile(mode="strict")
    assert reads == 4


def test_pending_path_is_removed_after_success(tmp_path: Path):
    config, _model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("old", encoding="utf-8")
    manager.rebuild_all()
    note.write_text("new", encoding="utf-8")
    manager.sync_paths(["note.md"], [])
    assert _pending(config) == []


def test_more_than_1000_pending_paths_are_recovered_in_real_batches(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, _model, manager = _manager(tmp_path)
    manager.rebuild_all()
    connection = sqlite3.connect(str(config.db_path))
    connection.executemany(
        "INSERT INTO pending_paths (file_path, operation, queued_at) VALUES (?, 'deleted', 0)",
        [(f"missing-{index}.md",) for index in range(1001)],
    )
    connection.commit()
    connection.close()
    from vault_search import indexing
    original_delete = indexing.delete_files
    batch_sizes: list[int] = []
    strict_calls: list[str] = []
    original_reconcile = manager.reconcile

    def counted_delete(connection, paths):
        batch_sizes.append(len(paths))
        return original_delete(connection, paths)

    monkeypatch.setattr(indexing, "delete_files", counted_delete)
    def counted_reconcile(mode="fast"):
        strict_calls.append(mode)
        return original_reconcile(mode)

    monkeypatch.setattr(manager, "reconcile", counted_reconcile)
    result = manager.recover_pending_paths()
    assert result["pending_escalated"] == 1001
    assert result["recovered"] == 1001
    assert _pending(config) == []
    assert batch_sizes == [400, 400, 201]
    assert strict_calls == ["strict"]


def test_pending_path_survives_failure_and_restart_recovery(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, _model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("old", encoding="utf-8")
    manager.rebuild_all()
    note.write_text("recovered body", encoding="utf-8")

    def fail_install(_pairs, _validate):
        raise RuntimeError("forced install failure")

    with monkeypatch.context() as context:
        context.setattr(manager, "_atomic_replace", fail_install)
        with pytest.raises(RuntimeError, match="forced install failure"):
            manager.sync_paths(["note.md"], [])
    assert _pending(config) == [("note.md", "changed")]
    assert note.exists()

    restarted = IndexManager(config, manager.model, None)
    result = restarted.recover_pending_paths()
    assert result["changed"] == 1, result
    assert result["added_chunks"] == 1, result
    assert result["recovered"] == 1
    assert _pending(config) == []
    connection = sqlite3.connect(str(config.db_path))
    try:
        rows = connection.execute("SELECT file_path, content FROM chunks").fetchall()
        assert rows == [("note.md", "recovered body")], rows
    finally:
        connection.close()


def test_atomic_replace_validation_failure_restores_all_targets(tmp_path: Path):
    targets = [tmp_path / f"target-{index}" for index in range(3)]
    sources = [tmp_path / f"source-{index}" for index in range(3)]
    for index, target in enumerate(targets):
        target.write_text(f"old-{index}", encoding="utf-8")
        sources[index].write_text(f"new-{index}", encoding="utf-8")

    with pytest.raises(RuntimeError, match="forced validation"):
        IndexManager._atomic_replace(
            list(zip(sources, targets)), lambda: ["forced validation"])
    assert [target.read_text(encoding="utf-8") for target in targets] == [
        "old-0", "old-1", "old-2"]


def test_atomic_replace_second_install_failure_restores_all_targets(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    targets = [tmp_path / f"target-{index}" for index in range(3)]
    sources = [tmp_path / f"source-{index}" for index in range(3)]
    for index, target in enumerate(targets):
        target.write_text(f"old-{index}", encoding="utf-8")
        sources[index].write_text(f"new-{index}", encoding="utf-8")
    original = os.replace

    def fail_second(source, target):
        if Path(source) == sources[1]:
            raise OSError("forced second install failure")
        return original(source, target)

    monkeypatch.setattr(os, "replace", fail_second)
    with pytest.raises(OSError, match="forced second install"):
        IndexManager._atomic_replace(list(zip(sources, targets)), lambda: [])
    assert [target.read_text(encoding="utf-8") for target in targets] == [
        "old-0", "old-1", "old-2"]


def test_backup_cleanup_failure_keeps_validated_targets(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    target = tmp_path / "target.db"
    source = tmp_path / "source.db"
    target.write_text("old", encoding="utf-8")
    source.write_text("new", encoding="utf-8")
    original = Path.unlink

    def fail_backup(path: Path, *args, **kwargs):
        if ".backup." in path.name:
            raise OSError("forced cleanup failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_backup)
    IndexManager._atomic_replace([(source, target)], lambda: [])
    assert target.read_text(encoding="utf-8") == "new"
    backups = list(tmp_path.glob("target.db.backup.*"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == "old"


@pytest.mark.parametrize("crash_stage", range(1, 7))
def test_startup_recovers_prior_generation_after_each_replace_stage(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch, crash_stage: int):
    operation_dir = tmp_path / f"stage-{crash_stage}"
    operation_dir.mkdir()
    targets = [operation_dir / f"target-{index}" for index in range(3)]
    sources = [operation_dir / f"source-{index}" for index in range(3)]
    for index, target in enumerate(targets):
        target.write_text(f"old-{index}", encoding="utf-8")
        sources[index].write_text(f"new-{index}", encoding="utf-8")
    original = os.replace
    stage = 0

    class SimulatedCrash(BaseException):
        pass

    def crash_after_stage(source, target):
        nonlocal stage
        result = original(source, target)
        source_path = Path(source)
        target_path = Path(target)
        if ".backup." in target_path.name or source_path in sources:
            stage += 1
            if stage == crash_stage:
                raise SimulatedCrash()
        return result

    monkeypatch.setattr(os, "replace", crash_after_stage)
    with pytest.raises(SimulatedCrash):
        IndexManager._atomic_replace(list(zip(sources, targets)), lambda: [])
    assert IndexManager.recover_interrupted_replace(operation_dir) is True
    assert [target.read_text(encoding="utf-8") for target in targets] == [
        "old-0", "old-1", "old-2"]
    assert not (operation_dir / "replace-operation.json").exists()


def test_startup_recovery_restores_absent_generation_on_first_build_crash(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    sources = [tmp_path / f"source-{index}" for index in range(3)]
    targets = [tmp_path / f"target-{index}" for index in range(3)]
    for index, source in enumerate(sources):
        source.write_text(f"new-{index}", encoding="utf-8")
    original = os.replace

    class SimulatedCrash(BaseException):
        pass

    def crash_after_first_install(source, target):
        result = original(source, target)
        if Path(source) == sources[0]:
            raise SimulatedCrash()
        return result

    monkeypatch.setattr(os, "replace", crash_after_first_install)
    with pytest.raises(SimulatedCrash):
        IndexManager._atomic_replace(list(zip(sources, targets)), lambda: [])
    assert IndexManager.recover_interrupted_replace(tmp_path) is True
    assert not any(target.exists() for target in targets)


def test_stale_cleanup_protects_manifest_references_before_recovery(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    operation_id = "b" * 32
    targets = [tmp_path / f"target-{index}" for index in range(3)]
    sources = [tmp_path / f"source-{index}" for index in range(3)]
    for index, target in enumerate(targets):
        target.write_text(f"old-{index}", encoding="utf-8")
        sources[index].write_text(f"new-{index}", encoding="utf-8")
    original = os.replace

    class SimulatedCrash(BaseException):
        pass

    def crash_after_first_backup(source, target):
        result = original(source, target)
        if ".backup." in Path(target).name:
            raise SimulatedCrash()
        return result

    monkeypatch.setattr(os, "replace", crash_after_first_backup)
    with pytest.raises(SimulatedCrash):
        IndexManager._atomic_replace(list(zip(sources, targets)), lambda: [])
    manifest = tmp_path / "replace-operation.json"
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    referenced = {
        str(entry[key]) for entry in payload["entries"]
        for key in ("source", "backup")
    }
    existing_referenced = {name for name in referenced if (tmp_path / name).exists()}
    stale = [
        tmp_path / f"orphan.{operation_id}.tmp",
        tmp_path / f"orphan.backup.{operation_id}",
    ]
    for path in stale:
        path.write_text("stale", encoding="utf-8")

    removed = IndexManager.cleanup_stale_operation_artifacts(tmp_path)
    assert sorted(path.name for path in stale) == removed
    assert manifest.exists()
    assert all((tmp_path / name).exists() for name in existing_referenced)

    assert IndexManager.recover_interrupted_replace(tmp_path) is True
    assert IndexManager.cleanup_stale_operation_artifacts(tmp_path) == []
    assert [target.read_text(encoding="utf-8") for target in targets] == [
        "old-0", "old-1", "old-2"]


def test_manifest_write_failure_cleans_manifest_temp(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    target = tmp_path / "target"
    source = tmp_path / "source"
    target.write_text("old", encoding="utf-8")
    source.write_text("new", encoding="utf-8")
    original = os.replace

    def fail_manifest_install(source_path, target_path):
        if Path(target_path).name == "replace-operation.json":
            raise OSError("manifest install failed")
        return original(source_path, target_path)

    monkeypatch.setattr(os, "replace", fail_manifest_install)
    with pytest.raises(OSError, match="manifest install failed"):
        IndexManager._atomic_replace([(source, target)], lambda: [])
    assert list(tmp_path.glob("replace-operation.json.*.tmp")) == []
    assert target.read_text(encoding="utf-8") == "old"
    assert source.read_text(encoding="utf-8") == "new"


@pytest.mark.parametrize("operation", ["rebuild", "sync"])
def test_repeated_transient_read_failures_do_not_grow_temp_artifacts(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch, operation: str):
    config, _model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("stable initial body", encoding="utf-8")
    if operation == "sync":
        manager.rebuild_all()
        note.write_text("changed body before failure", encoding="utf-8")

    def fail_read(_target):
        raise RuntimeError("transient read failure")

    monkeypatch.setattr(manager, "_read_stable", fail_read)
    for _ in range(3):
        with pytest.raises(RuntimeError, match="transient read failure"):
            if operation == "rebuild":
                manager.rebuild_all()
            else:
                manager.sync_paths(["note.md"], [])
        artifacts = [path.name for path in config.index_dir.iterdir()
                     if OPERATION_ARTIFACT.search(path.name)]
        assert artifacts == []


@pytest.mark.parametrize("operation", ["rebuild", "sync", "reconcile"])
def test_mutation_during_read_retries_to_one_stable_snapshot(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch, operation: str):
    config, _model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("initial stable body", encoding="utf-8")
    if operation != "rebuild":
        manager.rebuild_all()
        note.write_text("body before mutation", encoding="utf-8")
    original = Path.read_text
    mutated = False

    def mutate_once(path: Path, *args, **kwargs):
        nonlocal mutated
        text = original(path, *args, **kwargs)
        if path == note and not mutated:
            mutated = True
            path.write_text("final stable body after mutation", encoding="utf-8")
        return text

    monkeypatch.setattr(Path, "read_text", mutate_once)
    if operation == "rebuild":
        manager.rebuild_all()
    elif operation == "sync":
        manager.sync_paths(["note.md"], [])
    else:
        manager.reconcile(mode="strict")

    final_text = "final stable body after mutation"
    stat = note.stat()
    connection = sqlite3.connect(str(config.db_path))
    try:
        content = connection.execute(
            "SELECT content FROM chunks WHERE file_path='note.md'").fetchone()[0]
        file_hash, file_size, modified_ns = connection.execute(
            "SELECT file_hash, file_size, modified_ns FROM file_state WHERE file_path='note.md'"
        ).fetchone()
    finally:
        connection.close()
    assert content == final_text
    assert file_hash == compute_hash(final_text)
    assert (file_size, modified_ns) == (stat.st_size, stat.st_mtime_ns)


def test_2000_unchanged_files_require_zero_body_reads(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, _model, manager = _manager(tmp_path)
    for index in range(2000):
        (config.vault_path / f"note-{index:04d}.md").write_text(
            f"body {index}", encoding="utf-8")
    manager.rebuild_all()
    reads = 0
    original = Path.read_text

    def counted(path: Path, *args, **kwargs):
        nonlocal reads
        if path.suffix == ".md":
            reads += 1
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counted)
    result = manager.reconcile(mode="fast")
    assert result["scanned"] == 2000
    assert reads == 0


def test_create_modify_rename_delete_smoke(tmp_path: Path):
    config, _model, manager = _manager(tmp_path)
    manager.rebuild_all()
    created = config.vault_path / "created.md"
    created.write_text("created body", encoding="utf-8")
    assert manager.sync_paths(["created.md"], [])["changed"] == 1
    created.write_text("modified body", encoding="utf-8")
    assert manager.sync_paths(["created.md"], [])["changed"] == 1
    renamed = config.vault_path / "renamed.md"
    created.rename(renamed)
    manager.sync_paths(["renamed.md"], ["created.md"])
    renamed.unlink()
    manager.sync_paths([], ["renamed.md"])
    connection = sqlite3.connect(str(config.db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0
    finally:
        connection.close()


def test_forced_post_install_validation_restores_searchable_generation(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    config, model, manager = _manager(tmp_path)
    note = config.vault_path / "note.md"
    note.write_text("oldgeneration", encoding="utf-8")
    manager.rebuild_all()
    old_generation = SearchEngine(config, model, None).search("oldgeneration", top_k=5)
    assert old_generation
    note.write_text("newgeneration", encoding="utf-8")
    atomic_replace = manager._atomic_replace

    def force_validation(pairs, _validate):
        return atomic_replace(pairs, lambda: ["forced generation validation"])

    monkeypatch.setattr(manager, "_atomic_replace", force_validation)
    with pytest.raises(RuntimeError, match="forced generation validation"):
        manager.sync_paths(["note.md"], [])
    results = SearchEngine(config, model, None).search("oldgeneration", top_k=5)
    assert results and results[0]["file_path"] == "note.md"
