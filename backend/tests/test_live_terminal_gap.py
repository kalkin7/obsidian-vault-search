"""answer_status terminal visibility gap — live→terminal transition must be gap-free.
Before fix (remove→store) the window had neither live nor terminal, so a concurrent
answer_status would get RUN_NOT_FOUND (not RUN_CONFLICT). After fix (store→remove)
terminal is authoritative and visible before live removal.
"""

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


def test_failed_terminal_gap_answer_status_visibility(tmp_path):
    """Structured path: first request ProviderError → failed terminal.
    While first is blocked before _store_terminal (live still present in new code,
    live already removed in old code), concurrent answer_status should see
    live running (new) or at least not RUN_NOT_FOUND. After fix, terminal is
    authoritative.
    """
    service = make_service(tmp_path)
    run_id = "gap-failed-visibility-1234"
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
            assert allow_event.wait(timeout=5), (
                "allow_event wait timed out (test safety)"
            )
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
                        service.call("answer_start", params)
        except ServiceError as e:
            errors["first"] = e
        except Exception as e:
            errors["first"] = e

    t1 = threading.Thread(target=first_thread)
    t1.start()
    assert block_event.wait(timeout=5), "first did not reach store (safety wait)"
    # Second concurrent request via answer_status — should see live running, not RUN_NOT_FOUND
    # Before fix, this was RUN_NOT_FOUND (gap), not RUN_CONFLICT
    second_status = service.call("answer_status", {"run_id": run_id})
    # Must be running (live still present because store before remove) — not RUN_NOT_FOUND
    assert second_status.get("status") in {
        "running",
        "failed",
        "complete",
        "approval_required",
    }

    allow_event.set()
    t1.join(timeout=5)
    assert not t1.is_alive(), "first thread hung"
    # First must be LLM_TIMEOUT
    assert "first" in errors, f"first should have failed with LLM_TIMEOUT, got {errors}"
    assert (
        isinstance(errors["first"], ServiceError)
        and errors["first"].code == "LLM_TIMEOUT"
    ), f"first expected LLM_TIMEOUT, got {errors['first']}"
    # Terminal should be failed
    term = service._get_terminal(run_id)
    assert term is not None
    payload, _ = term
    assert payload["status"] == "failed" and payload["code"] == "LLM_TIMEOUT"
    # Subsequent same request should return same failed terminal
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            res3 = service.call("answer_start", params)
            assert res3["status"] == "failed" and res3["code"] == "LLM_TIMEOUT"
    # Different fingerprint still RUN_CONFLICT
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
    assert len(provider_calls) == 1


def test_pending_cancel_gap_answer_status_visibility(tmp_path):
    """Pending-cancel path: first request consumes pending cancel and publishes cancelled.
    While blocked before store, concurrent answer_status should see live running.
    """
    service = make_service(tmp_path)
    run_id = "gap-pending-visibility-1234"
    params = {
        "query": "hello",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }
    service._pending_cancels[run_id] = 9999999999

    block_event = threading.Event()
    allow_event = threading.Event()
    original_store = service._store_terminal

    def blocked_store(run_id_inner, payload, fingerprint=""):
        if run_id_inner == run_id and payload.get("status") == "cancelled":
            block_event.set()
            assert allow_event.wait(timeout=5), "allow_event wait timed out"
        return original_store(run_id_inner, payload, fingerprint)

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
                        service.call("answer_start", params)
        except ServiceError as e:
            errors["first"] = e
        except Exception as e:
            errors["first"] = e

    t1 = threading.Thread(target=first_thread)
    t1.start()
    assert block_event.wait(timeout=5), "first pending-cancel did not reach store"
    second_status = service.call("answer_status", {"run_id": run_id})
    assert second_status.get("status") in {"running", "cancelled", "approval_required"}

    allow_event.set()
    t1.join(timeout=5)
    assert not t1.is_alive()
    assert (
        "first" in errors
        and isinstance(errors["first"], ServiceError)
        and errors["first"].code == "ANSWER_CANCELLED"
    ), f"first pending-cancel should be ANSWER_CANCELLED, got {errors.get('first')}"
    term = service._get_terminal(run_id)
    assert term is not None and term[0]["status"] == "cancelled"
    # Subsequent same should return cancelled
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            res2 = service.call("answer_start", params)
            assert res2["status"] == "cancelled"
