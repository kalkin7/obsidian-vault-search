from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.database import init_db, insert_chunk
from vault_search.document_fields import METADATA_FIELD_LIMIT, METADATA_ITEM_LIMIT, extract_file_fields
from vault_search.indexing import IndexManager
from vault_search.model_manager import ModelManager
from vault_search.search import SearchEngine


def _config(tmp_path: Path) -> SearchConfig:
    data = tmp_path / "data"
    (data / "index").mkdir(parents=True)
    return SearchConfig(
        vault_path=tmp_path / "vault", data_dir=data, model_id="__fake__",
        chunking_strategy="markdown-v2", chunk_chars=80, chunk_overlap=0,
        vector_top_k=20, bm25_top_k=20, final_top_k=20,
    )


def _manager(tmp_path: Path) -> tuple[SearchConfig, ModelManager, IndexManager]:
    cfg = _config(tmp_path)
    cfg.vault_path.mkdir()
    model = ModelManager(cfg)
    model.load()
    return cfg, model, IndexManager(cfg, model, None)


def _search(cfg: SearchConfig, model: ModelManager, query: str) -> list[dict]:
    return SearchEngine(cfg, model, None).search(query, top_k=20, verbose=True)


def _lexical_snapshot(path: Path) -> tuple[list[tuple], list[tuple], list[tuple]]:
    connection = sqlite3.connect(str(path))
    try:
        files = connection.execute(
            "SELECT file_path, basename_tokens, directory_tokens, alias_tokens, tag_tokens,"
            " property_tokens FROM file_fields ORDER BY file_path").fetchall()
        headings = connection.execute(
            "SELECT chunks.file_path, chunks.chunk_index, chunk_headings_fts.heading_tokens "
            "FROM chunk_headings_fts JOIN chunks ON chunks.id=chunk_headings_fts.rowid "
            "ORDER BY chunks.file_path, chunks.chunk_index").fetchall()
        bodies = connection.execute(
            "SELECT chunks.file_path, chunks.chunk_index, chunks_fts.tokens "
            "FROM chunks_fts JOIN chunks ON chunks.id=chunks_fts.rowid "
            "ORDER BY chunks.file_path, chunks.chunk_index").fetchall()
        return files, headings, bodies
    finally:
        connection.close()


def test_alias_frontmatter_inline_tags_and_properties_are_searchable(tmp_path: Path):
    cfg, model, manager = _manager(tmp_path)
    (cfg.vault_path / "metadata.md").write_text(
        "---\nAliases: [별칭검색어, 별칭검색어]\nTags: [앞태그]\n"
        "project:\n  owner: 담당자값\nmembers: [목록하나, 목록둘]\n"
        "position: machinery-secret\n---\n# 섹션\n\n본문 #인라인태그 #인라인태그",
        encoding="utf-8",
    )
    manager.rebuild_all()

    for query in ("별칭검색어", "앞태그", "인라인태그", "project", "담당자값", "목록둘"):
        result = next(item for item in _search(cfg, model, query)
                      if item["file_path"] == "metadata.md")
        assert "file" in result["channels"]

    connection = sqlite3.connect(str(cfg.db_path))
    try:
        aliases, tags, properties = connection.execute(
            "SELECT alias_tokens, tag_tokens, property_tokens FROM file_fields"
        ).fetchone()
        assert aliases.split().count("별칭검색어") == 1
        assert tags.split().count("인라인태그") == 1
        assert "machinery" not in properties and "secret" not in properties
    finally:
        connection.close()


def test_invalid_yaml_does_not_stop_other_files_and_logs_path_only(
        tmp_path: Path, caplog) -> None:
    cfg, _model, manager = _manager(tmp_path)
    (cfg.vault_path / "broken.md").write_text(
        "---\naliases: [private-frontmatter-value\n---\nbroken body", encoding="utf-8")
    (cfg.vault_path / "valid.md").write_text("valid searchable body", encoding="utf-8")
    with caplog.at_level(logging.WARNING):
        result = manager.rebuild_all()
    assert result["files"] == 2
    assert "broken.md" in caplog.text
    assert "private-frontmatter-value" not in caplog.text


def test_alias_tag_bounds_and_nested_machinery_keys_are_excluded():
    aliases = ", ".join(f"alias{index:04d}" for index in range(400))
    inline_tags = " ".join(f"#tag{index:04d}" for index in range(400))
    fields = extract_file_fields(
        "bounded.md",
        f"---\naliases: [{aliases}]\nouter:\n  position: hidden-value\n"
        f"  valid: visible-value\n---\n{inline_tags}", None)
    assert len(fields.aliases) <= METADATA_ITEM_LIMIT
    assert len(" ".join(fields.aliases)) <= METADATA_FIELD_LIMIT
    assert len(fields.tags) <= METADATA_ITEM_LIMIT
    assert len(" ".join(fields.tags)) <= METADATA_FIELD_LIMIT
    assert "position" not in fields.properties
    assert "hidden" not in fields.properties and "value" in fields.properties


def test_heading_match_returns_the_matching_chunk_id(tmp_path: Path):
    cfg = _config(tmp_path)
    connection = init_db(cfg.db_path)
    try:
        first = insert_chunk(connection, "headings.md", 0, "first body", ["first"],
                             ("first heading",), heading_tokens=["first", "heading"])
        matching = insert_chunk(connection, "headings.md", 1, "matching body", ["matching"],
                                ("target heading",), heading_tokens=["target", "heading"])
        connection.commit()
        rows = SearchEngine(cfg, model=None, kiwi=None)._heading_rows(  # type: ignore[arg-type]
            connection, ["target"])
        assert rows[0][0] == matching
        assert rows[0][0] != first
    finally:
        connection.close()


def test_rename_removes_all_old_file_and_chunk_fts_rows(tmp_path: Path):
    cfg, _model, manager = _manager(tmp_path)
    old = cfg.vault_path / "old.md"
    old.write_text("---\nalias: old-alias\n---\n# Old heading\n\nold body", encoding="utf-8")
    manager.rebuild_all()
    new = cfg.vault_path / "new.md"
    old.rename(new)
    manager.sync_paths(["new.md"], ["old.md"])

    connection = sqlite3.connect(str(cfg.db_path))
    try:
        for table in ("file_state", "file_fields", "chunks"):
            assert connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE file_path='old.md'").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM chunks_fts LEFT JOIN chunks ON chunks.id=chunks_fts.rowid "
            "WHERE chunks.id IS NULL").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM chunk_headings_fts LEFT JOIN chunks "
            "ON chunks.id=chunk_headings_fts.rowid WHERE chunks.id IS NULL").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM file_fields_fts LEFT JOIN file_fields "
            "ON file_fields.rowid=file_fields_fts.rowid WHERE file_fields.rowid IS NULL"
        ).fetchone()[0] == 0
    finally:
        connection.close()

    manager.sync_paths([], ["new.md"])
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM file_fields").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM file_fields_fts").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM chunk_headings_fts").fetchone()[0] == 0
    finally:
        connection.close()


def test_incremental_and_full_rebuild_have_identical_lexical_fields(tmp_path: Path):
    cfg, _model, manager = _manager(tmp_path)
    note = cfg.vault_path / "same.md"
    note.write_text("---\nalias: first\n---\n# First\n\nbody", encoding="utf-8")
    manager.rebuild_all()
    note.write_text(
        "---\nalias: second\ntags: [updated]\ninfo:\n  owner: person\n---\n"
        "# Changed\n\nnew body #inline", encoding="utf-8")
    manager.sync_paths(["same.md"], [])
    incremental = _lexical_snapshot(cfg.db_path)
    manager.rebuild_all()
    assert _lexical_snapshot(cfg.db_path) == incremental


def test_failed_lexical_migration_preserves_database_and_vector(
        tmp_path: Path, monkeypatch) -> None:
    cfg, _model, manager = _manager(tmp_path)
    (cfg.vault_path / "note.md").write_text("body", encoding="utf-8")
    manager.rebuild_all()
    connection = sqlite3.connect(str(cfg.db_path))
    connection.execute("DELETE FROM index_metadata WHERE key='lexical_schema_version'")
    connection.commit()
    connection.close()
    metadata = cfg.metadata_path.read_text(encoding="utf-8").replace(
        '  "lexical_schema_version": 2,\n', "")
    cfg.metadata_path.write_text(metadata, encoding="utf-8")
    before_db = hashlib.sha256(cfg.db_path.read_bytes()).hexdigest()
    before_vector = hashlib.sha256(cfg.vector_path.read_bytes()).hexdigest()

    def fail(*_args, **_kwargs):
        raise RuntimeError("forced migration failure")

    monkeypatch.setattr("vault_search.indexing.extract_file_fields", fail)
    result = manager.ensure_lexical_index()
    assert result["rebuild_required"] is True
    assert hashlib.sha256(cfg.db_path.read_bytes()).hexdigest() == before_db
    assert hashlib.sha256(cfg.vector_path.read_bytes()).hexdigest() == before_vector


def test_lexical_fast_path_rebuilds_missing_required_table(tmp_path: Path):
    cfg, _model, manager = _manager(tmp_path)
    (cfg.vault_path / "note.md").write_text("# Heading\n\nbody", encoding="utf-8")
    manager.rebuild_all()
    connection = sqlite3.connect(str(cfg.db_path))
    connection.execute("DROP TABLE file_fields_fts")
    connection.commit()
    connection.close()

    result = manager.ensure_lexical_index()
    assert result == {"migrated": True, "files": 1}
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM file_fields_fts").fetchone()[0] == 1
    finally:
        connection.close()


def test_lexical_fast_path_repairs_heading_rowid_bijection(tmp_path: Path):
    cfg, _model, manager = _manager(tmp_path)
    (cfg.vault_path / "note.md").write_text("# Heading\n\nbody", encoding="utf-8")
    manager.rebuild_all()
    connection = sqlite3.connect(str(cfg.db_path))
    chunk_id = int(connection.execute("SELECT id FROM chunks").fetchone()[0])
    connection.execute("DELETE FROM chunk_headings_fts WHERE rowid=?", (chunk_id,))
    connection.execute(
        "INSERT INTO chunk_headings_fts(rowid, heading_tokens) VALUES (999999, 'wrong')")
    connection.commit()
    connection.close()

    assert manager.ensure_lexical_index() == {"migrated": True, "files": 1}
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert connection.execute(
            "SELECT rowid FROM chunk_headings_fts ORDER BY rowid").fetchall() == [(chunk_id,)]
    finally:
        connection.close()


def test_rebuild_vectors_migrates_legacy_lexical_schema_first(tmp_path: Path):
    cfg, _model, manager = _manager(tmp_path)
    (cfg.vault_path / "note.md").write_text("# Heading\n\nbody", encoding="utf-8")
    manager.rebuild_all()
    metadata = json.loads(cfg.metadata_path.read_text(encoding="utf-8"))
    metadata.pop("lexical_schema_version")
    cfg.metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    connection = sqlite3.connect(str(cfg.db_path))
    connection.execute("DELETE FROM index_metadata WHERE key='lexical_schema_version'")
    connection.execute("DROP TABLE chunk_headings_fts")
    connection.execute("DROP TABLE file_fields_fts")
    connection.execute("DROP TABLE file_fields")
    connection.commit()
    connection.close()

    result = manager.rebuild_vectors()
    assert result["metadata"]["lexical_schema_version"] == 2
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM file_fields").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM chunk_headings_fts").fetchone()[0] == 1
    finally:
        connection.close()
