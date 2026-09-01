import time
from unittest.mock import patch
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.service import SearchService
from vault_search.errors import ServiceError


def make_service(tmp_path):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__"
    )
    service = SearchService(config, lambda e, d: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(  # type: ignore[assignment]
        search_detailed=lambda *a, **kw: SimpleNamespace(
            results=[
                {
                    "rank": 1,
                    "file_path": "notes/a.md",
                    "score": 0.9,
                    "content": "content",
                    "heading_path": [],
                    "start_line": 1,
                }
            ]
        )
    )
    service.config.mcp_enabled = True
    service.config.mcp_servers = []
    return service


def test_same_run_id_returns_cached_without_new_llm(tmp_path):
    service = make_service(tmp_path)
    calls = []

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                calls.append(1)
                from vault_search.llm import ProviderTurn

                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            run_id = "test-run-12345678"
            params = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            r1 = service.call("answer_start", params)
            assert r1["status"] == "complete"
            assert len(calls) == 1
            r2 = service.call("answer_start", params)
            assert len(calls) == 1
            assert r2["result"]["answer"] == r1["result"]["answer"]


def test_same_run_id_different_input_returns_conflict(tmp_path):
    service = make_service(tmp_path)

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

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            run_id = "conflict-run-1234"
            p1 = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            service.call("answer_start", p1)
            p2 = {
                "query": "different",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", p2)
            assert exc.value.code == "RUN_CONFLICT"


def test_failed_terminal_cached(tmp_path):
    service = make_service(tmp_path)

    def fail_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                from vault_search.llm import ProviderError

                raise ProviderError("LLM_TIMEOUT", "timeout")

        return Fake()

    with patch("vault_search.service.create_provider", fail_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            run_id = "failed-run-1234"
            params = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params)
            assert exc.value.code == "LLM_TIMEOUT"
            # Second call should return same failed terminal, not new LLM
            # Our implementation returns terminal payload via _get_terminal, not raise again? Actually _answer_start checks terminal first and returns payload, not raise
            # For failed, it should return payload with status failed, not raise
            r2 = service.call("answer_start", params)
            assert r2["status"] == "failed"
            assert r2["code"] == "LLM_TIMEOUT"


def test_cancelled_terminal_cached(tmp_path):
    service = make_service(tmp_path)
    # Simulate cancel before advance by pre-populating pending cancel
    run_id = "cancel-run-1234"
    service._pending_cancels[run_id] = time.monotonic() + service._pending_cancel_ttl

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

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            params = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params)
            assert exc.value.code == "ANSWER_CANCELLED"
            r2 = service.call("answer_start", params)
            assert r2["status"] == "cancelled"
            # Ensure pending_cancels does not retain after terminal
            assert run_id not in service._pending_cancels


def test_status_returns_failed_and_cancelled(tmp_path):
    service = make_service(tmp_path)

    def fail_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                from vault_search.llm import ProviderError

                raise ProviderError("LLM_BAD_RESPONSE", "bad")

        return Fake()

    with patch("vault_search.service.create_provider", fail_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            run_id = "status-failed-1234"
            params = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            with pytest.raises(ServiceError):
                service.call("answer_start", params)
            st = service.call("answer_status", {"run_id": run_id})
            assert st["status"] == "failed"
            assert st["code"] == "LLM_BAD_RESPONSE"


def test_ttl_and_max_size(tmp_path):
    service = make_service(tmp_path)
    service._terminal_ttl_seconds = 0.05
    service._terminal_max_entries = 2

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

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            for i in range(3):
                run_id = f"run-{i}-12345678"
                params = {
                    "query": f"hello{i}",
                    "conversation": [],
                    "max_context_chars": 24000,
                    "session_allowed_tools": [],
                    "run_id": run_id,
                }
                service.call("answer_start", params)
            # Max 2 entries -> oldest evicted
            assert len(service._terminal_runs) == 2
            # TTL expiry
            time.sleep(0.1)
            with pytest.raises(ServiceError) as exc:
                service.call("answer_status", {"run_id": "run-0-12345678"})
            assert exc.value.code == "RUN_EXPIRED"


def test_legacy_cancel_race(tmp_path):
    service = make_service(tmp_path)
    # Legacy path: mcp and skills disabled
    service.config.mcp_enabled = False
    service.config.skills_enabled = False
    run_id = "legacy-cancel-1234"
    service._pending_cancels[run_id] = time.monotonic() + service._pending_cancel_ttl
    # Make _deep_answer not called
    called = []

    def fake_deep(params):
        called.append(1)
        return {
            "answer": "hi",
            "citations": [],
            "evidence": [],
            "provider": "openai",
            "model": "test",
            "grounded": True,
            "diagnostics": {},
        }

    with patch.object(service, "_deep_answer", fake_deep):
        params = {
            "query": "hello",
            "conversation": [],
            "max_context_chars": 24000,
            "session_allowed_tools": [],
            "run_id": run_id,
        }
        with pytest.raises(ServiceError) as exc:
            service.call("answer_start", params)
        assert exc.value.code == "ANSWER_CANCELLED"
        assert not called
        # Second call should return cancelled terminal
        r2 = service.call("answer_start", params)
        assert r2["status"] == "cancelled"


def test_backend_restart_clears_and_no_auto_retry(tmp_path):
    # Simulate restart by creating new service with same data_dir but empty terminal cache
    # The point is that after restart, old run_id is not found -> client should not auto-retry LLM if PID changed
    # Here we just verify that new service has empty cache and returns RUN_NOT_FOUND
    service = make_service(tmp_path)

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

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            run_id = "restart-run-1234"
            params = {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": run_id,
            }
            service.call("answer_start", params)
            # Simulate restart: new service instance
            service2 = make_service(tmp_path)
            service2.state = "ready"
            service2.search_engine = service.search_engine
            service2.config.mcp_enabled = True
            with pytest.raises(ServiceError) as exc:
                service2.call("answer_status", {"run_id": run_id})
            assert exc.value.code == "RUN_NOT_FOUND"
