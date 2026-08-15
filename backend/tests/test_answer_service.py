from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.errors import ServiceError
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


def test_answer_retrieves_bounded_sources_and_normalizes_provider(monkeypatch, tmp_path):
    service = make_service(tmp_path)

    class FakeProvider:
        provider_id = "openai"
        model = "gpt-test"

        def complete(self, **_kwargs):
            return ProviderResponse("진행 중입니다. [S1] [S99]", "openai", "gpt-test")

    monkeypatch.setattr("vault_search.service.create_provider", lambda *_args: FakeProvider())
    value = service.call("answer", {"query": "현재 상태", "conversation": []})
    assert value["answer"] == "진행 중입니다. [S1]"
    assert [citation["id"] for citation in value["citations"]] == ["S1"]
    assert value["evidence"][0]["file_path"] == "Notes/state.md"
    assert value["provider"] == "openai"


def test_answer_does_not_call_provider_without_grounding(monkeypatch, tmp_path):
    service = make_service(tmp_path)
    service.search_engine.search_detailed = lambda *_args, **_kwargs: SimpleNamespace(results=[])
    called = False

    def fail_provider(*_args):
        nonlocal called
        called = True
        raise AssertionError("provider must not be called")

    monkeypatch.setattr("vault_search.service.create_provider", fail_provider)
    with pytest.raises(ServiceError) as error:
        service.call("answer", {"query": "근거 없음", "conversation": []})
    assert error.value.code == "GROUNDING_EMPTY"
    assert called is False


def test_provider_error_keeps_safe_search_evidence_for_ui(monkeypatch, tmp_path):
    service = make_service(tmp_path)

    def fail_provider(*_args):
        from vault_search.llm import ProviderError
        raise ProviderError("LLM_API_KEY_MISSING", "openai API key is not configured")

    monkeypatch.setattr("vault_search.service.create_provider", fail_provider)
    with pytest.raises(ServiceError) as error:
        service.call("answer", {"query": "현재 상태", "conversation": []})
    assert error.value.code == "LLM_API_KEY_MISSING"
    assert error.value.details["evidence"][0]["file_path"] == "Notes/state.md"
