import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from vault_search.config import SearchConfig
from vault_search.service import SearchService
from vault_search.errors import ServiceError


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


def test_failed_terminal_gap_same_fingerprint_returns_running_or_failed_not_conflict(
    tmp_path,
):
    service = make_service(tmp_path)
    run_id = "gap-failed-same-fp-1234"
    params = {
        "query": "hello",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }

    block_event = threading.Event()
    allow_event = threading.Event()
    original_store = service._store_terminal

    def blocked_store(run_id_inner, payload, fingerprint=""):
        if run_id_inner == run_id and payload.get("status") == "failed":
            block_event.set()
            allow_event.wait(timeout=5)
        return original_store(run_id_inner, payload, fingerprint)

    provider_calls = []

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                provider_calls.append(1)
                from vault_search.llm import ProviderError

                raise ProviderError("LLM_TIMEOUT", "timeout")

        return Fake()

    results = {}
    errors = {}

    def first_thread():
        try:
            with patch("vault_search.service.create_provider", fake_factory):
                with patch(
                    "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
                ):
                    with patch.object(
                        service, "_store_terminal", side_effect=blocked_store
                    ):
                        res = service.call("answer_start", params)
                        results["first"] = res
        except ServiceError as e:
            errors["first"] = e
        except Exception as e:
            errors["first"] = e

    t1 = threading.Thread(target=first_thread)
    t1.start()
    assert block_event.wait(timeout=5), "first did not reach store"

    # Second request same fingerprint while first blocked before store
    # Use answer_status which is not behind operation_lock, to avoid deadlock
    # It should see live running (since new code store before remove, live still present) or terminal after store
    # With old remove->store, it would see no live, no terminal and then on next add would get RUN_CONFLICT
    # With new store->remove, it should see live running
    second_status = service.call("answer_status", {"run_id": run_id})
    assert second_status.get("status") in {
        "running",
        "failed",
        "complete",
        "approval_required",
    }, f"second status {second_status} should be running or failed, not RUN_CONFLICT"
    # Ensure second did not get RUN_CONFLICT
    assert second_status.get("status") != "RUN_CONFLICT"

    # Also try second answer_start same fingerprint - should not get RUN_CONFLICT, should get running or failed
    # But to avoid deadlock with operation_lock held by first, we use answer_status for gap check
    # For completeness, after first stores, second answer_start should return failed terminal
    allow_event.set()
    t1.join(timeout=5)
    assert not t1.is_alive()
    # First should have stored failed
    term = service._get_terminal(run_id)
    assert term is not None
    payload, stored_fp = term
    assert payload["status"] == "failed"
    assert payload["code"] == "LLM_TIMEOUT"
    # Subsequent same request should return same failed terminal, not RUN_CONFLICT
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            res3 = service.call("answer_start", params)
            assert res3["status"] == "failed"
            assert res3["code"] == "LLM_TIMEOUT"
    # Different fingerprint should still be RUN_CONFLICT
    params_diff = {
        "query": "different",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }
    with pytest.raises(ServiceError) as exc:
        with patch("vault_search.service.create_provider", fake_factory):
            with patch(
                "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
            ):
                service.call("answer_start", params_diff)
    assert exc.value.code == "RUN_CONFLICT"
    # Provider should have been called exactly once (first only)
    assert len(provider_calls) == 1


def test_pending_cancel_gap_no_conflict(tmp_path):
    service = make_service(tmp_path)
    # Use structured pending-cancel path: need mcp enabled so structured
    run_id = "gap-pending-cancel-1234"
    params = {
        "query": "hello",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }
    # Set pending cancel before first
    service._pending_cancels[run_id] = 9999999999

    block_event = threading.Event()
    allow_event = threading.Event()
    original_store = service._store_terminal

    def blocked_store(run_id_inner, payload, fingerprint=""):
        if run_id_inner == run_id and payload.get("status") == "cancelled":
            block_event.set()
            allow_event.wait(timeout=5)
        return original_store(run_id_inner, payload, fingerprint)

    results = {}
    errors = {}

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                from vault_search.llm import ProviderTurn

                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    def first_thread():
        try:
            with patch("vault_search.service.create_provider", fake_factory):
                with patch(
                    "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
                ):
                    with patch.object(
                        service, "_store_terminal", side_effect=blocked_store
                    ):
                        res = service.call("answer_start", params)
                        results["first"] = res
        except ServiceError as e:
            errors["first"] = e
        except Exception as e:
            errors["first"] = e

    t1 = threading.Thread(target=first_thread)
    t1.start()
    assert block_event.wait(timeout=5), "first pending-cancel did not reach store"
    # Second same fingerprint while first blocked before store (live still present in new code)
    # Use answer_status to avoid operation_lock deadlock
    second_status = service.call("answer_status", {"run_id": run_id})
    # Should be running (live still present) — not RUN_CONFLICT, and not yet cancelled terminal
    assert second_status.get("status") in {
        "running",
        "cancelled",
        "approval_required",
    }, f"second status {second_status} should be running/cancelled"
    assert second_status.get("status") != "RUN_CONFLICT"

    allow_event.set()
    t1.join(timeout=5)
    assert not t1.is_alive()
    # After first stores cancelled, terminal should be cancelled
    term = service._get_terminal(run_id)
    assert term is not None
    payload, _ = term
    assert payload["status"] == "cancelled"
    # Subsequent same should return cancelled, not RUN_CONFLICT
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            res2 = service.call("answer_start", params)
            assert res2["status"] == "cancelled"
