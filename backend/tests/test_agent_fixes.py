"""Regression tests for the agent-extension fixes (project rules, external
grounding, cancellation, secret allowlist)."""

import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.agent_run import StructuredAgentRun, new_run_state
from vault_search.agent_tools import NormalizedToolResult, ToolAliasMap
from vault_search.config import McpServerConfig, SearchConfig
from vault_search.errors import ServiceError
from vault_search.llm import ProviderToolCall, ProviderTurn
from vault_search.service import SearchService

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = BACKEND_ROOT / "tests" / "fixtures" / "mcp_test_server.py"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_service(
    tmp_path: Path,
    *,
    project_rules: str = "",
    mcp_enabled: bool = False,
    skills_enabled: bool = False,
    mcp_servers: list[McpServerConfig] | None = None,
) -> SearchService:
    config = SearchConfig(
        vault_path=tmp_path,
        data_dir=tmp_path / "data",
        model_id="__fake__",
        mcp_enabled=mcp_enabled,
        mcp_servers=mcp_servers or [],
        skills_enabled=skills_enabled,
        project_rules=project_rules,
    )
    service = SearchService(config, lambda _event, _data: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(  # type: ignore[assignment]
        search_detailed=lambda *_args, **_kwargs: SimpleNamespace(
            results=[
                {
                    "rank": 1,
                    "file_path": "Notes/state.md",
                    "score": 0.82,
                    "content": "볼트 근거 문단",
                    "heading_path": ["현재 상태"],
                    "start_line": 42,
                }
            ]
        )
    )
    return service


class ScriptedProvider:
    """complete_with_tools returns queued turns and records system prompts."""

    provider_id = "openai"
    model = "gpt-test"

    def __init__(self, turns: list[ProviderTurn] | None = None):
        self.turns = list(turns or [])
        self.systems: list[str] = []

    def complete_with_tools(self, *, system: str | None = None, **_kwargs):
        self.systems.append(system or "")
        if not self.turns:
            raise AssertionError("unexpected extra provider turn")
        return self.turns.pop(0)


def text_turn(text: str) -> ProviderTurn:
    return ProviderTurn(text=text, tool_calls=[], provider="openai", model="gpt-test")


# ---------------------------------------------------------------------------
# Fix 1 — project rules activate the structured agent and hot-apply
# ---------------------------------------------------------------------------


def test_project_rules_alone_activate_structured_agent(monkeypatch, tmp_path):
    service = make_service(tmp_path, project_rules="RULES-MARKER-항상 한국어로 답한다")
    provider = ScriptedProvider([text_turn("정답 [S1]")])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_a: provider)
    value = service.call("answer_start", {"query": "질문"})
    assert value["status"] == "complete"
    assert value["result"]["diagnostics"]["structured"] is True
    # The rule block appears exactly once in the assembled system prompt.
    assert provider.systems[0].count("RULES-MARKER") == 1
    assert "<project_rules>" in provider.systems[0]


def test_legacy_path_without_extensions_and_rules(monkeypatch, tmp_path):
    service = make_service(tmp_path)

    class LegacyProvider:
        provider_id = "openai"
        model = "gpt-test"

        def complete(self, **_kwargs):
            from vault_search.llm import ProviderResponse

            return ProviderResponse(
                "진행 중입니다. [S1]", "openai", "gpt-test"
            )

        def complete_with_tools(self, **_kwargs):  # must never be used
            raise AssertionError("legacy path must not use the tool loop")

    monkeypatch.setattr(
        "vault_search.service.create_provider", lambda *_a: LegacyProvider()
    )
    value = service.call("answer_start", {"query": "질문"})
    assert value["status"] == "complete"
    assert value["result"].get("diagnostics", {}).get("structured") is not True


def test_apply_search_config_accepts_canonical_and_alias_keys(tmp_path):
    service = make_service(tmp_path)
    service.call(
        "apply_search_config", {"answerProjectRules": "CANONICAL-RULE"}
    )
    assert service.config.project_rules == "CANONICAL-RULE"
    service.call("apply_search_config", {"projectRules": "ALIAS-RULE"})
    assert service.config.project_rules == "ALIAS-RULE"
    # Canonical key wins when both are present.
    service.call(
        "apply_search_config",
        {"answerProjectRules": "NEW", "projectRules": "OLD"},
    )
    assert service.config.project_rules == "NEW"


def test_runtime_rule_change_applies_from_next_answer(monkeypatch, tmp_path):
    service = make_service(tmp_path, project_rules="RULES-V1")
    provider = ScriptedProvider([text_turn("첫 [S1]"), text_turn("둘 [S1]")])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_a: provider)
    service.call("answer_start", {"query": "첫 질문"})
    assert provider.systems[0].count("RULES-V1") == 1
    # Hot update without any backend restart.
    service.call("apply_search_config", {"answerProjectRules": "RULES-V2"})
    service.call("answer_start", {"query": "두 번째 질문"})
    assert provider.systems[1].count("RULES-V2") == 1
    assert "RULES-V1" not in provider.systems[1]


# ---------------------------------------------------------------------------
# Fix 2 — external-only answers keep their text; groundingKind stays exact;
# approval-continue keeps real provider metadata.
# ---------------------------------------------------------------------------


def _outcome(text: str, sources: list, activity: list) -> dict:
    return {
        "status": "complete",
        "text": text,
        "sources": sources,
        "turns": 2,
        "tool_calls": 1,
        "activity": activity,
    }


def test_mcp_only_answer_not_overwritten():
    service = make_service(Path("/nonexistent-vault-for-assemble"))
    outcome = _outcome(
        "외부 도구 근거 기반 답변입니다.",
        [],
        [{"toolName": "mcp__x__y", "serverName": "x", "status": "success",
          "durationMs": 5}],
    )
    result = service._assemble_agent_result(outcome, None)
    assert result["answer"].startswith("외부 도구 근거 기반")
    assert result["groundingKind"] == "tool"
    assert result["grounded"] is False


def test_mixed_grounding_kind_with_sources_and_tools():
    service = make_service(Path("/nonexistent-vault-for-assemble"))
    source = {
        "id": "S1", "file_path": "a.md", "start_line": 1,
        "heading_path": [], "content": "내용", "rank": 1, "score": 0.9,
    }
    outcome = _outcome(
        "혼합 근거 답변 [S1]",
        [source],
        [{"toolName": "vault_read", "status": "error", "durationMs": 1}],
    )
    result = service._assemble_agent_result(outcome, None)
    assert result["groundingKind"] == "vault"


def test_no_evidence_still_overwritten_and_kind_none():
    service = make_service(Path("/nonexistent-vault-for-assemble"))
    outcome = _outcome("일반 지식 답변", [], [])
    result = service._assemble_agent_result(outcome, None)
    assert result["answer"] == "볼트에서 충분한 근거를 찾지 못했습니다."
    assert result["groundingKind"] == "none"


class _StubMcpHost:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.summary = {
            "id": "srv-1",
            "name": "github",
            "state": "connected",
            "tool_policies": {"create_issue": "ask"},
            "tool_descriptions": {},
        }

    def server_summary(self, server_id):
        return self.summary if server_id == "srv-1" else None

    def call_tool_sync(self, *, server_id, tool_name, arguments, **_kw):
        self.calls.append((server_id, tool_name))
        return NormalizedToolResult(ok=True, text=f"created {arguments}")

    def cancel_pending(self, registry):
        registry.clear()
        return 0


def test_approval_continue_keeps_provider_metadata(tmp_path):
    service = make_service(tmp_path)
    ask_call = ProviderToolCall(
        id="c9", name="mcp__github__create_issue", arguments={"title": "t"}
    )
    provider = ScriptedProvider(
        [
            ProviderTurn(
                text="",
                tool_calls=[ask_call],
                provider="openai",
                model="gpt-real-model",
            ),
            text_turn("완료 [S1]"),
        ]
    )
    state = new_run_state("이슈 만들어줘")
    state.provider = provider
    aliases = ToolAliasMap()
    aliases.register("srv-1", "github", "create_issue")
    run = StructuredAgentRun(
        state=state,
        system_prompt="sys",
        tools=[],
        aliases=aliases,
        complete_turn=lambda **kwargs: provider.complete_with_tools(**kwargs),
        search_fn=lambda _q: [],
        read_file_fn=lambda _p: "",
        grep_fn=lambda _p, _g: [],
        skills=None,
        mcp_host=_StubMcpHost(),
        max_context_chars=24000,
        max_output_tokens=4000,
        timeout_seconds=10,
    )
    run.seed([])
    service.run_registry.add(run)
    started = run.advance()
    assert started["status"] == "approval_required"
    completed = service.call(
        "answer_continue",
        {"run_id": state.run_id,
         "decisions": [{"call_id": "c9", "decision": "allow_once"}]},
    )
    assert completed["status"] == "complete"
    # Before this fix answer_continue passed provider=None and both fields
    # came back empty; now the run's stored provider supplies them (same
    # source as the answer_start completion path).
    assert completed["result"]["provider"] == "openai"
    assert completed["result"]["model"] == ScriptedProvider.model


# ---------------------------------------------------------------------------
# Fix 3 — out-of-band cancellation and client-supplied run ids
# ---------------------------------------------------------------------------


class BlockingProvider:
    provider_id = "openai"
    model = "gpt-block"

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()

    def complete_with_tools(self, **_kwargs):
        self.entered.set()
        if not self.release.wait(timeout=15):
            raise AssertionError("provider was never released")
        return text_turn("늦게 도착한 답변")


def test_cancel_is_out_of_band_while_answer_blocks(monkeypatch, tmp_path):
    service = make_service(tmp_path, project_rules="활성화")
    blocker = BlockingProvider()
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_a: blocker)
    holder: dict = {}

    def runner():
        try:
            holder["value"] = service.call(
                "answer_start", {"query": "오래 걸리는 질문"}
            )
        except ServiceError as exc:
            holder["error"] = exc

    worker = threading.Thread(target=runner, daemon=True)
    worker.start()
    assert blocker.entered.wait(timeout=10)
    # The serialized task queue is busy with answer_start; the cancel must not
    # wait behind it (out-of-band fast path).
    began = time.monotonic()
    run_id = _only_registry_id(service)
    cancelled = service.cancel_answer(run_id)
    elapsed = time.monotonic() - began
    assert cancelled == {"cancelled": True, "calls_cancelled": 0}
    assert elapsed < 2.0
    # Release the blocked provider turn: the loop must discard it instead of
    # completing with its text.
    blocker.release.set()
    worker.join(timeout=15)
    error = holder.get("error")
    assert error is not None and error.code == "ANSWER_CANCELLED"
    assert "value" not in holder


def _only_registry_id(service: SearchService) -> str:
    with service.run_registry._lock:
        return next(iter(service.run_registry._runs))


def test_cancel_before_registration_consumed_at_start(monkeypatch, tmp_path):
    service = make_service(tmp_path, project_rules="활성화")
    # Cancel arrives before answer_start registered the run.
    assert service.cancel_answer("client-run-abcd-0001") == {"cancelled": False}
    blocker = BlockingProvider()
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_a: blocker)
    with pytest.raises(ServiceError) as exc:
        service.call(
            "answer_start",
            {"query": "질문", "run_id": "client-run-abcd-0001"},
        )
    assert exc.value.code == "ANSWER_CANCELLED"
    # The pending marker is consumed exactly once.
    assert service._consume_pending_cancel("client-run-abcd-0001") is False
    assert service.run_registry.count() == 0


def test_client_run_id_is_used_verbatim(monkeypatch, tmp_path):
    service = make_service(tmp_path, project_rules="활성화")
    provider = ScriptedProvider([text_turn("즉시 [S1]")])
    monkeypatch.setattr("vault_search.service.create_provider", lambda *_a: provider)
    value = service.call(
        "answer_start",
        {"query": "질문", "run_id": "my-run-id-12345678"},
    )
    assert value["run_id"] == "my-run-id-12345678"


# ---------------------------------------------------------------------------
# Fix 3 E2E — real TCP backend, real stdio MCP child. A running MCP call is
# cancelled through a concurrent out-of-band answer_cancel while
# answer_start/answer_continue occupies the serialized worker. Responses of
# the long-blocking call are intentionally NOT asserted over the wire: on
# Windows loopback a response written microseconds before close can be
# discarded by a reset; cancellation is observed through run-registry,
# provider, and host state instead.
# ---------------------------------------------------------------------------


class _TcpBackend:
    """In-process BackendServer harness replicating run_server's task drain."""

    def __init__(self, service: SearchService):
        from vault_search.server import BackendServer, RequestHandler

        self.service = service
        self.server = BackendServer(
            ("127.0.0.1", 0), RequestHandler, service, "tok"
        )
        self.host, self.port = self.server.server_address
        self.token = "tok"
        import queue as queue_module

        self._stop = threading.Event()

        def drain_tasks() -> None:
            while not self._stop.is_set():
                try:
                    task = self.server.tasks.get(timeout=0.05)
                except queue_module.Empty:
                    continue
                try:
                    task.result = service.call(task.method, task.params)
                except BaseException as exc:
                    task.error = exc
                finally:
                    task.done.set()

        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.drain_thread = threading.Thread(target=drain_tasks, daemon=True)
        self.thread.start()
        self.drain_thread.start()

    def request(self, method: str, params: dict, timeout: float = 15) -> dict:
        from vault_search.protocol import request as protocol_request

        return protocol_request(
            str(self.host), self.port, self.token, method, params, timeout=timeout
        )

    def fire_and_forget(self, method: str, params: dict) -> threading.Thread:
        def runner() -> None:
            try:
                self.request(method, params, timeout=60)
            except Exception:
                # Transport failures (e.g. Windows loopback resetting a
                # connection closed right after its response) are tolerated:
                # assertions use server-side state instead.
                pass

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        return thread

    def wait_registered(self, timeout: float = 15.0) -> StructuredAgentRun:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.service.run_registry._lock:
                runs = list(self.service.run_registry._runs.values())
            if runs:
                return runs[0][0]
            time.sleep(0.02)
        raise AssertionError("run never registered")

    def wait_drained(self, timeout: float = 20.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.service.run_registry.count() == 0:
                return
            time.sleep(0.02)
        raise AssertionError("run was never removed by cancellation")

    def close(self) -> None:
        self._stop.set()
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.drain_thread.join(timeout=5)
        self.server.server_close()


def _slow_fixture_config(policy: str) -> McpServerConfig:
    return McpServerConfig(
        id="srv-slow",
        name="slowbox",
        command=sys.executable,
        args=[str(FIXTURE), "--label", "E2E:"],
        cwd="vault",
        env_names=[],
        tool_policies={"slow": policy},
        enabled=True,
    )


def test_tcp_cancel_first_turn_allow_policy_mcp_call(tmp_path, monkeypatch):
    slow_call = ProviderToolCall(
        id="c-slow", name="mcp__slowbox__slow", arguments={"seconds": 30}
    )
    scripted = ScriptedProvider(
        [
            ProviderTurn(
                text="",
                tool_calls=[slow_call],
                provider="openai",
                model="gpt-test",
            )
        ]
    )
    monkeypatch.setattr(
        "vault_search.service.create_provider", lambda *_a: scripted
    )
    cfg = _slow_fixture_config("allow")
    service = make_service(
        tmp_path, mcp_enabled=True, mcp_servers=[cfg], project_rules="on"
    )
    service.mcp_host.configure(enabled=True, servers=[cfg])
    assert service.mcp_host.wait_connected("srv-slow", timeout=30)

    backend = _TcpBackend(service)
    try:
        worker = backend.fire_and_forget(
            "answer_start",
            {"query": "느린 도구 실행", "run_id": "cancel-e2e-run-01"},
        )
        backend.wait_registered()
        began = time.monotonic()
        response = backend.request(
            "answer_cancel", {"run_id": "cancel-e2e-run-01"}, timeout=10
        )
        elapsed = time.monotonic() - began
        assert response["ok"], response
        # Out-of-band: a cancel queued behind the blocked answer would hang
        # BOTH the original attempt and its idempotent retry.
        assert elapsed < 5.0
        # The invariant that matters: cancellation landed and nothing ran on.
        backend.wait_drained()
        worker.join(timeout=10)
        # No late provider turn may run after cancellation.
        assert len(scripted.systems) == 1
    finally:
        backend.close()
        service.mcp_host.close()
        service.run_registry.close_all()


def test_tcp_cancel_after_approval_continue_mcp_call(tmp_path, monkeypatch):
    slow_call = ProviderToolCall(
        id="c-slow-2", name="mcp__slowbox__slow", arguments={"seconds": 25}
    )
    scripted = ScriptedProvider(
        [
            ProviderTurn(
                text="", tool_calls=[slow_call], provider="openai",
                model="gpt-test",
            ),
            ProviderTurn(text="", tool_calls=[], provider="openai",
                         model="gpt-test"),
        ]
    )
    monkeypatch.setattr(
        "vault_search.service.create_provider", lambda *_a: scripted
    )
    cfg = _slow_fixture_config("ask")
    service = make_service(
        tmp_path, mcp_enabled=True, mcp_servers=[cfg], project_rules="on"
    )
    service.mcp_host.configure(enabled=True, servers=[cfg])
    assert service.mcp_host.wait_connected("srv-slow", timeout=30)

    backend = _TcpBackend(service)
    try:
        backend.fire_and_forget(
            "answer_start",
            {"query": "승인 후 실행", "run_id": "cancel-e2e-run-02"},
        )
        run = backend.wait_registered()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not run.state.pending:
            time.sleep(0.02)
        assert list(run.state.pending) == ["c-slow-2"]
        continue_worker = backend.fire_and_forget(
            "answer_continue",
            {
                "run_id": run.state.run_id,
                "decisions": [{"call_id": "c-slow-2", "decision": "allow_once"}],
            },
        )
        # Wait until the approved MCP call is actually executing.
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and not run.state.active_calls:
            time.sleep(0.02)
        assert run.state.active_calls, "approved MCP call never started"
        began = time.monotonic()
        response = backend.request(
            "answer_cancel", {"run_id": run.state.run_id}, timeout=10
        )
        elapsed = time.monotonic() - began
        assert response["ok"], response
        # A lost first response (Windows loopback reset) yields the retry's
        # post-state (cancelled=false) even though cancellation landed, so
        # the invariant is asserted through run state below instead.
        if response["data"].get("cancelled"):
            assert response["data"].get("calls_cancelled", 0) >= 1
        # Out-of-band: queued-behind behavior would hang both attempts.
        assert elapsed < 5.0
        backend.wait_drained()
        continue_worker.join(timeout=10)
        # Exactly one provider turn consumed; no late continuation.
        assert len(scripted.systems) == 1
        statuses = [entry.status for entry in run.state.activity]
        assert statuses == ["cancelled"]
    finally:
        backend.close()
        service.mcp_host.close()
        service.run_registry.close_all()


# ---------------------------------------------------------------------------
# Fix 5 — set_mcp_secrets allowlist at the service boundary
# ---------------------------------------------------------------------------


def _service_with_runtime_server(tmp_path: Path) -> SearchService:
    server = McpServerConfig(
        id="srv-a",
        name="alpha",
        command=sys.executable,
        args=[str(FIXTURE)],
        cwd="vault",
        env_names=["ALPHA_TOKEN"],
        enabled=True,
    )
    service = make_service(tmp_path, mcp_enabled=True, mcp_servers=[server])
    service.mcp_host.configure(enabled=True, servers=[server])
    return service


def test_set_mcp_secrets_reject_unknown_server(tmp_path):
    service = _service_with_runtime_server(tmp_path)
    with pytest.raises(ServiceError) as exc:
        service.call(
            "set_mcp_secrets",
            {"servers": {"ghost": {"OPENAI_API_KEY": "sk-canary-value"}}},
        )
    assert exc.value.code == "MCP_UNKNOWN_SERVER"
    # Nothing staged in memory.
    assert service.mcp_host._secrets.get("ghost") is None


def test_set_mcp_secrets_isolates_unregistered_env_names(tmp_path):
    service = _service_with_runtime_server(tmp_path)
    value = "alpha-canary-secret"
    result = service.call(
        "set_mcp_secrets",
        {
            "servers": {
                "srv-a": {
                    "ALPHA_TOKEN": value,
                    "OPENAI_API_KEY": "provider-key-canary",
                }
            }
        },
    )
    assert result["applied"] == 1
    rejected = {entry["name"] for entry in result["rejected_envs"]}
    assert rejected == {"OPENAI_API_KEY"}
    stored = service.mcp_host._secrets["srv-a"]
    assert stored == {"ALPHA_TOKEN": value}
    # The isolated name must not exist anywhere in memory.
    assert "OPENAI_API_KEY" not in json.dumps(list(stored.keys()))


def test_set_mcp_secrets_rotation_replaces_snapshot(tmp_path):
    service = _service_with_runtime_server(tmp_path)
    service.call("set_mcp_secrets", {"servers": {"srv-a": {"ALPHA_TOKEN": "v1"}}})
    # Rotation: same name, new value.
    service.call("set_mcp_secrets", {"servers": {"srv-a": {"ALPHA_TOKEN": "v2"}}})
    assert service.mcp_host._secrets["srv-a"]["ALPHA_TOKEN"] == "v2"
    # Deletion: snapshot without the value clears it from memory.
    service.call("set_mcp_secrets", {"servers": {"srv-a": {}}})
    assert service.mcp_host._secrets["srv-a"] == {}


# ---------------------------------------------------------------------------
# Fix 6 — deterministic provider tool-surface bounds (count + schema bytes)
# ---------------------------------------------------------------------------


class _FakeMcpHost:
    def __init__(self, *, tools: int, schema_pad: int):
        self.alias_surface_info = {
            "discovered": tools,
            "exposed": min(tools, 100),
            "truncated": tools > 100,
        }
        self._schema = {
            "type": "object",
            "properties": {
                "pad": {"type": "string", "description": "p" * schema_pad}
            },
        }

    def configure(self, *, enabled, servers):
        return {"servers": []}

    def wait_connected(self, server_id, timeout=12.0):
        return True

    def build_alias_map(self):
        aliases = ToolAliasMap()
        for index in range(min(100, max(1, self.alias_surface_info["discovered"]))):
            aliases.register("srv-big", "bigbox", f"tool{index:04d}")
        return aliases

    def status(self):
        return {
            "enabled": True,
            "servers": [
                {"id": "srv-big", "name": "bigbox", "state": "connected"}
            ],
            "connected": 1,
        }

    def list_server_tools(self, server_id):
        return {
            f"tool{index:04d}": json.loads(json.dumps(self._schema))
            for index in range(self.alias_surface_info["discovered"])
        }

    def server_summary(self, server_id):
        return {
            "id": "srv-big",
            "name": "bigbox",
            "state": "connected",
            "tool_policies": {},
            "tool_descriptions": {},
        }


def _service_with_big_host(tmp_path: Path, *, tools: int, pad: int) -> SearchService:
    service = make_service(tmp_path, project_rules="on")
    from vault_search.config import McpServerConfig

    service.config.mcp_servers = [
        McpServerConfig(
            id="srv-big", name="bigbox", command="noop", enabled=True,
            tool_policies={},
        )
    ]
    service.config.mcp_enabled = True
    service.mcp_host = _FakeMcpHost(tools=tools, schema_pad=pad)
    return service


def test_five_hundred_tools_capped_at_one_hundred(tmp_path):
    from vault_search.agent_tools import (
        BUILTIN_TOOL_NAMES_SET,
        MAX_PROVIDER_TOOLS,
    )

    service = _service_with_big_host(tmp_path, tools=500, pad=10)
    _provider, _aliases, tools, _skills, mcp_on, _skills_on = (
        service._prepare_agent_context()
    )
    assert mcp_on is True
    mcp_defs = [t for t in tools if t.name not in BUILTIN_TOOL_NAMES_SET]
    assert len(mcp_defs) <= MAX_PROVIDER_TOOLS
    surface = dict(service._last_tool_surface)
    assert surface["discovered_tools"] == 500
    assert surface["exposed_mcp_tools"] <= MAX_PROVIDER_TOOLS
    assert surface["tools_truncated"] is True
    # Status exposes the warning surface for the UI.
    assert service.status()["agent_tool_surface"]["tools_truncated"] is True


def test_total_schema_bytes_bound_truncates_definitions(tmp_path):
    from vault_search.agent_tools import (
        BUILTIN_TOOL_NAMES_SET,
        MAX_TOTAL_SCHEMA_BYTES,
    )

    # 100 tools x ~4 KiB schemas exceed the 256 KiB total budget.
    service = _service_with_big_host(tmp_path, tools=100, pad=4000)
    _provider, _aliases, tools, _skills, mcp_on, _skills_on = (
        service._prepare_agent_context()
    )
    assert mcp_on is True
    mcp_defs = [t for t in tools if t.name not in BUILTIN_TOOL_NAMES_SET]
    assert len(mcp_defs) < 100
    surface = dict(service._last_tool_surface)
    assert surface["schema_bytes"] <= MAX_TOTAL_SCHEMA_BYTES
    assert surface["schema_truncated"] is True
