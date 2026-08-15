from __future__ import annotations

import sqlite3
from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.database import init_db, insert_chunk
from vault_search.wiki_expansion import expand_wiki_sources, should_expand_wiki_sources


def _config(tmp_path: Path) -> SearchConfig:
    data_dir = tmp_path / "data"
    (data_dir / "index").mkdir(parents=True)
    return SearchConfig(vault_path=tmp_path, data_dir=data_dir, model_id="__fake__")


def _direct(count: int, wiki_path: str) -> list[dict]:
    results = []
    for index in range(count):
        results.append(
            {
                "rank": index + 1,
                "file_path": wiki_path if index == 0 else f"notes/direct-{index}.md",
                "score": round(1.0 - index / 1000, 6),
                "content": f"direct {index}",
                "heading_path": [],
                "start_line": 1,
            }
        )
    return results


def _database(cfg: SearchConfig, source_paths: list[str]) -> sqlite3.Connection:
    connection = init_db(cfg.db_path)
    for source in source_paths:
        insert_chunk(connection, source, 0, f"content for {source}", ["content"])
    connection.commit()
    return connection


def test_eligibility_allows_sparse_results_but_not_full_result_limit():
    assert should_expand_wiki_sources("전체 경과", "timeline", 40, 20)
    assert should_expand_wiki_sources("전체 경과", "timeline", 40, 30)
    assert not should_expand_wiki_sources("전체 경과", "timeline", 20, 20)
    assert not should_expand_wiki_sources("전체 경과", "timeline", 40, 0)
    assert not should_expand_wiki_sources("전체 경과", "known-item", 40, 20)
    assert not should_expand_wiki_sources("네트워크 연결 오류", None, 40, 20)
    assert should_expand_wiki_sources("보험 보상 사례 연결", None, 40, 20)


def test_sparse_results_append_sources_without_moving_direct_results(tmp_path: Path):
    cfg = _config(tmp_path)
    wiki = "5_Wiki/entities/company.md"
    sources = ["notes/source-a.md", "notes/source-b.md"]
    target = tmp_path / wiki
    target.parent.mkdir(parents=True)
    target.write_text(
        "---\nsources: [notes/source-a.md, notes/source-b.md]\n---\nbody sources: ignored\n",
        encoding="utf-8",
    )
    for source in sources:
        path = tmp_path / source
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source", encoding="utf-8")
    connection = _database(cfg, sources)
    try:
        direct = _direct(20, wiki)
        original = [(item["file_path"], item["rank"], item["score"]) for item in direct]
        results = expand_wiki_sources(
            connection,
            cfg,
            direct,
            "전체 경과",
            "timeline",
            40,
            True,
            ["전체", "경과"],
            "any",
        )
    finally:
        connection.close()

    assert [
        (item["file_path"], item["rank"], item["score"]) for item in results[:20]
    ] == original
    assert [item["file_path"] for item in results[20:]] == sources
    assert [item["rank"] for item in results[20:]] == [21, 22]
    assert all(
        item["expanded"] and item["source"] == "wiki_sources" for item in results[20:]
    )
    assert all(
        item["channels"] == ["wiki_sources"] and item["rrf_contributions"] == {}
        for item in results[20:]
    )


def test_full_results_keep_top_thirty_and_limit_expansion_to_five(tmp_path: Path):
    cfg = _config(tmp_path)
    wiki = "5_Wiki/issues/issue.md"
    sources = [f"notes/source-{index}.md" for index in range(7)]
    target = tmp_path / wiki
    target.parent.mkdir(parents=True)
    target.write_text(
        "---\nsources:\n" + "".join(f"  - {source}\n" for source in sources) + "---\n",
        encoding="utf-8",
    )
    for source in sources:
        path = tmp_path / source
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source", encoding="utf-8")
    connection = _database(cfg, sources)
    try:
        direct = _direct(40, wiki)
        top_thirty = [item["file_path"] for item in direct[:30]]
        results = expand_wiki_sources(
            connection, cfg, direct, "연결", "timeline", 40, False, ["연결"], "any"
        )
    finally:
        connection.close()

    assert [item["file_path"] for item in results[:30]] == top_thirty
    assert [item["file_path"] for item in results[30:35]] == sources[:5]
    assert len(results) == 40


def test_sources_are_bounded_to_frontmatter_scope_and_existing_index(tmp_path: Path):
    cfg = _config(tmp_path)
    wiki = "5_Wiki/decisions/decision.md"
    valid = "notes/valid.md"
    target = tmp_path / wiki
    target.parent.mkdir(parents=True)
    target.write_text(
        "---\nsources:\n  - notes/valid.md\n  - ../escape.md\n  - 9_System/private.md\n"
        "  - notes/missing.md\n  - 42\n---\nsources:\n  - notes/body.md\n",
        encoding="utf-8",
    )
    valid_path = tmp_path / valid
    valid_path.parent.mkdir(parents=True)
    valid_path.write_text("valid", encoding="utf-8")
    (tmp_path / "9_System").mkdir()
    (tmp_path / "9_System/private.md").write_text("private", encoding="utf-8")
    connection = _database(cfg, [valid])
    try:
        results = expand_wiki_sources(
            connection,
            cfg,
            _direct(10, wiki),
            "연결",
            "timeline",
            40,
            False,
            ["연결"],
            "any",
        )
    finally:
        connection.close()
    assert [item["file_path"] for item in results if item.get("expanded")] == [valid]


def test_custom_wiki_folders_are_respected(tmp_path: Path):
    cfg = _config(tmp_path)
    cfg.wiki_folders = ["Notes/Entities"]
    wiki = "Notes/Entities/company.md"
    sources = ["notes/source-a.md"]
    target = tmp_path / wiki
    target.parent.mkdir(parents=True)
    target.write_text("---\nsources: [notes/source-a.md]\n---\n", encoding="utf-8")
    for source in sources:
        path = tmp_path / source
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source", encoding="utf-8")
    connection = _database(cfg, sources)
    try:
        results = expand_wiki_sources(
            connection,
            cfg,
            _direct(20, wiki),
            "전체 경과",
            "timeline",
            40,
            True,
            ["전체", "경과"],
            "any",
        )
    finally:
        connection.close()
    assert [item["file_path"] for item in results if item.get("expanded")] == sources


def test_empty_wiki_folders_disable_expansion(tmp_path: Path):
    cfg = _config(tmp_path)
    cfg.wiki_folders = []
    wiki = "5_Wiki/issues/issue.md"
    target = tmp_path / wiki
    target.parent.mkdir(parents=True)
    target.write_text("---\nsources: [notes/source-a.md]\n---\n", encoding="utf-8")
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes/source-a.md").write_text("source", encoding="utf-8")
    connection = _database(cfg, ["notes/source-a.md"])
    try:
        results = expand_wiki_sources(
            connection,
            cfg,
            _direct(20, wiki),
            "전체 경과",
            "timeline",
            40,
            True,
            ["전체", "경과"],
            "any",
        )
    finally:
        connection.close()
    # The 5_Wiki file is outside the (empty) configured folders: no expansion.
    assert not any(item.get("expanded") for item in results)
