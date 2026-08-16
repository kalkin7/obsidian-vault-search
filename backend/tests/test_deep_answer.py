from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.deep_answer import (
    DeepAnswerEngine,  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
    grep_vault,
    parse_tool_calls,
)
from vault_search.llm import ProviderResponse
from vault_search.service import SearchService


def make_service(tmp_path: Path) -> SearchService:
    config = SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__")
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(
        search_detailed=lambda *_args, **_kwargs: SimpleNamespace(
            results=[{
                "rank": 1,
                "file_path": "Notes/state.md",
                "score": 0.82,
                "content": "현재 상태는 진행 중이다.",
                "heading_path": ["현재 상태"],
                "start_line": 42,
            }]
        )
    )  # type: ignore[assignment]
    return service


def scripted_provider(script: list[str]):
    """A fake provider that replays the given responses; records messages."""
    calls: list[list[dict[str, str]]] = []

    class FakeProvider:
        provider_id = "openai"
        model = "gpt-test"

        def complete(self, **_kwargs):
            messages = list(_kwargs["messages"])
            calls.append(messages)
            return ProviderResponse(script[len(calls) - 1], "openai", "gpt-test")

    return FakeProvider, calls


def test_parse_tool_calls_extracts_search_read_and_grep():
    text = (
        'TOOL: search(query="전기차 충전기")\n'
        'TOOL: read(file="Notes/a.md")\n'
        'TOOL: grep(pattern="충전", glob="**/*.md")'
    )
    calls = parse_tool_calls(text)
    assert calls == [
        ("search", {"query": "전기차 충전기"}),
        ("read", {"file": "Notes/a.md"}),
        ("grep", {"pattern": "충전", "glob": "**/*.md"}),
    ]


def test_parse_tool_calls_handles_escaped_quotes_and_fences():
    text = 'TOOL: read(file="a\\"b.md")'
    assert parse_tool_calls(text) == [("read", {"file": 'a"b.md'})]
    fenced = '```\nTOOL: search(query="질문")\n```'
    assert parse_tool_calls(fenced) == [("search", {"query": "질문"})]
    assert parse_tool_calls("그냥 답변입니다. [S1]") == []


def test_engine_loops_over_tools_then_answers():
    script = [
        'TOOL: search(query="전기차")\nTOOL: read(file="Notes/a.md")',
        'TOOL: grep(pattern="충전", glob="**/*.md")',
        "결론입니다. [S1] [S2]",
    ]
    fake, calls = scripted_provider(script)
    searched: list[str] = []
    read: list[str] = []
    grepped: list[tuple[str, str]] = []

    def search(query):
        searched.append(query)
        return [{
            "rank": 1,
            "file_path": "Notes/state.md",
            "score": 0.82,
            "content": "전기차 충전기 설치 진행 중",
            "heading_path": ["상태"],
            "start_line": 3,
        }]

    def read_file(path):
        read.append(path)
        return "# 전기차\n\n본문 내용"

    def grep(pattern, glob_pattern):
        grepped.append((pattern, glob_pattern))
        return [{
            "file_path": "Notes/other.md",
            "start_line": 7,
            "content": "충전기 점검 필요",
        }]

    engine = DeepAnswerEngine(
        complete=lambda messages, max_tokens, timeout: fake().complete(messages=messages, max_output_tokens=max_tokens, timeout_seconds=timeout),
        search=search,
        read_file=read_file,
        grep=grep,
        max_output_tokens=1200,
        timeout_seconds=30.0,
    )
    outcome = engine.run(query="전기차 상태", conversation=[])
    assert searched == ["전기차"]
    assert read == ["Notes/a.md"]
    assert grepped == [("충전", "**/*.md")]
    assert outcome["text"] == "결론입니다. [S1] [S2]"
    assert [s.id for s in outcome["sources"]] == ["S1", "S2", "S3"]
    assert outcome["turns"] == 2
    assert outcome["tool_calls"] == 3


def test_engine_unknown_tool_becomes_note():
    fake, _ = scripted_provider(['TOOL: explode(x="1")', "완료"])
    engine = DeepAnswerEngine(
        complete=lambda messages, max_tokens, timeout: fake().complete(messages=messages, max_output_tokens=max_tokens, timeout_seconds=timeout),
        search=lambda query: [],
        read_file=lambda path: "",
        grep=lambda pattern, glob_pattern: [],
        max_output_tokens=100,
        timeout_seconds=10.0,
    )
    outcome = engine.run(query="q", conversation=[])
    assert "unknown tool: explode" in outcome["text"] or "완료" in outcome["text"]


def test_grep_vault_scoped_and_bounded(tmp_path):
    vault = tmp_path / "vault"
    (vault / "Notes").mkdir(parents=True)
    (vault / "Notes" / "a.md").write_text("충전기 상태 정상\n", encoding="utf-8")
    (vault / "Notes" / "b.md").write_text("충전기 점검 필요\n", encoding="utf-8")
    (vault / "notes.txt").write_text("충전기 txt\n", encoding="utf-8")
    (vault / "skip").mkdir()
    (vault / "skip" / "c.md").write_text("충전기 제외\n", encoding="utf-8")
    matches = grep_vault(
        vault,
        "충전",
        "**/*.md",
        include_globs=["**/*.md"],
        exclude_globs=["skip/**"],
    )
    assert {m["file_path"] for m in matches} == {"Notes/a.md", "Notes/b.md"}
    with pytest.raises(ValueError):
        grep_vault(vault, "(unclosed", "**/*.md", include_globs=[], exclude_globs=[])


def test_deep_answer_routes_and_returns_citations(monkeypatch, tmp_path):
    service = make_service(tmp_path)
    fake, _ = scripted_provider([
        'TOOL: search(query="상태")',
        "진행 중입니다. [S1]",
    ])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_args: fake())
    value = service.call("answer", {"query": "상태", "conversation": [], "deep": True})
    assert value["diagnostics"]["deep"] is True
    assert value["diagnostics"]["turns"] == 1
    assert value["answer"] == "진행 중입니다. [S1]"
    assert value["citations"][0]["file_path"] == "Notes/state.md"


def test_deep_answer_blocks_traversal_reads(monkeypatch, tmp_path):
    service = make_service(tmp_path)
    outside = tmp_path / "secret.txt"
    outside.write_text("비밀 내용", encoding="utf-8")
    fake, _ = scripted_provider([
        'TOOL: read(file="../secret.txt")',
        "조사 완료.",
    ])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_args: fake())
    value = service.call("answer", {"query": "비밀", "conversation": [], "deep": True})
    assert value["answer"] == "조사 완료."
    assert all("비밀 내용" not in s["content"] for s in value["evidence"])


def test_deep_answer_uses_grep_tool(monkeypatch, tmp_path):
    service = make_service(tmp_path)
    (tmp_path / "Notes").mkdir(parents=True)
    (tmp_path / "Notes" / "g.md").write_text("충전기 점검 필요\n", encoding="utf-8")
    fake, _ = scripted_provider([
        'TOOL: grep(pattern="충전", glob="**/*.md")',
        "점검이 필요합니다. [S1]",
    ])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_args: fake())
    value = service.call("answer", {"query": "점검", "conversation": [], "deep": True})
    assert value["answer"] == "점검이 필요합니다. [S1]"
    assert any("점검 필요" in s["content"] for s in value["evidence"])
