"""Deterministic concurrent same run_id claim tests — no sleep, barrier outside operation_lock."""

import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from vault_search.config import SearchConfig
from vault_search.service import SearchService
from vault_search.errors import ServiceError
from vault_search.agent_run import AgentRunError, new_run_state


def make_service(tmp_path: Path):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__"
    )
    service = SearchService(config, lambda e, d: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(  # type: ignore[assignment]
        search_detailed=lambda *a, **kw: SimpleNamespace(results=[])
    )
    service.config.mcp_enabled = True
    service.config.mcp_servers = []
    return service


# 2. registry 원자 add 직접 검증 — operation_lock 밖에서 Barrier
def test_registry_atomic_add_same_run_id_one_succeeds_one_conflict(tmp_path):
    service = make_service(tmp_path)
    run_id = "reg-same-1234"
    state1 = new_run_state("hello")
    state1.run_id = run_id
    state2 = new_run_state("hello")
    state2.run_id = run_id
    run1 = SimpleNamespace(state=state1)
    run2 = SimpleNamespace(state=state2)
    # Keep different objects to test identity
    assert run1 is not run2

    barrier = threading.Barrier(2)
    results = {}
    errors = {}
    arrived = []

    def worker(idx, run):
        arrived.append(idx)
        barrier.wait()
        try:
            service.run_registry.add(run)
            results[idx] = run
        except AgentRunError as e:
            errors[idx] = e
        except Exception as e:
            errors[idx] = e

    t1 = threading.Thread(target=lambda: worker(1, run1))
    t2 = threading.Thread(target=lambda: worker(2, run2))
    t1.start()
    t2.start()
    t1.join(timeout=2)
    t2.join(timeout=2)
    assert not t1.is_alive() and not t2.is_alive(), "threads hung"
    # Barrier must have been passed by both (no BrokenBarrierError)
    assert len(arrived) == 2
    # Exactly one add succeeds, other RUN_CONFLICT
    assert len(results) == 1 and len(errors) == 1, (
        f"expected 1 success 1 conflict, got results={results} errors={errors}"
    )
    err = list(errors.values())[0]
    assert isinstance(err, AgentRunError) and err.code == "RUN_CONFLICT"
    # Registry holds winner identity, not loser's object
    winner = list(results.values())[0]
    stored = service.run_registry.get(run_id)
    assert stored is winner, "registry should hold winner object identity, not loser"
    assert stored is not (run2 if winner is run1 else run1)


def test_registry_different_run_id_both_succeed(tmp_path):
    service = make_service(tmp_path)
    state1 = new_run_state("hello")
    state1.run_id = "reg-diff-1"
    state2 = new_run_state("hello")
    state2.run_id = "reg-diff-2"
    run1 = SimpleNamespace(state=state1)
    run2 = SimpleNamespace(state=state2)

    barrier = threading.Barrier(2)
    results = {}
    errors = {}

    def worker(idx, run):
        barrier.wait()
        try:
            service.run_registry.add(run)
            results[idx] = run
        except Exception as e:
            errors[idx] = e

    t1 = threading.Thread(target=lambda: worker(1, run1))
    t2 = threading.Thread(target=lambda: worker(2, run2))
    t1.start()
    t2.start()
    t1.join(timeout=2)
    t2.join(timeout=2)
    assert not t1.is_alive() and not t2.is_alive()
    assert not errors, f"both different run_id should succeed, got {errors}"
    assert len(results) == 2
    assert service.run_registry.get("reg-diff-1") is run1
    assert service.run_registry.get("reg-diff-2") is run2


# 3. public service.call 동시 호출 — operation_lock 직렬화 존중, Barrier는 service.call 밖
def test_public_same_fingerprint_provider_once_both_complete(tmp_path):
    service = make_service(tmp_path)
    run_id = "pub-same-fp-1234"
    params = {
        "query": "hello",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }

    provider_calls = []

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                provider_calls.append(1)
                from vault_search.llm import ProviderTurn

                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    barrier = threading.Barrier(2)
    results = {}
    errors = {}

    # Patch once in main thread, shared by workers
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):

            def worker(idx):
                barrier.wait()
                try:
                    res = service.call("answer_start", params)
                    results[idx] = res
                except Exception as e:
                    errors[idx] = e

            t1 = threading.Thread(target=lambda: worker(1))
            t2 = threading.Thread(target=lambda: worker(2))
            t1.start()
            t2.start()
            t1.join(timeout=2)
            t2.join(timeout=2)

    assert not t1.is_alive() and not t2.is_alive()
    # Barrier must not have broken
    assert barrier.n_waiting == 0 and not barrier.broken
    # Both should succeed, no errors, provider once, same terminal
    assert not errors, f"same fingerprint public should have no errors, got {errors}"
    assert len(results) == 2
    assert all(v.get("status") == "complete" for v in results.values()), (
        f"both should be complete, got {results}"
    )
    # Same terminal
    assert results[1] == results[2] or results[1].get("result") == results[2].get(
        "result"
    )
    assert len(provider_calls) == 1
    term = service._get_terminal(run_id)
    assert term is not None
    payload, fp = term
    assert payload["status"] == "complete"


def test_public_different_fingerprint_one_complete_one_conflict(tmp_path):
    service = make_service(tmp_path)
    run_id = "pub-diff-fp-1234"
    params1 = {
        "query": "hello",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }
    params2 = {
        "query": "different query",
        "conversation": [],
        "max_context_chars": 24000,
        "session_allowed_tools": [],
        "run_id": run_id,
    }

    provider_calls = []

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                provider_calls.append(1)
                from vault_search.llm import ProviderTurn

                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    barrier = threading.Barrier(2)
    results = {}
    errors = {}
    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):

            def w1():
                barrier.wait()
                try:
                    results[1] = service.call("answer_start", params1)
                except Exception as e:
                    errors[1] = e

            def w2():
                barrier.wait()
                try:
                    results[2] = service.call("answer_start", params2)
                except Exception as e:
                    errors[2] = e

            t1 = threading.Thread(target=w1)
            t2 = threading.Thread(target=w2)
            t1.start()
            t2.start()
            t1.join(timeout=2)
            t2.join(timeout=2)

    assert not t1.is_alive() and not t2.is_alive()
    assert barrier.n_waiting == 0 and not barrier.broken
    # Exactly one complete, one RUN_CONFLICT
    assert len(results) == 1 and len(errors) == 1, (
        f"expected 1 complete 1 conflict, got results={results} errors={errors}"
    )
    err = list(errors.values())[0]
    assert isinstance(err, ServiceError) and err.code == "RUN_CONFLICT"
    assert len(provider_calls) == 1
    # Winner terminal exists
    term = service._get_terminal(run_id)
    assert term is not None
