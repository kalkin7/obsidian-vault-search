import hashlib
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np

from vault_search.config import SearchConfig
from vault_search.database import (
    init_db,
    insert_chunk,
    upsert_file_fields,
    upsert_file_state,
    write_index_metadata,
)
from vault_search.document_fields import extract_file_fields
from vault_search.index_metadata import (
    build_metadata,
    write_metadata,
)
from vault_search.indexing import IndexManager
from vault_search.model_manager import ModelManager
from vault_search.search import (
    SearchEngine,
    _coalesce_file_candidates,
    _file_candidate_ids,
    _fts_expression,
    select_diverse,
    weighted_rrf,
)


def config(tmp_path: Path, **overrides) -> SearchConfig:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "index").mkdir(parents=True, exist_ok=True)
    defaults = {"model_id": "__fake__"}
    defaults.update(overrides)
    return SearchConfig(vault_path=tmp_path, data_dir=data_dir, **defaults)


def _build_usearch(cfg: SearchConfig, model: ModelManager, ids: list[int],
                   contents: list[str] | None = None) -> Any:
    from usearch.index import Index
    vector_index = Index(ndim=int(model.dimension), metric="cos", dtype="f32")
    if ids:
        texts = contents or ["전기차 충전기 설치 경과 본문"]
        vectors = model.encode_documents(texts)
        if len(vectors) != len(ids):
            vectors = np.asarray([model.encode_documents([text])[0] for text in texts],
                                 dtype=np.float32)
        vector_index.add(np.asarray(ids, dtype=np.int64), vectors)
    vector_index.save(str(cfg.vector_path))
    return vector_index


def test_select_diverse_caps_chunks_per_file():
    ranked = [(1, 0.9), (2, 0.8), (3, 0.7), (4, 0.6)]
    rows = {
        1: ("a.md", "first"),
        2: ("a.md", "second"),
        3: ("b.md", "third"),
        4: ("c.md", "fourth"),
    }
    selected = select_diverse(ranked, rows, top_k=3, max_chunks_per_file=1)
    assert [chunk_id for chunk_id, _score in selected] == [1, 3, 4]


def test_weighted_rrf_tie_break_is_deterministic():
    channels = [
        ("body", [3, 1, 2], 1.0),
        ("vector", [3, 2], 1.0),
    ]
    ranked, sources = weighted_rrf(channels, k=60)
    chunk_ids = [chunk_id for chunk_id, _score in ranked]
    assert chunk_ids == [3, 2, 1]
    assert sources[3] == {"body", "vector"}
    assert sources[2] == {"body", "vector"}
    assert sources[1] == {"body"}


def test_weighted_rrf_dedupes_within_channel():
    channels = [("body", [5, 5, 6], 1.0)]
    ranked, _sources = weighted_rrf(channels, k=60)
    assert [chunk_id for chunk_id, _score in ranked] == [5, 6]
    score5 = next(score for chunk_id, score in ranked if chunk_id == 5)
    assert score5 == 1.0 / 61.0


def test_prefix_fallback_finds_partial_token(tmp_path: Path):
    cfg = config(tmp_path, prefix_fallback=True)
    connection = init_db(tmp_path / "prefix.db")
    try:
        chunk_id = insert_chunk(connection, "charge.md", 0, "충전시설", ["충전시설"])
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
        rows = engine._bm25(connection, ["충전"])
        assert [row[0] for row in rows] == [chunk_id]
    finally:
        connection.close()


def test_fts_match_mode_expressions():
    tokens = ["전기차", "충전", "시설"]
    assert _fts_expression(tokens, "any") == '"전기차" OR "충전" OR "시설"'
    assert _fts_expression(tokens, "all") == '"전기차" AND "충전" AND "시설"'
    assert _fts_expression(tokens, "phrase") == '"전기차 충전 시설"'
    assert _fts_expression(tokens, "all", prefix_last=True) == (
        '"전기차" AND "충전" AND "시설"*')
    assert _fts_expression([], "any") == ""


def test_any_all_and_phrase_match_modes(tmp_path: Path):
    cfg = config(tmp_path, prefix_fallback=False)
    connection = init_db(tmp_path / "modes.db")
    try:
        both = insert_chunk(connection, "both.md", 0, "alpha beta", ["alpha", "beta"])
        alpha = insert_chunk(connection, "alpha.md", 0, "alpha only", ["alpha", "only"])
        reverse = insert_chunk(connection, "reverse.md", 0, "beta alpha", ["beta", "alpha"])
        connection.commit()
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
        any_ids = {row[0] for row in engine._bm25(connection, ["alpha", "beta"], "any")}
        all_ids = {row[0] for row in engine._bm25(connection, ["alpha", "beta"], "all")}
        phrase_ids = {row[0] for row in engine._bm25(
            connection, ["alpha", "beta"], "phrase")}
        assert any_ids == {both, alpha, reverse}
        assert all_ids == {both, reverse}
        assert phrase_ids == {both}
    finally:
        connection.close()


def test_heading_and_file_channels_support_any_all_and_phrase(tmp_path: Path):
    cfg = config(tmp_path, prefix_fallback=False)
    connection = init_db(tmp_path / "field-modes.db")
    try:
        heading_phrase = insert_chunk(
            connection, "heading-phrase.md", 0, "body", ["body"],
            heading_tokens=["alpha", "beta"])
        heading_reverse = insert_chunk(
            connection, "heading-reverse.md", 0, "body", ["body"],
            heading_tokens=["beta", "alpha"])
        upsert_file_fields(connection, "file-phrase.md", ["alpha", "beta"], [], [], [], [])
        upsert_file_fields(connection, "file-alpha.md", ["alpha"], [], [], [], [])
        upsert_file_fields(connection, "file-reverse.md", ["beta", "alpha"], [], [], [], [])
        connection.commit()
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]

        assert {row[0] for row in engine._heading_rows(
            connection, ["alpha", "beta"], "any")} == {heading_phrase, heading_reverse}
        assert {row[0] for row in engine._heading_rows(
            connection, ["alpha", "beta"], "all")} == {heading_phrase, heading_reverse}
        assert [row[0] for row in engine._heading_rows(
            connection, ["alpha", "beta"], "phrase")] == [heading_phrase]

        assert {row[0] for row in engine._file_rows(
            connection, ["alpha", "beta"], "any")} == {
                "file-phrase.md", "file-alpha.md", "file-reverse.md"}
        assert {row[0] for row in engine._file_rows(
            connection, ["alpha", "beta"], "all")} == {
                "file-phrase.md", "file-reverse.md"}
        assert [row[0] for row in engine._file_rows(
            connection, ["alpha", "beta"], "phrase")] == ["file-phrase.md"]
    finally:
        connection.close()


def test_file_rows_prefers_basename_over_tags(tmp_path: Path):
    cfg = config(tmp_path)
    connection = init_db(tmp_path / "titles.db")
    try:
        upsert_file_fields(connection, "basename.md", ["검색어"], [], [], [], [])
        upsert_file_fields(connection, "tag.md", [], [], [], ["검색어"], [])
        connection.commit()
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
        rows = engine._file_rows(connection, ["검색어"])
        paths = [file_path for file_path, _score in rows]
        assert paths.index("basename.md") < paths.index("tag.md")
    finally:
        connection.close()


def test_lexical_index_migrates_without_vector_rebuild(tmp_path: Path):
    note = tmp_path / "Folder" / "전기차_설치.md"
    note.parent.mkdir(parents=True)
    note.write_text("# 설치 경과\n\n본문입니다.", encoding="utf-8")
    cfg = config(tmp_path)
    connection = init_db(cfg.db_path)
    try:
        insert_chunk(connection, "Folder/전기차_설치.md", 0, "본문입니다.", ["본문"],
                     ("설치 경과",))
        upsert_file_state(connection, "Folder/전기차_설치.md", "hash", 1, 0, 0)
        connection.execute("DROP TABLE chunk_headings_fts")
        connection.execute("DROP TABLE file_fields_fts")
        connection.execute("DROP TABLE file_fields")
        connection.executescript("""
            CREATE TABLE file_titles (file_path TEXT NOT NULL UNIQUE,
              basename_tokens TEXT NOT NULL, directory_tokens TEXT NOT NULL,
              heading_tokens TEXT NOT NULL);
            CREATE VIRTUAL TABLE titles_fts USING fts5(
              basename_tokens, directory_tokens, heading_tokens, tokenize='ascii');
        """)
        connection.commit()
    finally:
        connection.close()

    cfg.vector_path.write_bytes(b"unchanged-vector-bytes")
    old_hash = hashlib.sha256(cfg.vector_path.read_bytes()).hexdigest()
    old_metadata = {
        "schema_version": 2, "index_generation": "old", "vector_count": 1,
        "vector_file_size": cfg.vector_path.stat().st_size,
    }
    write_metadata(cfg.metadata_path, old_metadata)
    connection = sqlite3.connect(str(cfg.db_path))
    write_index_metadata(connection, old_metadata)
    connection.commit()
    connection.close()

    manager = IndexManager(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
    result = manager.ensure_lexical_index()
    assert result == {"migrated": True, "files": 1}
    assert hashlib.sha256(cfg.vector_path.read_bytes()).hexdigest() == old_hash

    connection = sqlite3.connect(str(cfg.db_path))
    try:
        fields = connection.execute(
            "SELECT basename_tokens, directory_tokens FROM file_fields"
        ).fetchone()
        assert fields is not None
        assert "전기차" in fields[0]
        assert connection.execute(
            "SELECT rowid FROM chunk_headings_fts WHERE heading_tokens MATCH '설치'"
        ).fetchone() is not None
        names = {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
        assert "file_titles" not in names and "titles_fts" not in names
    finally:
        connection.close()


def test_file_fields_extract_path_alias_tags_and_properties():
    fields = extract_file_fields(
        "5_Wiki/issues/전기차_충전시설.md",
        "---\nAliases: [충전소, 충전소]\nTags: [전기차]\nproject:\n  owner: 홍길동\n"
        "members: [관리소, 대표회]\ncssclass: secret-style\n---\n본문 #안전 #안전", None)
    assert "전기차" in fields.basename and "wiki" in fields.directory
    assert fields.aliases.count("충전소") == 1
    assert "전기차" in fields.tags and fields.tags.count("안전") == 1
    assert {"project", "owner", "홍길동", "members", "관리소", "대표회"} <= set(fields.properties)
    assert "secret" not in fields.properties and "style" not in fields.properties


def test_title_channel_can_add_file_outside_body_vector(tmp_path: Path):
    cfg = config(tmp_path, vector_top_k=1, bm25_top_k=30, final_top_k=10)
    connection = init_db(cfg.db_path)
    try:
        body_id = insert_chunk(connection, "body.md", 0, "전기차 충전기 설치 경과", ["전기차"])
        title_only_id = insert_chunk(connection, "title-only.md", 0, "무관한 본문", ["무관"])
        upsert_file_fields(connection, "body.md", ["body"], [], [], [], [])
        upsert_file_fields(connection, "title-only.md", ["타이틀검색어"], [], [], [], [])
        upsert_file_state(connection, "body.md", "hash", 1, 0, 0)
        upsert_file_state(connection, "title-only.md", "hash", 1, 0, 0)
        connection.commit()
    finally:
        connection.close()

    model = ModelManager(cfg)
    model.load()
    vector_index = _build_usearch(
        cfg, model, [body_id, title_only_id], ["전기차 충전기 설치 경과", "무관한 본문"])
    metadata = build_metadata(cfg, model.dimension, cfg.vector_path, len(vector_index), None)
    write_metadata(cfg.metadata_path, metadata)
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        write_index_metadata(connection, metadata)
        connection.commit()
    finally:
        connection.close()

    engine = SearchEngine(cfg, model, None)  # type: ignore[arg-type]

    engine.config.title_rrf_weight = 0.0
    results_zero = engine.search("타이틀검색어", top_k=10)
    assert "title-only.md" not in [item["file_path"] for item in results_zero]
    assert all("query_tokens" not in item for item in results_zero)

    engine.config.title_rrf_weight = 1.0
    results_on = engine.search("타이틀검색어", top_k=10, verbose=True)
    paths = [item["file_path"] for item in results_on]
    assert "title-only.md" in paths
    entry = next(item for item in results_on if item["file_path"] == "title-only.md")
    assert entry["channels"] == ["file", "title"]
    assert entry["file_rank"] >= 1
    assert entry["query_tokens"] == ["타이틀검색어"]
    assert entry["match_mode"] == "any"
    assert entry["rrf_contributions"]["file"] > 0
    assert entry["rrf_contributions"]["title"] == entry["rrf_contributions"]["file"]


def test_file_and_body_share_no_duplicate_chunk(tmp_path: Path):
    cfg = config(tmp_path)
    connection = init_db(tmp_path / "shared.db")
    try:
        row_id = insert_chunk(connection, "shared.md", 0, "설치 경과 본문", ["설치"])
        upsert_file_fields(connection, "shared.md", ["설치"], [], [], [], [])
        connection.commit()
        candidates = _file_candidate_ids(connection, [("shared.md", 1.0)], [row_id])
        assert candidates == [row_id]
    finally:
        connection.close()


def test_file_candidate_duplicate_uses_earliest_lexical_rank(tmp_path: Path):
    connection = init_db(tmp_path / "duplicate-rank.db")
    try:
        earliest = insert_chunk(connection, "shared.md", 0, "first", ["first"])
        later = insert_chunk(connection, "shared.md", 1, "second", ["second"])
        connection.commit()
        assert _file_candidate_ids(
            connection, [("shared.md", 1.0)], [earliest, later, earliest]
        ) == [earliest]
    finally:
        connection.close()


def test_vector_candidate_coalesces_to_file_representative(tmp_path: Path):
    connection = init_db(tmp_path / "coalesce.db")
    try:
        representative = insert_chunk(connection, "shared.md", 0, "body", ["body"])
        vector_chunk = insert_chunk(connection, "shared.md", 1, "vector", ["vector"])
        other = insert_chunk(connection, "other.md", 0, "other", ["other"])
        connection.commit()
        assert _coalesce_file_candidates(
            connection, [representative], [vector_chunk, other]
        ) == [representative, other]
    finally:
        connection.close()


def test_file_without_chunks_is_skipped(tmp_path: Path):
    connection = init_db(tmp_path / "empty.db")
    try:
        upsert_file_fields(connection, "empty.md", ["검색어"], [], [], [], [])
        connection.commit()
        candidates = _file_candidate_ids(connection, [("empty.md", 1.0)], [])
        assert candidates == []
    finally:
        connection.close()
