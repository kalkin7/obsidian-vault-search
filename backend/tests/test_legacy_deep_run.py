"""Turn-budget boundary of the legacy deep-answer loop.

The loop no longer fails with a hardcoded "조사 횟수 한계 도달" message: when the
configured turn budget is spent it pauses, the user chooses between more
research (``extend``) and answering from what was gathered (``answer_now``), and
the paused engine state survives between ``answer_start`` and
``answer_continue``.
"""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from vault_search.agent_run import AgentRunError, new_run_state
from vault_search.config import SearchConfig
from vault_search.deep_answer import (
    DeepAnswerEngine,
    LegacyDeepRun,
    TURN_BUDGET_CALL_ID,
)
from vault_search.errors import ServiceError
from vault_search.llm import ProviderResponse
from vault_search.service import SearchService


def scripted_provider(script: list[str]):
    calls: list[list[dict[str, str]]] = []

    class FakeProvider:
        provider_id = "openai"
        model = "gpt-test"

        def complete(self, **_kwargs):
            messages = list(_kwargs["messages"])
            calls.append(messages)
            index = min(len(calls) - 1, len(script) - 1)
            return ProviderResponse(script[index], "openai", "gpt-test")

    return FakeProvider, calls


def make_engine(script, *, max_turns=2, max_tool_calls_per_turn=2, searched=None):
    fake, calls = scripted_provider(script)
    provider = fake()

    def search(query):
        if searched is not None:
            searched.append(query)
        return [
            {
                "rank": 1,
                "file_path": "Notes/state.md",
                "score": 0.8,
                "content": "전기차 충전기 설치 진행 중",
                "heading_path": ["상태"],
                "start_line": 3,
            }
        ]

    engine = DeepAnswerEngine(
        complete=lambda messages, max_tokens, timeout: provider.complete(
            messages=messages,
            max_output_tokens=max_tokens,
            timeout_seconds=timeout,
        ),
        search=search,
        read_file=lambda _path: "# 제목\n\n본문",
        grep=lambda _pattern, _glob: [],
        max_output_tokens=800,
        timeout_seconds=10.0,
        max_turns=max_turns,
        max_tool_calls_per_turn=max_tool_calls_per_turn,
    )
    return engine, calls


TOOL_TURN = 'TOOL: search(query="전기차")'


def make_legacy_run(script, *, max_turns=2, searched=None):
    engine, calls = make_engine(script, max_turns=max_turns, searched=searched)
    state = new_run_state("전기차 상태")
    state.run_id = "legacy-budget-run"
    run = LegacyDeepRun(
        state=state,
        engine=engine,
        query="전기차 상태",
        conversation=[],
    )
    return run, engine, calls


def test_engine_pauses_instead_of_reporting_a_hard_limit():
    engine, _calls = make_engine([TOOL_TURN, TOOL_TURN, TOOL_TURN], max_turns=2)
    engine.seed(query="질문", conversation=[])
    outcome = engine.loop(pause_on_budget=True)
    assert outcome["status"] == "budget_required"
    assert outcome["turns"] == 2


def test_one_shot_run_answers_from_sources_without_a_prompt():
    # No interactive channel: the loop finalizes from the gathered evidence
    # instead of returning the old "(조사 횟수 한계 도달)" message.
    # Turn 1 and 2 spend the budget; the third provider call is the forced
    # answering turn.
    engine, _calls = make_engine([TOOL_TURN, TOOL_TURN, "정리했습니다. [S1]"])
    outcome = engine.run(query="질문", conversation=[])
    assert outcome["status"] == "complete"
    assert "조사 횟수 한계 도달" not in outcome["text"]
    assert outcome["text"] == "정리했습니다. [S1]"
    assert [source["id"] for source in outcome["sources"]]


def test_budget_call_descriptor_shape():
    run, _engine, _calls = make_legacy_run([TOOL_TURN])
    outcome = run.advance()
    assert outcome["status"] == "approval_required"
    call = outcome["calls"][0]
    assert call["call_id"] == TURN_BUDGET_CALL_ID
    assert call["annotations"]["kind"] == TURN_BUDGET_CALL_ID
    assert call["arguments"]["turns"] == 2
    assert call["arguments"]["sources"] >= 1
    assert "조사 한도" in call["description"]


def test_extend_grants_more_turns_and_keeps_state():
    searched: list[str] = []
    run, engine, _calls = make_legacy_run(
        [TOOL_TURN, TOOL_TURN, "확장 후 답변입니다. [S1]"],
        searched=searched,
    )
    first = run.advance()
    assert first["status"] == "approval_required"
    # The seed search ran once, plus the tool turns' own searches; resuming
    # must not re-seed the conversation.
    assert searched[0] == "전기차 상태"
    searches_after_pause = len(searched)
    outcome = run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "extend"}])
    assert outcome["status"] == "complete"
    assert outcome["text"] == "확장 후 답변입니다. [S1]"
    assert len(searched) == searches_after_pause
    assert engine.max_turns == 4
    assert len(outcome["sources"]) >= 2  # seed search + extended turn search


def test_answer_now_uses_gathered_sources():
    run, _engine, _calls = make_legacy_run(
        [TOOL_TURN, TOOL_TURN, "모은 자료로 답변합니다. [S1]"]
    )
    assert run.advance()["status"] == "approval_required"
    outcome = run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "answer_now"}])
    assert outcome["status"] == "complete"
    assert outcome["text"] == "모은 자료로 답변합니다. [S1]"
    assert outcome["sources"]


def test_wrong_decision_vocabulary_is_rejected():
    run, _engine, _calls = make_legacy_run([TOOL_TURN])
    assert run.advance()["status"] == "approval_required"
    with pytest.raises(AgentRunError) as exc:
        run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "allow_once"}])
    assert exc.value.code == "INVALID_DECISION"


def test_continue_after_decision_is_not_waiting():
    run, _engine, _calls = make_legacy_run([TOOL_TURN, TOOL_TURN, "답변 [S1]"])
    assert run.advance()["status"] == "approval_required"
    run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "answer_now"}])
    with pytest.raises(AgentRunError) as exc:
        run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "answer_now"}])
    assert exc.value.code == "RUN_NOT_WAITING"


def test_cancel_while_paused_wins():
    run, _engine, _calls = make_legacy_run([TOOL_TURN])
    assert run.advance()["status"] == "approval_required"
    run.state.cancelled = True
    with pytest.raises(AgentRunError) as exc:
        run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "extend"}])
    assert exc.value.code == "RUN_CANCELLED"


def test_extend_at_hard_cap_answers_now():
    run, engine, _calls = make_legacy_run(["답변 [S1]"], max_turns=40)
    # Pretend the run already extended up to the hard ceiling.
    engine._turns = 40  # noqa: SLF001 — deliberate cap probe
    assert run.advance()["status"] == "approval_required"
    outcome = run.resume([{"call_id": TURN_BUDGET_CALL_ID, "decision": "extend"}])
    # At the hard cap an extend request degrades to answering from sources.
    assert outcome["status"] == "complete"
    assert outcome["text"] == "답변 [S1]"


# ---------------------------------------------------------------------------
# Service-level wiring
# ---------------------------------------------------------------------------


def make_service(tmp_path: Path) -> SearchService:
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__"
    )
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(
        search_detailed=lambda *_args, **_kwargs: SimpleNamespace(
            results=[
                {
                    "rank": 1,
                    "file_path": "Notes/state.md",
                    "score": 0.82,
                    "content": "현재 상태는 진행 중이다.",
                    "heading_path": ["현재 상태"],
                    "start_line": 42,
                }
            ]
        )
    )  # type: ignore[assignment]
    service.config.mcp_enabled = False
    service.config.skills_enabled = False
    service.config.project_rules = ""
    return service


def test_answer_start_pauses_and_continue_answers(tmp_path):
    service = make_service(tmp_path)
    service.config.llm_deep_max_turns = 1
    fake, _calls = scripted_provider([TOOL_TURN, "지금까지 자료로 답변합니다. [S1]"])
    run_id = "legacy-budget-service"
    with patch("vault_search.service.create_provider", lambda *_args: fake()):
        started = service.call(
            "answer_start",
            {
                "query": "상태",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            },
        )
        assert started["status"] == "approval_required"
        assert started["calls"][0]["call_id"] == TURN_BUDGET_CALL_ID

        status = service.call("answer_status", {"run_id": run_id})
        assert status["status"] == "approval_required"

        result = service.call(
            "answer_continue",
            {
                "run_id": run_id,
                "decisions": [
                    {"call_id": TURN_BUDGET_CALL_ID, "decision": "answer_now"}
                ],
            },
        )
    assert result["status"] == "complete"
    assert result["result"]["answer"] == "지금까지 자료로 답변합니다. [S1]"
    assert result["result"]["citations"][0]["id"] == "S1"
    assert result["result"]["diagnostics"]["deep"] is True
    assert "structured" not in result["result"]["diagnostics"]


def test_answer_start_without_run_id_never_pauses(tmp_path):
    service = make_service(tmp_path)
    service.config.llm_deep_max_turns = 1
    fake, _calls = scripted_provider([TOOL_TURN, "최종 답변 [S1]"])
    with patch("vault_search.service.create_provider", lambda *_args: fake()):
        result = service.call(
            "answer",
            {"query": "상태", "conversation": [], "deep": True},
        )
    assert result["answer"] == "최종 답변 [S1]"


def test_apply_search_config_clamps_deep_budget(tmp_path):
    service = make_service(tmp_path)
    service.call(
        "apply_search_config",
        {"answerDeepMaxTurns": 999, "answerDeepMaxToolCallsPerTurn": 0},
    )
    assert service.config.llm_deep_max_turns == 30
    assert service.config.llm_deep_max_tool_calls_per_turn == 1


def test_expired_paused_run_reports_run_expired(tmp_path):
    service = make_service(tmp_path)
    service.config.llm_deep_max_turns = 1
    fake, _calls = scripted_provider([TOOL_TURN])
    run_id = "legacy-budget-expired"
    with patch("vault_search.service.create_provider", lambda *_args: fake()):
        started = service.call(
            "answer_start",
            {
                "query": "상태",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            },
        )
    assert started["status"] == "approval_required"
    # Force the approval window to elapse, then a continue must not start a
    # second LLM call.
    with service.run_registry._lock:  # noqa: SLF001 — deliberate expiry probe
        entry = service.run_registry._runs[run_id]  # noqa: SLF001
        service.run_registry._runs[run_id] = (  # noqa: SLF001
            entry[0],
            entry[1] - 2 * 600.0,
        )
    with pytest.raises(ServiceError) as exc:
        service.call(
            "answer_continue",
            {
                "run_id": run_id,
                "decisions": [
                    {"call_id": TURN_BUDGET_CALL_ID, "decision": "answer_now"}
                ],
            },
        )
    assert exc.value.code == "RUN_EXPIRED"
