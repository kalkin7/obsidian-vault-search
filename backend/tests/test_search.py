import sqlite3
from pathlib import Path
from typing import Any

import numpy as np

from vault_search.config import SearchConfig
from vault_search.database import (
    init_db,
    insert_chunk,
    title_index_needs_rebuild,
    upsert_file_state,
    upsert_file_title,
    write_index_metadata,
)
from vault_search.document_fields import title_tokens
from vault_search.index_metadata import (
    build_metadata,
    write_metadata,
)
from vault_search.indexing import IndexManager
from vault_search.model_manager import ModelManager
from vault_search.search import (
    SearchEngine,
    _coalesce_file_candidates,
    _title_candidate_ids,
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


def test_title_rows_prefers_basename_over_heading(tmp_path: Path):
    cfg = config(tmp_path)
    connection = init_db(tmp_path / "titles.db")
    try:
        upsert_file_title(connection, "basename.md", ["검색어"], [], [])
        upsert_file_title(connection, "heading.md", [], [], ["검색어"])
        connection.commit()
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
        rows = engine._title_rows(connection, ["검색어"])
        paths = [file_path for file_path, _score in rows]
        assert paths.index("basename.md") < paths.index("heading.md")
    finally:
        connection.close()


def test_title_index_migrates_without_vector_rebuild(tmp_path: Path):
    note = tmp_path / "Folder" / "전기차_설치.md"
    note.parent.mkdir(parents=True)
    note.write_text("# 설치 경과\n\n본문입니다.", encoding="utf-8")
    cfg = config(tmp_path)
    connection = init_db(cfg.db_path)
    try:
        upsert_file_state(connection, "Folder/전기차_설치.md", "hash", 0)
        connection.commit()
    finally:
        connection.close()

    manager = IndexManager(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
    result = manager.ensure_title_index()
    assert result == {"rebuilt": True, "files": 1}

    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert not title_index_needs_rebuild(connection)
        fields = connection.execute(
            "SELECT basename_tokens, directory_tokens, heading_tokens FROM file_titles"
        ).fetchone()
        assert fields is not None
        assert "전기차" in fields[0]
        assert "설치" in fields[2]
    finally:
        connection.close()


def test_title_tokens_extract_path_and_headings():
    basename, directory, headings = title_tokens(
        "5_Wiki/issues/전기차_충전시설.md", "# 설치 경과\n## 현재 상태", None)
    assert "전기차" in basename
    assert "wiki" in directory
    assert "설치" in headings
    assert "상태" in headings


def test_title_channel_can_add_file_outside_body_vector(tmp_path: Path):
    cfg = config(tmp_path, vector_top_k=1, bm25_top_k=30, final_top_k=10)
    connection = init_db(cfg.db_path)
    try:
        body_id = insert_chunk(connection, "body.md", 0, "전기차 충전기 설치 경과", ["전기차"])
        title_only_id = insert_chunk(connection, "title-only.md", 0, "무관한 본문", ["무관"])
        upsert_file_title(connection, "title-only.md", ["타이틀검색어"], [], [])
        upsert_file_state(connection, "body.md", "hash", 1)
        upsert_file_state(connection, "title-only.md", "hash", 1)
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

    engine.config.title_rrf_weight = 1.0
    results_on = engine.search("타이틀검색어", top_k=10, verbose=True)
    paths = [item["file_path"] for item in results_on]
    assert "title-only.md" in paths
    entry = next(item for item in results_on if item["file_path"] == "title-only.md")
    assert entry["channels"] == ["title"]
    assert entry["title_rank"] >= 1


def test_title_and_body_share_no_duplicate_chunk(tmp_path: Path):
    cfg = config(tmp_path)
    connection = init_db(tmp_path / "shared.db")
    try:
        row_id = insert_chunk(connection, "shared.md", 0, "설치 경과 본문", ["설치"])
        upsert_file_title(connection, "shared.md", ["설치"], [], [])
        connection.commit()
        candidates = _title_candidate_ids(connection, [("shared.md", 1.0)], [row_id])
        assert candidates == [row_id]
    finally:
        connection.close()


def test_vector_candidate_coalesces_to_title_representative(tmp_path: Path):
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


def test_title_file_without_chunks_is_skipped(tmp_path: Path):
    connection = init_db(tmp_path / "empty.db")
    try:
        upsert_file_title(connection, "empty.md", ["검색어"], [], [])
        connection.commit()
        candidates = _title_candidate_ids(connection, [("empty.md", 1.0)], [])
        assert candidates == []
    finally:
        connection.close()
