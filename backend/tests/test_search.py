import sqlite3
from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.database import (
    init_db,
    insert_chunk,
    title_index_needs_rebuild,
    upsert_file_state,
    upsert_file_title,
)
from vault_search.document_fields import title_tokens
from vault_search.indexing import IndexManager
from vault_search.search import SearchEngine, select_diverse


def config(tmp_path: Path, **overrides) -> SearchConfig:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "index").mkdir(parents=True, exist_ok=True)
    return SearchConfig(vault_path=tmp_path, data_dir=data_dir, **overrides)


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


def test_title_rank_prefers_basename_over_heading(tmp_path: Path):
    cfg = config(tmp_path)
    connection = init_db(tmp_path / "titles.db")
    try:
        upsert_file_title(connection, "basename.md", ["검색어"], [], [])
        upsert_file_title(connection, "heading.md", [], [], ["검색어"])
        connection.commit()
        engine = SearchEngine(cfg, model=None, kiwi=None)  # type: ignore[arg-type]
        ranks = engine._title_ranks(connection, ["검색어"])
        assert ranks["basename.md"] < ranks["heading.md"]
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
