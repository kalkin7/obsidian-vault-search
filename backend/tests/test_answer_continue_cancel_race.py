"""Deterministic cancel/continue race tests — no sleep-based flakiness.
Uses threading.Barrier / Event for exact interleaving.
"""

import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


from vault_search.config import SearchConfig
from vault_search.service import SearchService
from vault_search.errors import ServiceError
from vault_search.agent_run import new_run_state, AgentRunError
from vault_search.llm import ProviderTurn


def make_service(tmp_path: Path):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__"
    )
    service = SearchService(config, lambda e, d: None)
    service.state = "ready"
    service.index = object()
    service.search_engine = SimpleNamespace(
        search_detailed=lambda *a, **kw: SimpleNamespace(results=[])
    )
    service.config.mcp_enabled = True
    service.config.mcp_servers = []
    return service


def _fake_provider_factory():
    def factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    return factory


# ---------------------------------------------------------------------------
# 1. continue resume 내부에서 대기하는 동안 cancel → continue는 ANSWER_CANCELLED, status는 cancelled
# ---------------------------------------------------------------------------
def test_continue_blocks_inside_resume_then_cancel_wins(tmp_path):
    service = make_service(tmp_path)

    # Prepare a run that is waiting for approval
    # Create state with pending so resume can be called
    # We will directly register a fake run whose resume blocks.
    run_id = "race-continue-cancelled-1234"

    barrier = threading.Barrier(2, timeout=5)
    resume_started = threading.Event()
    let_resume_continue = threading.Event()

    # Need a real run_state to satisfy provider handling, but we will monkeypatch resume

    # Create a minimal run via service's _answer_start to get a pending run, then manipulate?
    # Simpler: manually create a run with pending and register it.

    # Build a dummy StructuredAgentRun with mocked resume that blocks on events
    class BlockingRun:
        def __init__(self):
            self.state = new_run_state("hello")
            self.state.run_id = run_id
            self.state.fingerprint = "fp123"
            self.state.pending = {
                "c1": SimpleNamespace(
                    call_id="c1",
                    alias="tool",
                    tool_name="tool",
                    server_id="s",
                    server_name="srv",
                    display_name="tool",
                    arguments={},
                    annotations={},
                    description="",
                )
            }
            self.state.provider = SimpleNamespace(provider_id="openai", model="test")
            # Required for registry: _call_descriptor
            self._call_descriptor = lambda p: {
                "call_id": p.call_id,
                "tool_name": p.alias,
            }

            # Make resume block
            self.resume_calls = 0

        def resume(self, decisions):
            self.resume_calls += 1
            resume_started.set()
            # Wait until test signals to proceed, but cancel will happen before this
            # Use barrier to synchronize: resume waits for barrier, cancel thread also waits
            try:
                barrier.wait(timeout=5)
            except threading.BrokenBarrierError:
                pass
            # Give cancel a moment to store terminal before we try to store complete
            let_resume_continue.wait(timeout=5)
            # Now simulate successful resume that would produce complete
            # If cancelled flag was set, the real StructuredAgentRun would raise ANSWER_CANCELLED
            # But we will simulate by checking cancelled and raising
            if self.state.cancelled:
                raise AgentRunError("RUN_CANCELLED", "run is cancelled")
            # Otherwise pretend we completed
            return {
                "status": "complete",
                "text": "answer [S1]",
                "sources": [],
                "turns": 1,
                "tool_calls": 0,
                "activity": [],
            }

        # For _answer_continue approval check, registry touch etc not needed

    blocking = BlockingRun()
    service.run_registry.add(blocking)
    # Patch assemble to avoid needing real outcome
    with patch.object(
        service,
        "_assemble_agent_result",
        return_value={
            "answer": "answer",
            "citations": [],
            "evidence": [],
            "provider": "openai",
            "model": "test",
            "grounded": True,
            "diagnostics": {},
        },
    ):
        # Also patch _fingerprint not needed for continue (uses orig_fp from state)

        results = {}
        errors = {}

        def continue_thread():
            try:
                res = service.call(
                    "answer_continue",
                    {
                        "run_id": run_id,
                        "decisions": [{"call_id": "c1", "decision": "reject"}],
                    },
                )
                results["ok"] = res
            except ServiceError as e:
                errors["err"] = e
            except Exception as e:
                errors["exc"] = e

        t = threading.Thread(target=continue_thread)
        t.start()

        # Wait for resume to have started
        assert resume_started.wait(timeout=5), "resume did not start"

        # Now cancel in main thread while resume is blocked inside barrier
        # Use barrier to ensure both threads meet
        # Continue thread is waiting at barrier, main thread also waits
        try:
            barrier.wait(timeout=5)
        except threading.BrokenBarrierError:
            pass

        # Now cancel should win
        cancel_res = service.cancel_answer(run_id)
        # cancel should report cancelled True because it removed live run
        assert cancel_res["cancelled"] is True

        # Allow resume to continue
        let_resume_continue.set()

        t.join(timeout=5)
        assert not t.is_alive(), "continue thread hung"

        # Verify continue raised ANSWER_CANCELLED, not complete
        assert "err" in errors, (
            f"expected ANSWER_CANCELLED but got results={results} errors={errors}"
        )
        assert errors["err"].code == "ANSWER_CANCELLED"

        # Verify terminal winner is cancelled
        term = service._get_terminal(run_id)
        assert term is not None
        payload, _fp = term
        assert payload.get("status") == "cancelled"

        # Verify answer_status returns cancelled
        st = service.call("answer_status", {"run_id": run_id})
        assert st["status"] == "cancelled"


# ---------------------------------------------------------------------------
# 2. continue complete 저장 후 cancel → complete 유지
# ---------------------------------------------------------------------------
def test_continue_complete_then_cancel_stays_complete(tmp_path):
    service = make_service(tmp_path)
    run_id = "race-complete-then-cancel-1234"

    class CompletingRun:
        def __init__(self):
            self.state = new_run_state("hello")
            self.state.run_id = run_id
            self.state.fingerprint = "fp123"
            self.state.pending = {
                "c1": SimpleNamespace(
                    call_id="c1",
                    alias="tool",
                    tool_name="tool",
                    server_id="s",
                    server_name="srv",
                    display_name="tool",
                    arguments={},
                    annotations={},
                    description="",
                )
            }
            self.state.provider = SimpleNamespace(provider_id="openai", model="test")
            self._call_descriptor = lambda p: {
                "call_id": p.call_id,
                "tool_name": p.alias,
            }

        def resume(self, decisions):
            return {
                "status": "complete",
                "text": "final answer",
                "sources": [],
                "turns": 1,
                "tool_calls": 0,
                "activity": [],
            }

    run = CompletingRun()
    service.run_registry.add(run)
    with patch.object(
        service,
        "_assemble_agent_result",
        return_value={
            "answer": "final",
            "citations": [],
            "evidence": [],
            "provider": "openai",
            "model": "test",
            "grounded": True,
            "diagnostics": {},
        },
    ):
        res = service.call(
            "answer_continue",
            {"run_id": run_id, "decisions": [{"call_id": "c1", "decision": "reject"}]},
        )
        assert res["status"] == "complete"
        assert res["run_id"] == run_id

        # Now cancel after complete
        cancel_res = service.cancel_answer(run_id)
        assert (
            cancel_res["cancelled"] is False
        )  # already terminal, should not be cancelled

        term = service._get_terminal(run_id)
        assert term is not None
        payload, _ = term
        assert payload.get("status") == "complete"
        assert payload.get("result")["answer"] == "final"

        # answer_status should still be complete
        st = service.call("answer_status", {"run_id": run_id})
        assert st["status"] == "complete"


# ---------------------------------------------------------------------------
# 3. legacy deep 실행 중 cancel 후 정상 반환 → cancelled
# ---------------------------------------------------------------------------
def test_legacy_deep_cancel_then_success_returns_cancelled(tmp_path):
    service = make_service(tmp_path)
    service.config.mcp_enabled = False
    service.config.skills_enabled = False
    # also need to ensure _extensions_active false
    run_id = "legacy-race-success-1234"

    # Use Barrier to coordinate _deep_answer blocking and cancel
    started = threading.Event()
    allow_continue = threading.Event()
    barrier = threading.Barrier(2, timeout=5)

    def fake_deep(params):
        started.set()
        try:
            barrier.wait(timeout=5)
        except threading.BrokenBarrierError:
            pass
        allow_continue.wait(timeout=5)
        # Simulate successful deep answer returning result
        return {
            "answer": "hi",
            "citations": [],
            "evidence": [],
            "provider": "openai",
            "model": "test",
            "grounded": True,
            "diagnostics": {},
        }

    results = {}
    errors = {}

    def start_thread():
        try:
            with patch.object(service, "_deep_answer", fake_deep):
                res = service.call(
                    "answer_start",
                    {
                        "query": "hello",
                        "conversation": [],
                        "max_context_chars": 24000,
                        "session_allowed_tools": [],
                        "run_id": run_id,
                    },
                )
                results["ok"] = res
        except ServiceError as e:
            errors["err"] = e
        except Exception as e:
            errors["exc"] = e

    t = threading.Thread(target=start_thread)
    t.start()

    assert started.wait(timeout=5), "deep did not start"
    try:
        barrier.wait(timeout=5)
    except threading.BrokenBarrierError:
        pass

    # Cancel while deep is blocked
    service.cancel_answer(run_id)
    # For legacy path, cancel will park pending or remove live? At this point legacy run is registered, so cancel should remove it and publish cancelled
    # Depending on timing, cancel may have removed live run
    # We don't assert cancelled flag because if _deep_answer already holds registry, cancel will succeed
    # But after our barrier, _deep_answer is blocked inside fake_deep, and run is already registered, so cancel should succeed
    # Let's check that cancel reports true or false; either is okay as long as winner is cancelled
    # If cancel happened before deep started, it would have been pending; but we started deep first, so cancel should find live run
    # Allow some time
    time.sleep(0.05)

    allow_continue.set()
    t.join(timeout=5)
    assert not t.is_alive()

    assert "err" in errors, f"expected cancelled but got results={results}"
    assert errors["err"].code == "ANSWER_CANCELLED"

    term = service._get_terminal(run_id)
    assert term is not None
    payload, _ = term
    assert payload["status"] == "cancelled"


# ---------------------------------------------------------------------------
# 4. legacy deep 실행 중 cancel 후 예외 → cancelled가 winner (not failed)
# ---------------------------------------------------------------------------
def test_legacy_deep_cancel_then_exception_returns_cancelled(tmp_path):
    service = make_service(tmp_path)
    service.config.mcp_enabled = False
    service.config.skills_enabled = False
    run_id = "legacy-race-exception-1234"

    started = threading.Event()
    allow_continue = threading.Event()
    barrier = threading.Barrier(2, timeout=5)

    def fake_deep_raise(params):
        started.set()
        try:
            barrier.wait(timeout=5)
        except threading.BrokenBarrierError:
            pass
        allow_continue.wait(timeout=5)
        # Simulate provider timeout exception
        raise ServiceError("LLM_TIMEOUT", "timeout")

    results = {}
    errors = {}

    def start_thread():
        try:
            with patch.object(service, "_deep_answer", fake_deep_raise):
                res = service.call(
                    "answer_start",
                    {
                        "query": "hello",
                        "conversation": [],
                        "max_context_chars": 24000,
                        "session_allowed_tools": [],
                        "run_id": run_id,
                    },
                )
                results["ok"] = res
        except ServiceError as e:
            errors["err"] = e
        except Exception as e:
            errors["exc"] = e

    t = threading.Thread(target=start_thread)
    t.start()

    assert started.wait(timeout=5)
    try:
        barrier.wait(timeout=5)
    except threading.BrokenBarrierError:
        pass

    # Cancel while deep is blocked (will raise)
    service.cancel_answer(run_id)
    time.sleep(0.05)
    allow_continue.set()
    t.join(timeout=5)
    assert not t.is_alive()

    assert "err" in errors
    # Should be ANSWER_CANCELLED, not LLM_TIMEOUT, because cancelled won first
    assert errors["err"].code == "ANSWER_CANCELLED", (
        f"got {errors['err'].code}: {errors['err'].message}"
    )

    term = service._get_terminal(run_id)
    assert term is not None
    payload, _ = term
    assert payload["status"] == "cancelled"

    # Also check that answer_status returns cancelled
    st = service.call("answer_status", {"run_id": run_id})
    assert st["status"] == "cancelled"


# ---------------------------------------------------------------------------
# Additional: ensure payload identity not used, first-terminal-wins via status
# ---------------------------------------------------------------------------
def test_first_terminal_wins_no_identity_dependency(tmp_path):
    service = make_service(tmp_path)
    run_id = "identity-test-1234"
    # Directly test _store_terminal returns winner payload, not identity
    payload_complete = {
        "status": "complete",
        "run_id": run_id,
        "result": {"answer": "a"},
    }
    payload_cancelled = {"status": "cancelled", "run_id": run_id}

    # Store complete first
    winner1, _, _ = service._store_terminal(run_id, payload_complete, "fp1")
    assert winner1 is not None
    assert winner1 is payload_complete  # first wins is itself

    # Try to store cancelled second — should return existing complete, not cancelled
    winner2, _, _ = service._store_terminal(run_id, payload_cancelled, "fp1")
    assert winner2 is not None
    assert winner2 is winner1
    assert winner2["status"] == "complete"

    # New run_id: store cancelled first
    run_id2 = "identity-test-5678"
    winner3, _, _ = service._store_terminal(run_id2, payload_cancelled, "fp2")
    assert winner3 is not None
    assert winner3["status"] == "cancelled"
    winner4, _, _ = service._store_terminal(run_id2, payload_complete, "fp2")
    assert winner4 is not None
    assert winner4["status"] == "cancelled"
    assert winner4 is winner3
