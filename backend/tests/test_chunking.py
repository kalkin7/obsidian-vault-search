from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from vault_search.chunking import DocumentChunk, chunk_document, chunk_text, extract_content
from vault_search.config import SearchConfig
from vault_search.index_metadata import expected_metadata, validate_metadata
from vault_search.indexing import IndexManager
from vault_search.model_manager import ModelManager


FIXTURES = Path(__file__).parent / "fixtures" / "chunking"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def markdown(name: str, chunk_chars: int = 400, overlap: int = 60) -> list[DocumentChunk]:
    return chunk_document(fixture(name), name, chunk_chars, overlap, "markdown-v2")


def config(tmp_path: Path) -> SearchConfig:
    data = tmp_path / "data"
    (data / "index").mkdir(parents=True)
    return SearchConfig(
        vault_path=tmp_path,
        data_dir=data,
        model_id="__fake__",
        include_globs=["**/*.md"],
        exclude_globs=[],
        chunking_strategy="markdown-v2",
        chunk_chars=100,
        chunk_overlap=20,
    )


def test_frontmatter_removed():
    text = "---\ntitle: test\n---\n\nThis is a sufficiently long paragraph for indexing."
    assert "title:" not in extract_content(text)
    chunks = chunk_text(text, 100, 10)
    assert len(chunks) == 1
    assert "sufficiently" in chunks[0]


def test_long_paragraph_split_with_overlap():
    text = "가나다라마바사아자차카타파하" * 20
    chunks = chunk_text(text, 100, 20)
    assert len(chunks) > 1
    assert all(len(chunk) <= 100 for chunk in chunks)


def test_paragraph_v1_is_unchanged_and_default():
    text = "short\n\nThis paragraph is long enough to survive paragraph v1."
    expected = chunk_text(text, 100, 10)
    assert [chunk.content for chunk in chunk_document(text, "note.md", 100, 10)] == expected
    assert [chunk.embedding_text for chunk in chunk_document(text, "note.md", 100, 10)] == expected


def test_paragraph_v1_line_ranges_advance_for_repeated_content_and_overlap():
    repeated = "Repeated paragraph content.\n\nRepeated paragraph content."
    chunks = chunk_document(repeated, "repeat.md", 30, 0, "paragraph-v1")
    assert [chunk.start_line for chunk in chunks] == [1, 3]

    long_line = "abcdefghijklmnopqrstuvwxyz" * 4
    overlap = chunk_document(long_line, "overlap.md", 40, 10, "paragraph-v1")
    assert len(overlap) > 1
    assert all(chunk.start_line == 1 and chunk.end_line == 1 for chunk in overlap)


def test_heading_breadcrumbs_and_same_level_replacement():
    chunks = markdown("headings.md", chunk_chars=80, overlap=0)
    paths = [chunk.heading_path for chunk in chunks]
    assert ("Alpha", "Beta", "Gamma") in paths
    assert ("Alpha", "Delta") in paths
    assert ("Alpha", "Beta", "Delta") not in paths
    gamma = next(chunk for chunk in chunks if chunk.heading_path[-1] == "Gamma")
    assert gamma.embedding_text.startswith("headings > Alpha > Beta > Gamma\n\n")


def test_heading_inside_fence_is_ignored():
    chunks = markdown("fenced-heading.md", chunk_chars=200, overlap=0)
    assert all("Not a heading" not in chunk.heading_path for chunk in chunks)
    code = next(chunk for chunk in chunks if "print" in chunk.content)
    assert code.heading_path == ("Outside",)
    assert code.content.startswith("~~~python") and code.content.endswith("~~~")


def test_table_and_callout_remain_complete_atoms():
    table = markdown("table.md", chunk_chars=70, overlap=0)
    table_chunk = next(chunk for chunk in table if "| Item |" in chunk.content)
    assert "| Beta | 20 |" in table_chunk.content
    assert len(table_chunk.content) <= 140

    callout = markdown("callout.md", chunk_chars=200, overlap=0)
    callout_chunk = next(chunk for chunk in callout if "[!WARNING]" in chunk.content)
    assert "Keep the complete warning" in callout_chunk.content
    assert "Do not split" in callout_chunk.content


def test_oversized_code_and_table_pieces_preserve_context():
    code = "```text\n" + "\n".join(f"code line {number:02d}" for number in range(20)) + "\n```"
    code_chunks = chunk_document(code, "code.md", 50, 0, "markdown-v2")
    assert len(code_chunks) > 1
    assert all(chunk.content.startswith("```text\n") for chunk in code_chunks)
    assert all(chunk.content.endswith("\n```") for chunk in code_chunks)
    assert all((chunk.start_line, chunk.end_line) == (1, 22) for chunk in code_chunks)
    assert all(len(chunk.content) <= 100 for chunk in code_chunks)

    header = "| Name | Value |\n| --- | --- |"
    table = header + "\n" + "\n".join(
        f"| item-{number:02d} | value-{number:02d} |" for number in range(20))
    table_chunks = chunk_document(table, "table.md", 50, 0, "markdown-v2")
    assert len(table_chunks) > 1
    assert all(chunk.content.startswith(header + "\n") for chunk in table_chunks)
    assert all(chunk.start_line == 1 for chunk in table_chunks)
    assert all(3 <= chunk.end_line <= 22 for chunk in table_chunks)
    assert all(len(chunk.content) <= 100 for chunk in table_chunks)


def test_table_detection_rejects_inline_pipe_and_bounds_long_context():
    prose = "This prose uses A | B inline.\nContinuation without a table delimiter."
    prose_chunks = chunk_document(prose, "prose.md", 20, 0, "markdown-v2")
    assert all(len(chunk.content) <= 20 for chunk in prose_chunks)

    long_header = f"| {'H' * 120} | Value |"
    table = f"{long_header}\n| --- | --- |\n| item | value |"
    table_chunks = chunk_document(table, "long-table.md", 40, 0, "markdown-v2")
    assert all(len(chunk.content) <= 80 for chunk in table_chunks)

    fence = "`" * 120
    code = f"{fence}python\n{'body ' * 40}\n{fence}"
    code_chunks = chunk_document(code, "long-fence.md", 40, 0, "markdown-v2")
    assert all(len(chunk.content) <= 80 for chunk in code_chunks)
    assert all(chunk.start_line == 1 and chunk.end_line == 3 for chunk in code_chunks)


def test_short_atoms_and_short_whole_document_are_preserved():
    chunks = markdown("short-sections.md", chunk_chars=200, overlap=0)
    content = "\n".join(chunk.content for chunk in chunks)
    assert "OK" in content
    assert "끝" in content

    short = chunk_document("중요", "short.md", 100, 10, "markdown-v2")
    assert len(short) == 1 and short[0].content == "중요"


def test_empty_document_has_one_title_only_chunk():
    chunks = markdown("empty.md")
    assert chunks == [DocumentChunk("empty", "empty", (), 1, 1, lexical_only=True)]


def test_bom_frontmatter_and_source_line_offsets():
    chunks = markdown("bom-frontmatter.md")
    assert len(chunks) == 1
    assert chunks[0].heading_path == ("Visible",)
    assert chunks[0].start_line == 8
    assert chunks[0].end_line == 8
    source_lines = fixture("bom-frontmatter.md").splitlines()
    assert chunks[0].content == "\n".join(
        source_lines[chunks[0].start_line - 1:chunks[0].end_line])


def test_long_line_uses_unicode_character_fallback():
    chunks = markdown("long-line.md", chunk_chars=40, overlap=0)
    assert len(chunks) > 1
    assert all(len(chunk.content) <= 40 for chunk in chunks)
    assert "".join(chunk.content for chunk in chunks) == fixture("long-line.md").splitlines()[-1]


def test_full_and_incremental_build_have_same_chunk_bytes_and_order(tmp_path: Path):
    note = tmp_path / "note.md"
    original = fixture("headings.md")
    note.write_text(original, encoding="utf-8")
    cfg = config(tmp_path)
    model = ModelManager(cfg)
    model.load()
    manager = IndexManager(cfg, model, None)
    manager.rebuild_all()

    def rows() -> list[tuple]:
        connection = sqlite3.connect(str(cfg.db_path))
        try:
            return connection.execute(
                "SELECT file_path, chunk_index, content, heading_path, start_line, end_line,"
                " embedding_text, lexical_only FROM chunks ORDER BY file_path, chunk_index"
            ).fetchall()
        finally:
            connection.close()

    full_rows = rows()
    note.write_text("# Temporary\n\nTemporary replacement content.", encoding="utf-8")
    manager.sync_paths(["note.md"], [])
    note.write_text(original, encoding="utf-8")
    manager.sync_paths(["note.md"], [])
    assert rows() == full_rows


def test_rebuild_vectors_uses_embedding_text_and_skips_lexical_only(
    tmp_path: Path, monkeypatch,
):
    (tmp_path / "structured.md").write_text("# Heading\n\nBody content.", encoding="utf-8")
    (tmp_path / "empty.md").write_text("", encoding="utf-8")
    (tmp_path / "same.md").write_text("same", encoding="utf-8")
    cfg = config(tmp_path)
    model = ModelManager(cfg)
    model.load()
    manager = IndexManager(cfg, model, None)
    result = manager.rebuild_all()
    assert result["chunks"] == 3
    assert result["vector_chunks"] == 2

    captured: list[str] = []
    original_encode = model.encode_documents

    def capture(texts: list[str], show_progress: bool = False):
        captured.extend(texts)
        return original_encode(texts, show_progress=show_progress)

    monkeypatch.setattr(model, "encode_documents", capture)
    manager.rebuild_vectors()
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        expected = [row[0] for row in connection.execute(
            "SELECT embedding_text FROM chunks WHERE lexical_only = 0 ORDER BY id")]
        lexical = connection.execute(
            "SELECT content, lexical_only FROM chunks WHERE file_path = 'empty.md'").fetchone()
        same = connection.execute(
            "SELECT content, lexical_only FROM chunks WHERE file_path = 'same.md'").fetchone()
    finally:
        connection.close()
    assert captured == expected
    assert set(captured) == {"same\n\nsame", "structured > Heading\n\nBody content."}
    assert lexical == ("empty", 1)
    assert same == ("same", 0)


def test_incremental_delete_removes_lexical_only_chunk(tmp_path: Path):
    note = tmp_path / "empty.md"
    note.write_text("", encoding="utf-8")
    cfg = config(tmp_path)
    model = ModelManager(cfg)
    model.load()
    manager = IndexManager(cfg, model, None)
    manager.rebuild_all()
    note.unlink()
    manager.sync_paths([], ["empty.md"])
    connection = sqlite3.connect(str(cfg.db_path))
    try:
        assert connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0] == 0
    finally:
        connection.close()


def test_schema_mismatch_requires_complete_rebuild(tmp_path: Path):
    expected = expected_metadata(config(tmp_path), 768)
    actual = dict(expected)
    actual["schema_version"] = 1
    problems = validate_metadata(actual, expected)
    assert any("schema_version" in problem for problem in problems)
    assert expected["chunking_strategy"] == "markdown-v2"
    assert expected["chunker_version"] == 2


@pytest.mark.parametrize(("attribute", "value", "problem_key"), [
    ("chunking_strategy", "paragraph-v1", "chunking_strategy"),
    ("chunk_chars", 120, "chunk_chars"),
])
def test_rebuild_vectors_rejects_structural_metadata_mismatch_without_writing(
    tmp_path: Path, attribute: str, value: object, problem_key: str,
):
    (tmp_path / "note.md").write_text("# Heading\n\nBody content.", encoding="utf-8")
    cfg = config(tmp_path)
    model = ModelManager(cfg)
    model.load()
    manager = IndexManager(cfg, model, None)
    manager.rebuild_all()
    metadata_before = cfg.metadata_path.read_bytes()
    database_before = cfg.db_path.read_bytes()
    setattr(cfg, attribute, value)

    with pytest.raises(RuntimeError, match=rf"rebuild_all.*{problem_key}"):
        manager.rebuild_vectors()

    assert cfg.metadata_path.read_bytes() == metadata_before
    assert cfg.db_path.read_bytes() == database_before
