"""Structured agent run tests: native loop, approval, reject, budget (§15.5)."""

import time

import pytest

import vault_search.agent_run as agent_run_module
from vault_search.agent_run import (
    AgentRunError,
    AgentRunRegistry,
    StructuredAgentRun,
    new_run_state,
)
from vault_search.agent_tools import NormalizedToolResult, ToolAliasMap
from vault_search.llm import ProviderToolCall, ProviderTurn


class StubMcpHost:
    def __init__(self, policy: str = "ask"):
        self.calls: list[tuple[str, str, dict]] = []
        self.result_text: str | None = None
        self.summary = {
            "id": "srv-1",
            "name": "github",
            "state": "connected",
            "tool_policies": {"create_issue": policy},
        }

    def server_summary(self, server_id):
        return self.summary if server_id == "srv-1" else None

    def call_tool_sync(
        self,
        *,
        server_id,
        tool_name,
        arguments,
        timeout_seconds=30,
        cancel_registry=None,
        cancel_key=None,
    ):
        self.calls.append((server_id, tool_name, dict(arguments)))
        if self.result_text is not None:
            return NormalizedToolResult(ok=True, text=self.result_text)
        return NormalizedToolResult(ok=True, text=f"executed {tool_name}")

    def cancel_pending(self, registry):
        registry.clear()
        return 0


def make_turn(text="", calls=()):
    return ProviderTurn(
        text=text,
        tool_calls=list(calls),
        provider="openai",
        model="m",
    )


def build_run(turns, host=None, session_allowed=(), skills=None):
    state = new_run_state("질문")
    aliases = ToolAliasMap()
    aliases.register("srv-1", "github", "create_issue")

    def complete_turn(**kwargs):
        if not turns:
            raise AssertionError("unexpected extra provider turn")
        return turns.pop(0)

    def search(query):
        return [
            {
                "file_path": "notes/a.md",
                "start_line": 3,
                "heading_path": ["제목"],
                "content": "볼트 내용",
                "rank": 1,
                "score": 0.9,
            }
        ]

    def read_file(rel):
        assert rel == "notes/a.md"
        return "# 제목\n파일 본문"

    def grep(pattern, glob):
        return []

    run = StructuredAgentRun(
        state=state,
        system_prompt="sys",
        tools=[],
        aliases=aliases,
        complete_turn=complete_turn,
        search_fn=search,
        read_file_fn=read_file,
        grep_fn=grep,
        skills=skills,
        mcp_host=host,
        max_context_chars=24000,
        max_output_tokens=4000,
        timeout_seconds=30,
    )
    run.session_allowed = set(session_allowed)
    run.seed([])
    return run


def test_direct_answer_completes_without_tools():
    run = build_run([make_turn(text="정답입니다")])
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assert outcome["text"] == "정답입니다"


def test_builtin_read_gathers_source_then_answers():
    read_call = ProviderToolCall(id="c1", name="vault_read", arguments={"file": "notes/a.md"})
    run = build_run(
        [make_turn(calls=[read_call]), make_turn(text="결론 [S1]")]
    )
    outcome = run.advance()
    assert outcome["status"] == "complete"
    # S1 comes from the seeded initial search, S2 from the explicit read.
    assert len(run.sources) == 2
    assert run.sources[0]["id"] == "S1"
    assert run.sources[1]["id"] == "S2"
    # The provider saw an assistant message with the tool call followed by a
    # role:"tool" result carrying the same id.
    roles = [message["role"] for message in run.state.messages]
    assert "assistant" in roles and "tool" in roles
    tool_message = next(m for m in run.state.messages if m["role"] == "tool")
    assert tool_message["tool_call_id"] == "c1"
    assert '<source id="S2">' in tool_message["content"]


def test_ask_tool_waits_for_approval_with_zero_side_effects():
    host = StubMcpHost(policy="ask")
    call = ProviderToolCall(id="c9", name="mcp__github__create_issue", arguments={"title": "t"})
    run = build_run([make_turn(calls=[call]), make_turn(text="done")], host=host)
    outcome = run.advance()
    assert outcome["status"] == "approval_required"
    descriptor = outcome["calls"][0]
    assert descriptor["call_id"] == "c9"
    assert descriptor["server_name"] == "github"
    assert descriptor["display_name"] == "create_issue"
    assert descriptor["arguments"] == {"title": "t"}
    assert host.calls == []


def test_allow_once_executes_exactly_once_then_completes():
    host = StubMcpHost(policy="ask")
    call = ProviderToolCall(id="c9", name="mcp__github__create_issue", arguments={"title": "t"})
    run = build_run(
        [make_turn(calls=[call]), make_turn(text="완료")], host=host
    )
    first = run.advance()
    assert first["status"] == "approval_required"
    second = run.resume([{"call_id": "c9", "decision": "allow_once"}])
    assert second["status"] == "complete"
    assert len(host.calls) == 1
    with pytest.raises(AgentRunError) as exc:
        run.resume([{"call_id": "c9", "decision": "allow_once"}])
    assert exc.value.code == "RUN_NOT_WAITING"


def test_reject_never_touches_server_and_informs_model():
    host = StubMcpHost(policy="ask")
    call = ProviderToolCall(id="c9", name="mcp__github__create_issue", arguments={})
    run = build_run(
        [make_turn(calls=[call]), make_turn(text="거부 반영 답변")], host=host
    )
    run.advance()
    outcome = run.resume([{"call_id": "c9", "decision": "reject"}])
    assert outcome["status"] == "complete"
    assert host.calls == []
    rejection = next(
        m for m in run.state.messages if m["role"] == "tool"
    )
    assert "[USER_REJECTED_TOOL_CALL]" in rejection["content"]
    activity = [entry for entry in outcome["activity"]]
    assert activity and activity[0]["status"] == "rejected"


def test_session_allowance_skips_approval():
    host = StubMcpHost(policy="ask")
    call = ProviderToolCall(id="c1", name="mcp__github__create_issue", arguments={})
    run = build_run(
        [make_turn(calls=[call]), make_turn(text="ok")],
        host=host,
        session_allowed=["mcp__github__create_issue"],
    )
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assert len(host.calls) == 1


def test_policy_allow_auto_executes():
    host = StubMcpHost(policy="allow")
    call = ProviderToolCall(id="c1", name="mcp__github__create_issue", arguments={})
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")], host=host)
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assert len(host.calls) == 1


def test_allow_session_grants_rest_of_conversation():
    host = StubMcpHost(policy="ask")
    first = ProviderToolCall(id="c1", name="mcp__github__create_issue", arguments={})
    second = ProviderToolCall(id="c2", name="mcp__github__create_issue", arguments={})
    run = build_run(
        [
            make_turn(calls=[first]),
            make_turn(calls=[second]),
            make_turn(text="끝"),
        ],
        host=host,
    )
    boundary = run.advance()
    assert boundary["status"] == "approval_required"
    resumed = run.resume([{"call_id": "c1", "decision": "allow_session"}])
    assert resumed["status"] == "complete"
    assert len(host.calls) == 2


def test_unknown_tool_fed_back_not_executed():
    host = StubMcpHost(policy="allow")
    call = ProviderToolCall(id="cx", name="mcp__ghost__boom", arguments={})
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")], host=host)
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assert host.calls == []
    feedback = next(m for m in run.state.messages if m["role"] == "tool")
    assert "[UNKNOWN_TOOL]" in feedback["content"]


def test_malformed_arguments_reported_to_model():
    call = ProviderToolCall(id="cm", name="vault_read", malformed_arguments=True)
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")])
    outcome = run.advance()
    assert outcome["status"] == "complete"
    feedback = next(m for m in run.state.messages if m["role"] == "tool")
    assert "[MALFORMED_TOOL_ARGUMENTS]" in feedback["content"]


def test_mixed_batch_executes_builtin_and_holds_ask():
    host = StubMcpHost(policy="ask")
    builtin = ProviderToolCall(id="b1", name="vault_read", arguments={"file": "notes/a.md"})
    ask = ProviderToolCall(id="a1", name="mcp__github__create_issue", arguments={})
    run = build_run(
        [make_turn(calls=[builtin, ask]), make_turn(text="ok")], host=host
    )
    outcome = run.advance()
    assert outcome["status"] == "approval_required"
    assert len(outcome["calls"]) == 1
    assert len(run.sources) == 2  # seeded search + builtin read already ran
    assert host.calls == []


def test_tool_budget_forces_error_results(monkeypatch):
    monkeypatch.setattr(agent_run_module, "MAX_TOTAL_TOOL_CALLS", 2)
    calls = [
        ProviderToolCall(id=f"c{i}", name="vault_read", arguments={"file": "notes/a.md"})
        for i in range(4)
    ]
    turns = [make_turn(calls=[call]) for call in calls]
    turns.append(make_turn(text="마무리"))
    run = build_run(turns)
    outcome = run.advance()
    assert outcome["status"] == "complete"
    blocked = [
        m for m in run.state.messages
        if m["role"] == "tool" and "TOOL_BUDGET_EXHAUSTED" in m["content"]
    ]
    assert blocked


def test_max_turns_triggers_forced_finalization(monkeypatch):
    monkeypatch.setattr(agent_run_module, "MAX_TURNS", 2)
    seen_tools: list[int] = []

    def tracking_complete(**kwargs):
        seen_tools.append(len(kwargs.get("tools") or []))
        if not hasattr(tracking_complete, "queue"):
            tracking_complete.queue = [
                make_turn(calls=[ProviderToolCall(id="c1", name="vault_search", arguments={"query": "q"})]),
                make_turn(calls=[ProviderToolCall(id="c2", name="vault_search", arguments={"query": "q"})]),
                make_turn(text="강제 마무리"),
            ]
        return tracking_complete.queue.pop(0)

    state = new_run_state("질문")
    from vault_search.agent_tools import ToolAliasMap

    run = StructuredAgentRun(
        state=state,
        system_prompt="sys",
        tools=[object()],
        aliases=ToolAliasMap(),
        complete_turn=tracking_complete,
        search_fn=lambda q: [],
        read_file_fn=lambda p: "",
        grep_fn=lambda p, g: [],
        skills=None,
        mcp_host=None,
        max_context_chars=24000,
        max_output_tokens=4000,
        timeout_seconds=5,
    )
    run.seed([])
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assert outcome["text"] == "강제 마무리"
    # The forced finalization turn must not offer any tools.
    assert seen_tools[-1] == 0


def test_cancelled_run_raises_coded_error():
    run = build_run([make_turn(text="x")])
    run.state.cancelled = True
    with pytest.raises(AgentRunError) as exc:
        run.advance()
    assert exc.value.code == "ANSWER_CANCELLED"


# ---------------------------------------------------------------------------
# Registry behavior
# ---------------------------------------------------------------------------


def _registry_run() -> StructuredAgentRun:
    return build_run([make_turn(text="pending")])


def test_registry_caps_active_runs():
    registry = AgentRunRegistry(max_active=2)
    runs = [_registry_run() for _ in range(2)]
    for run in runs:
        registry.add(run)
    with pytest.raises(AgentRunError) as exc:
        registry.add(_registry_run())
    assert exc.value.code == "TOO_MANY_RUNS"


def test_registry_ttl_expiry_marks_cancelled(monkeypatch):
    monkeypatch.setattr(agent_run_module, "APPROVAL_TTL_SECONDS", 0.05)
    registry = AgentRunRegistry()
    run = _registry_run()
    registry.add(run)
    time.sleep(0.08)
    with pytest.raises(AgentRunError) as exc:
        registry.get(run.state.run_id)
    assert exc.value.code == "RUN_EXPIRED"
    assert run.state.cancelled


def test_registry_remove_returns_run():
    registry = AgentRunRegistry()
    run = _registry_run()
    registry.add(run)
    removed = registry.remove(run.state.run_id)
    assert removed is run
    assert registry.count() == 0


def test_registry_close_all_cancels():
    registry = AgentRunRegistry()
    run = _registry_run()
    registry.add(run)
    registry.close_all()
    assert run.state.cancelled
    assert registry.count() == 0


# ---------------------------------------------------------------------------
# Fix §6 — per-run context budget
# ---------------------------------------------------------------------------


def test_mcp_result_over_context_budget_withheld(monkeypatch):
    monkeypatch.setattr(agent_run_module, "MAX_RUN_CONTEXT_BUDGET_BYTES", 64)
    host = StubMcpHost(policy="allow")
    host.result_text = "y" * 500
    call = ProviderToolCall(id="c1", name="mcp__github__create_issue", arguments={})
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")], host=host)
    outcome = run.advance()
    assert outcome["status"] == "complete"
    feedback = next(m for m in run.state.messages if m["role"] == "tool")
    # The side effect happened, so the activity reports success — but the
    # oversized result is replaced by a coded error, never dropped silently.
    assert "[CONTEXT_BUDGET_EXHAUSTED]" in feedback["content"]
    statuses = [entry["status"] for entry in outcome["activity"]]
    assert statuses == ["success"]


def test_vault_read_over_context_budget_returns_coded_error(monkeypatch):
    monkeypatch.setattr(agent_run_module, "MAX_RUN_CONTEXT_BUDGET_BYTES", 64)
    call = ProviderToolCall(id="c1", name="vault_read", arguments={"file": "notes/a.md"})
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")])
    run._read_file = lambda rel: "# 제목\n" + "x" * 500
    outcome = run.advance()
    feedback = [
        m for m in run.state.messages
        if m["role"] == "tool" and m["tool_call_id"] == "c1"
    ]
    assert "[CONTEXT_BUDGET_EXHAUSTED]" in feedback[0]["content"]
    assert outcome["status"] == "complete"


def test_skill_body_over_context_budget_withheld(monkeypatch, tmp_path):
    from vault_search.skills import SkillRegistry

    monkeypatch.setattr(agent_run_module, "MAX_RUN_CONTEXT_BUDGET_BYTES", 32)
    skill_dir = tmp_path / ".claude" / "skills" / "big"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: big\ndescription: big skill\n---\n" + "x" * 200,
        encoding="utf-8",
    )
    skills = SkillRegistry(tmp_path)
    skills.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    call = ProviderToolCall(
        id="c1", name="skill_load",
        arguments={"skill_id": "project:.claude:big"},
    )
    run = build_run([make_turn(calls=[call]), make_turn(text="ok")], skills=skills)
    outcome = run.advance()
    feedback = next(m for m in run.state.messages if m["role"] == "tool")
    assert "[CONTEXT_BUDGET_EXHAUSTED]" in feedback["content"]
    assert outcome["status"] == "complete"


# ---------------------------------------------------------------------------
# Fix §7 — no dangling provider tool calls beyond the per-turn cap
# ---------------------------------------------------------------------------


def _tool_message_ids(run) -> list[str]:
    return [
        m["tool_call_id"]
        for m in run.state.messages
        if m["role"] == "tool"
    ]


def test_overflow_tool_calls_get_budget_error_results(monkeypatch):
    monkeypatch.setattr(agent_run_module, "MAX_TOOL_CALLS_PER_TURN", 2)
    calls = [
        ProviderToolCall(id=f"c{i}", name="vault_search", arguments={"query": "q"})
        for i in range(4)
    ]
    run = build_run(
        [make_turn(calls=calls), make_turn(text="마무리 [S1]")]
    )
    outcome = run.advance()
    assert outcome["status"] == "complete"
    assistant = next(
        m for m in run.state.messages if m.get("role") == "assistant"
    )
    assistant_ids = [c.id for c in assistant["tool_calls"]]
    assert assistant_ids == ["c0", "c1", "c2", "c3"]
    # Every assistant tool call has EXACTLY one matching tool result.
    result_ids = _tool_message_ids(run)
    for call_id in assistant_ids:
        assert result_ids.count(call_id) == 1
    overflow = [
        m for m in run.state.messages
        if m["role"] == "tool"
        and m["tool_call_id"] in {"c2", "c3"}
    ]
    assert all("TOOL_BUDGET_EXHAUSTED" in m["content"] for m in overflow)


# ---------------------------------------------------------------------------
# Fix §7 — payload serialization completeness across both providers
# ---------------------------------------------------------------------------


def _completed_transcript() -> list[dict]:
    from vault_search.llm import ProviderToolCall as C

    calls = [C(id=f"c{i}", name="vault_search", arguments={"query": "q"})
             for i in range(3)]
    return [
        {"role": "user", "content": "질문"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": calls,
        },
        *[
            {"role": "tool", "tool_call_id": c.id, "content": f"[TOOL_BUDGET_EXHAUSTED] {c.id}"}
            for c in calls[-1:]
        ],
        *[
            {"role": "tool", "tool_call_id": c.id, "content": f"result {c.id}"}
            for c in calls[:2]
        ],
    ]


def _assert_payload_completeness(items, call_key, output_key):
    call_ids = [item[call_key] for item in items if item.get(call_key)]
    outputs = [item[output_key] for item in items if output_key in item]
    for call_id in call_ids:
        assert outputs.count(call_id) == 1, call_id


def test_chat_completions_payload_pairs_every_tool_call():
    from vault_search.llm import OpenAICompatibleProvider

    messages = _completed_transcript()
    converted = OpenAICompatibleProvider._chat_messages("sys", messages)
    calls = [
        tc["id"]
        for entry in converted
        if entry.get("role") == "assistant" and entry.get("tool_calls")
        for tc in entry["tool_calls"]
    ]
    outputs = [
        entry["tool_call_id"]
        for entry in converted
        if entry.get("role") == "tool"
    ]
    for call_id in calls:
        assert outputs.count(call_id) == 1


def test_responses_payload_pairs_every_function_call():
    from vault_search.llm import OpenAIResponsesProvider

    messages = _completed_transcript()
    items = OpenAIResponsesProvider._input_items(messages)
    function_calls = [
        item["call_id"] for item in items if item.get("type") == "function_call"
    ]
    function_outputs = [
        item["call_id"]
        for item in items
        if item.get("type") == "function_call_output"
    ]
    for call_id in function_calls:
        assert function_outputs.count(call_id) == 1
