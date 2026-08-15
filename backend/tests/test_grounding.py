from vault_search.grounding import build_grounding_context, normalize_citations


def result(path, rank, content, line=1):
    return {
        "file_path": path,
        "rank": rank,
        "score": 0.8,
        "content": content,
        "start_line": line,
        "heading_path": ["현재 상태"],
    }


def test_grounding_caps_chunks_per_file_and_source_length():
    sources, context = build_grounding_context(
        [result("a.md", 1, "a" * 4000), result("a.md", 2, "second"), result("b.md", 3, "third")],
        max_context_chars=32000,
    )
    assert [source.id for source in sources] == ["S1", "S2", "S3"]
    assert len(sources[0].content) == 3000
    assert "<source id=\"S1\">" in context
    assert "second" in context
    assert "third" in context


def test_grounding_context_budget_includes_source_markup():
    sources, context = build_grounding_context(
        [result("a.md", 1, "x" * 3000), result("b.md", 2, "y" * 3000)],
        max_context_chars=4000,
    )
    assert sources
    assert len(context) <= 4000


def test_citation_parser_removes_unknown_ids_and_returns_only_used_sources():
    sources, _ = build_grounding_context([result("a.md", 1, "fact")])
    answer, citations, warning = normalize_citations("사실 [S1] 이상한 [S9]", sources)
    assert answer == "사실 [S1] 이상한"
    assert [citation["id"] for citation in citations] == ["S1"]
    assert warning is None


def test_citation_parser_warns_when_provider_omits_citations():
    sources, _ = build_grounding_context([result("a.md", 1, "fact")])
    _, citations, warning = normalize_citations("근거 없는 답변", sources)
    assert citations == []
    assert warning == "ANSWER_HAS_NO_VALID_CITATIONS"
