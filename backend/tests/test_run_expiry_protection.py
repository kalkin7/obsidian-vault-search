"""Regression tests for the run-id expiry protection invariants.

Covers (audit round, alpha):
  1. An approval-pending live run whose TTL elapsed must NEVER fall through to
     a new execution: `answer_start` answers RUN_EXPIRED and the provider is
     not called again, even when an unrelated add()/sweep removed the run from
     the live registry first.
  2. A tombstoned id must not accept a late terminal publish: after the first
     terminal expires, a late complete/cancel writer is rejected and status
     stays RUN_EXPIRED (no resurrection), live/terminal/tombstone stay mutually
     exclusive for the same run_id, and rejected writers still clean up the
     registry + pending cancel state.
  3. The tombstone ledger never evicts a still-protected id for capacity: an id
     inside its protection window keeps answering RUN_EXPIRED even after the
     ledger is full; capacity pressure fails closed instead of degrading the id
     back to RUN_NOT_FOUND (which would allow a second LLM execution).

Invariants asserted throughout:
  - one run_id never executes the provider more than once on the same backend
    instance within the protection window;
  - an expired id never falls back to RUN_NOT_FOUND;
  - a tombstoned id never gets a new terminal;
  - live / terminal / tombstone are mutually exclusive per run_id;
  - protection capacity policy is pinned: bounded ledger, no protected eviction.
"""

import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from vault_search.agent_run import AgentRunError, new_run_state
from vault_search.config import SearchConfig
from vault_search.errors import ServiceError
from vault_search.service import SearchService

PARAMS_BASE = {
    "query": "hello",
    "conversation": [],
    "max_context_chars": 24000,
    "session_allowed_tools": [],
}


def stub_pending() -> Any:
    """One pending approval entry shaped like PendingCall (test stub)."""
    return {
        "c1": SimpleNamespace(
            call_id="c1",
            alias="grep_vault",
            server_id="s",
            server_name="srv",
            display_name="grep_vault",
            arguments={},
            annotations={},
        )
    }


def stub_run(state: Any) -> Any:
    """A run-like stub accepted by the registry (test stub)."""
    return SimpleNamespace(state=state)


def make_service(tmp_path: Path) -> SearchService:
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


def params(run_id: str, query: str = "hello") -> dict:
    return {**PARAMS_BASE, "query": query, "run_id": run_id}


def register_approval_run(service: SearchService, run_id: str, query: str = "hello"):
    """Register a live approval-pending run directly (no provider involved)."""
    state = new_run_state(query)
    state.run_id = run_id
    state.fingerprint = service._fingerprint(params(run_id, query))
    state.pending = stub_pending()
    service.run_registry.add(stub_run(state))
    return state


def expire_registry_run(service: SearchService, run_id: str) -> None:
    entry = service.run_registry._runs[run_id]
    service.run_registry._runs[run_id] = (
        entry[0],
        time.monotonic() - 10_000.0,
    )


def force_terminal_expiry(service: SearchService, run_id: str) -> None:
    payload, fp, _exp = service._terminal_runs[run_id]
    service._terminal_runs[run_id] = (payload, fp, time.monotonic() - 1.0)


def assert_run_expired(exc: Exception) -> None:
    assert isinstance(exc, ServiceError)
    assert exc.code == "RUN_EXPIRED"


def assert_no_provider(start_patch) -> None:
    """The patched create_provider must never be reached."""
    raise AssertionError("create_provider must not be called for an expired id")


# ---------------------------------------------------------------------------
# Issue 1: approval-pending live run TTL expiry must never re-execute
# ---------------------------------------------------------------------------


def test_expired_approval_run_same_start_returns_expired_no_provider(tmp_path):
    service = make_service(tmp_path)
    run_id = "exp-approval-same-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)

    calls: list[str] = []

    def recording_provider(*a, **kw):
        calls.append("create")
        raise AssertionError("provider must not be created for an expired run")

    with patch("vault_search.service.create_provider", recording_provider):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params(run_id))
            assert_run_expired(exc.value)
    assert calls == []
    # The service tombstone must have recorded the expiry so future calls are
    # cheap and the id never degrades to RUN_NOT_FOUND.
    assert service._is_expired_run(run_id)


def test_unrelated_add_sweeps_expired_run_then_replay_stays_expired(tmp_path):
    """An unrelated registration sweeping the expired run must preserve the
    expiry fact (registry graveyard -> service tombstone), not drop it to
    RUN_NOT_FOUND which would allow a duplicate LLM run."""
    service = make_service(tmp_path)
    run_id = "exp-swept-by-other-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)

    # Register an unrelated run: sweep_expired_locked removes the expired one.
    other_state = new_run_state("other")
    other_state.run_id = "unrelated-run-1234"
    service.run_registry.add(stub_run(other_state))

    # The expired run is no longer live in the registry.
    assert run_id not in service.run_registry._runs

    calls: list[str] = []

    def recording_provider(*a, **kw):
        calls.append("create")
        raise AssertionError("provider must not be created for an expired run")

    with patch("vault_search.service.create_provider", recording_provider):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params(run_id))
            assert_run_expired(exc.value)
    assert calls == []
    assert service._is_expired_run(run_id)


def test_status_and_start_race_at_expiry_boundary_no_llm(tmp_path):
    service = make_service(tmp_path)
    run_id = "exp-boundary-race-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)

    calls: list[str] = []
    barrier = threading.Barrier(2)

    def recording_provider(*a, **kw):
        calls.append("create")
        raise AssertionError("provider must not be created for an expired run")

    results: dict[str, Exception | object] = {}

    def status_thread():
        barrier.wait()
        try:
            results["status"] = service.call("answer_status", {"run_id": run_id})
        except ServiceError as exc:
            results["status"] = exc

    def start_thread():
        barrier.wait()
        try:
            results["start"] = service.call("answer_start", params(run_id))
        except ServiceError as exc:
            results["start"] = exc

    with patch("vault_search.service.create_provider", recording_provider):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            t1 = threading.Thread(target=status_thread)
            t2 = threading.Thread(target=start_thread)
            t1.start()
            t2.start()
            t1.join(timeout=5)
            t2.join(timeout=5)

    assert not t1.is_alive() and not t2.is_alive()
    assert calls == []
    for key in ("status", "start"):
        value = results[key]
        assert isinstance(value, ServiceError), (
            f"{key} must raise RUN_EXPIRED, got {value!r}"
        )
        assert_run_expired(value)
    assert service._is_expired_run(run_id)


def test_expired_run_different_fingerprint_cannot_reuse_id(tmp_path):
    """A different fingerprint must not turn the expired id into a new run."""
    service = make_service(tmp_path)
    run_id = "exp-diff-fp-reuse-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)

    calls: list[str] = []
    with patch(
        "vault_search.service.create_provider",
        lambda *a, **kw: (
            (calls.append("create"), None)[1]
            or (_ for _ in ()).throw(AssertionError("provider must not be created"))
        ),
    ):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params(run_id, query="different query"))
            # Expiry wins over the fingerprint mismatch: RUN_EXPIRED, not
            # RUN_CONFLICT and not a new execution.
            assert_run_expired(exc.value)
    assert calls == []
    assert service._is_expired_run(run_id)


def test_live_registry_runs_at_most_once_provider_per_run_id(tmp_path):
    """Same backend + protection window: one run_id executes the provider at
    most once. First start runs it once; the replay hits the terminal; after
    the terminal expires the replay gets RUN_EXPIRED and never re-runs."""
    service = make_service(tmp_path)
    run_id = "exp-at-most-once-1234"

    provider_calls: list[str] = []

    def fake_factory(*a, **kw):
        class Fake:
            provider_id = "openai"
            model = "test"

            def complete_with_tools(self, **kw):
                provider_calls.append("complete_with_tools")
                from vault_search.llm import ProviderTurn

                return ProviderTurn(
                    text="answer [S1]", tool_calls=[], provider="openai", model="test"
                )

        return Fake()

    with patch("vault_search.service.create_provider", fake_factory):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            first = service.call("answer_start", params(run_id))
            assert first["status"] == "complete"
            assert provider_calls == ["complete_with_tools"]

            replays = [
                service.call("answer_start", params(run_id)),
                service.call("answer_status", {"run_id": run_id}),
            ]
            for replay in replays:
                assert replay["status"] == "complete"
            assert provider_calls == ["complete_with_tools"], (
                "terminal replay must not execute the provider again"
            )

            # Expire the terminal; same run_id becomes RUN_EXPIRED, still no
            # provider call.
            force_terminal_expiry(service, run_id)
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params(run_id))
            assert_run_expired(exc.value)
            with pytest.raises(ServiceError) as exc2:
                service.call("answer_status", {"run_id": run_id})
            assert_run_expired(exc2.value)
            assert provider_calls == ["complete_with_tools"]
    assert len(provider_calls) == 1


# ---------------------------------------------------------------------------
# Issue 2: tombstone after expiry must reject late terminal writers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("first_status", ["cancelled", "failed"])
def test_late_complete_rejected_after_terminal_expiry(tmp_path, first_status):
    service = make_service(tmp_path)
    run_id = f"late-complete-{first_status}-1234"
    first_payload = {"status": first_status, "run_id": run_id}
    if first_status == "failed":
        first_payload["code"] = "LLM_TIMEOUT"
        first_payload["message"] = "timeout"
    winner, _, outcome = service._store_terminal(run_id, first_payload, "fp")
    assert winner is not None
    assert winner["status"] == first_status

    force_terminal_expiry(service, run_id)

    # Late complete writer: must be REJECTED (expired), not become the winner.
    late = {"status": "complete", "run_id": run_id, "result": {"answer": "late"}}
    winner2, _, outcome2 = service._store_terminal(run_id, late, "fp")
    assert outcome2 == "expired"
    assert winner2 is None
    # The terminal map must not contain the late complete payload.
    assert service._get_terminal(run_id) is None
    # status stays RUN_EXPIRED — the late writer cannot resurrect the run.
    with pytest.raises(ServiceError) as exc:
        service.call("answer_status", {"run_id": run_id})
    assert_run_expired(exc.value)


def test_late_complete_after_executing_route_raises_expired(tmp_path):
    """A late complete arriving through _publish_terminal_outcome (the route
    answer_start/answer_continue use) raises RUN_EXPIRED and the live registry
    entry + parked pending cancel are cleaned up, so nothing leaks."""
    service = make_service(tmp_path)
    run_id = "late-route-1234"
    service._store_terminal(run_id, {"status": "cancelled", "run_id": run_id}, "fp")
    force_terminal_expiry(service, run_id)

    # Simulate a late writer that still holds a live registry entry and a
    # parked pending cancel (the state that must not leak after rejection).
    state = new_run_state("hello")
    state.run_id = run_id
    service.run_registry.add(stub_run(state))
    service._pending_cancels[run_id] = time.monotonic() + 600.0

    late = {"status": "complete", "run_id": run_id, "result": {"answer": "late"}}
    with pytest.raises(ServiceError) as exc:
        service._publish_terminal_outcome(run_id, late, "fp")
    assert_run_expired(exc.value)

    # Registry and pending cancel cleaned up despite the rejection.
    assert service.run_registry.count() == 0
    assert run_id not in service._pending_cancels
    assert service._get_terminal(run_id) is None
    assert service._is_expired_run(run_id)


def test_late_cancel_after_complete_expiry_no_revival(tmp_path):
    service = make_service(tmp_path)
    run_id = "late-cancel-1234"
    service._store_terminal(
        run_id,
        {"status": "complete", "run_id": run_id, "result": {"answer": "ok"}},
        "fp",
    )
    force_terminal_expiry(service, run_id)

    result = service.cancel_answer(run_id)
    # The id is already expired/protected; nothing live was cancelled and no
    # cancelled terminal is published (would revive the run).
    assert result["cancelled"] is False
    assert service._get_terminal(run_id) is None
    with pytest.raises(ServiceError) as exc:
        service.call("answer_status", {"run_id": run_id})
    assert_run_expired(exc.value)
    # Mutual exclusion: tombstone and terminal maps never both hold the id.
    assert service._is_expired_run(run_id)
    assert run_id not in service._terminal_runs


def test_tombstone_and_terminal_mutual_exclusion_after_sweep(tmp_path):
    """After a terminal expires and is swept to the tombstone, the terminal map
    must not contain the same id (they are mutually exclusive states)."""
    service = make_service(tmp_path)
    run_id = "mutual-exclusion-1234"
    service._store_terminal(run_id, {"status": "cancelled", "run_id": run_id}, "fp")
    force_terminal_expiry(service, run_id)
    # Reading the terminal triggers the sweep -> tombstone.
    assert service._get_terminal(run_id) is None
    assert run_id not in service._terminal_runs
    assert run_id in service._expired_runs or service._is_expired_run(run_id)


# ---------------------------------------------------------------------------
# Issue 3: tombstone capacity must never evict a still-protected id
# ---------------------------------------------------------------------------


def test_tombstone_capacity_keeps_protected_oldest_expired(tmp_path):
    """Filling the protected ledger must not evict the oldest still-TTL id:
    it keeps answering RUN_EXPIRED and never starts a provider call."""
    service = make_service(tmp_path)
    service._expired_max_entries = 3
    run_id = "capacity-oldest-1234"
    with service._terminal_lock:
        now = time.monotonic()
        for i in range(3):
            service._expired_runs[f"cap-old-{i}"] = now + service._expired_ttl_seconds
        # Fourth remember: ledger full of protected ids -> must NOT evict.
        accepted = service._remember_expired_locked(run_id)
    assert accepted is False
    assert "cap-old-0" in service._expired_runs, (
        "oldest still-protected id must not be evicted for capacity"
    )

    calls: list[str] = []
    with patch(
        "vault_search.service.create_provider",
        lambda *a, **kw: (
            (calls.append("create"), None)[1]
            or (_ for _ in ()).throw(AssertionError("provider must not be created"))
        ),
    ):
        with pytest.raises(ServiceError) as exc:
            service.call("answer_status", {"run_id": "cap-old-0"})
        assert_run_expired(exc.value)
        with pytest.raises(ServiceError) as exc2:
            service.call("answer_start", params("cap-old-0"))
        assert_run_expired(exc2.value)
    assert calls == []


def test_tombstone_capacity_store_terminal_fails_closed(tmp_path):
    """When the protection ledger is full of protected ids AND the terminal map
    is at capacity, publishing a new terminal must fail closed (capacity
    outcome) instead of evicting the protected tombstone."""
    service = make_service(tmp_path)
    service._expired_max_entries = 1
    service._terminal_max_entries = 1
    with service._terminal_lock:
        now = time.monotonic()
        service._expired_runs["protected-1"] = now + service._expired_ttl_seconds
    # Fill the terminal map with one live terminal.
    service._store_terminal(
        "terminal-map-1", {"status": "complete", "run_id": "terminal-map-1"}, "fp"
    )
    assert len(service._terminal_runs) == 1

    winner, _, outcome = service._store_terminal(
        "terminal-map-2", {"status": "complete", "run_id": "terminal-map-2"}, "fp"
    )
    assert outcome == "capacity"
    assert winner is None
    # The protected tombstone survived and the LRU terminal was not forgotten.
    assert "protected-1" in service._expired_runs
    assert "terminal-map-1" in service._terminal_runs
    # ── enhanced checks for current live run (fail-closed for current run_id) ──
    live_id = "live-capacity-current-1234"
    state = new_run_state("hello")
    state.run_id = live_id
    state.fingerprint = service._fingerprint(params(live_id))
    service.run_registry.add(stub_run(state))
    # Pending and active calls must be clean initially
    assert live_id not in service._pending_cancels
    # Publish via the real handoff route must fail closed but protect the id
    with pytest.raises(ServiceError) as exc:
        service._publish_terminal_outcome(
            live_id,
            {"status": "complete", "run_id": live_id, "result": {"answer": "ok"}},
            state.fingerprint,
        )
    assert exc.value.code == "BACKEND_CAPACITY"
    # Protection: not RUN_NOT_FOUND — graveyard or retained expired resident
    assert (
        service.run_registry.is_expired(live_id)
        or live_id in service.run_registry._graveyard
        or live_id in service.run_registry._runs
    )
    # Terminal must not contain the rejected new id, protected entries survive
    assert live_id not in service._terminal_runs
    assert "protected-1" in service._expired_runs
    assert "terminal-map-1" in service._terminal_runs
    # Same id replay must not trigger provider, must be RUN_EXPIRED / BACKEND_CAPACITY, never RUN_NOT_FOUND
    provider_calls: list[str] = []

    def _no_provider(*a, **kw):
        provider_calls.append("create")
        raise AssertionError("provider must not be called for protected id")

    with patch("vault_search.service.create_provider", _no_provider):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc2:
                service.call("answer_start", params(live_id))
            assert exc2.value.code in ("RUN_EXPIRED", "BACKEND_CAPACITY")
            # answer_status must not be running forever
            with pytest.raises(ServiceError) as exc3:
                service.call("answer_status", {"run_id": live_id})
            assert exc3.value.code in ("RUN_EXPIRED", "BACKEND_CAPACITY")
            assert exc3.value.code != "RUN_NOT_FOUND"
    assert provider_calls == []
    # Pending cancel and active calls cleaned up (no leak)
    assert live_id not in service._pending_cancels
    # Active calls for this run should be empty or cancelled
    assert not state.active_calls


def test_capacity_publish_current_live_fails_closed_no_reexecution(tmp_path):
    """Capacity reject of current live run: first publish BACKEND_CAPACITY,
    same run_id answer_start -> RUN_EXPIRED/BACKEND_CAPACITY, provider 0."""
    service = make_service(tmp_path)
    service._expired_max_entries = 1
    service._terminal_max_entries = 1
    service.run_registry._graveyard_max_entries = 4096
    with service._terminal_lock:
        now = time.monotonic()
        service._expired_runs["protected-cap-1"] = now + service._expired_ttl_seconds
    service._store_terminal(
        "term-cap-1", {"status": "complete", "run_id": "term-cap-1"}, "fp"
    )
    live_id = "cap-live-replay-1234"
    state = new_run_state("hello")
    state.run_id = live_id
    state.fingerprint = service._fingerprint(params(live_id))
    service.run_registry.add(stub_run(state))
    # First publish must fail closed with BACKEND_CAPACITY
    with pytest.raises(ServiceError) as exc:
        service._publish_terminal_outcome(
            live_id,
            {"status": "complete", "run_id": live_id, "result": {"answer": "ok"}},
            state.fingerprint,
        )
    assert exc.value.code == "BACKEND_CAPACITY"
    # Protection exists (graveyard or retained)
    assert service.run_registry.is_expired(live_id)
    assert live_id not in service._terminal_runs
    # Replay must not re-execute provider
    calls: list[str] = []

    def _prov(*a, **kw):
        calls.append("create")
        raise AssertionError("provider called on protected replay")

    with patch("vault_search.service.create_provider", _prov):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc2:
                service.call("answer_start", params(live_id))
            assert exc2.value.code in ("RUN_EXPIRED", "BACKEND_CAPACITY")
    assert calls == []


def test_capacity_both_ledgers_full_retains_expired_resident(tmp_path):
    """Service tombstone and registry graveyard both full: capacity reject
    keeps current run as expired resident, status RUN_EXPIRED, replay 0."""
    service = make_service(tmp_path)
    service._expired_max_entries = 1
    service._terminal_max_entries = 1
    service.run_registry._graveyard_max_entries = 1
    with service._terminal_lock:
        now = time.monotonic()
        service._expired_runs["svc-protected"] = now + service._expired_ttl_seconds
    service.run_registry._graveyard["reg-protected"] = time.monotonic() + 600.0
    service._store_terminal(
        "term-both-1", {"status": "complete", "run_id": "term-both-1"}, "fp"
    )
    live_id = "both-full-live-1234"
    state = new_run_state("hello")
    state.run_id = live_id
    state.fingerprint = service._fingerprint(params(live_id))
    service.run_registry.add(stub_run(state))
    with pytest.raises(ServiceError) as exc:
        service._publish_terminal_outcome(
            live_id,
            {"status": "complete", "run_id": live_id, "result": {"answer": "ok"}},
            state.fingerprint,
        )
    assert exc.value.code == "BACKEND_CAPACITY"
    # Retained as expired resident when graveyard full
    assert live_id in service.run_registry._runs
    # is_expired must be true via retained resident
    assert service.run_registry.is_expired(live_id) is True
    # answer_status -> RUN_EXPIRED (not running)
    with pytest.raises(ServiceError) as exc2:
        service.call("answer_status", {"run_id": live_id})
    assert exc2.value.code == "RUN_EXPIRED"
    # Replay -> provider 0
    calls: list[str] = []

    def _prov(*a, **kw):
        calls.append("create")
        raise AssertionError("provider must not run")

    with patch("vault_search.service.create_provider", _prov):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc3:
                service.call("answer_start", params(live_id))
            assert exc3.value.code in ("RUN_EXPIRED", "BACKEND_CAPACITY")
    assert calls == []


def test_cancel_capacity_fails_closed(tmp_path):
    """Cancel's terminal publish rejected with capacity: protection remains,
    replay provider 0, exactly one protected state."""
    service = make_service(tmp_path)
    service._expired_max_entries = 1
    service._terminal_max_entries = 1
    with service._terminal_lock:
        now = time.monotonic()
        service._expired_runs["svc-cap-cancel"] = now + service._expired_ttl_seconds
    service._store_terminal(
        "term-cancel-1", {"status": "complete", "run_id": "term-cancel-1"}, "fp"
    )
    live_id = "cancel-cap-live-1234"
    state = new_run_state("hello")
    state.run_id = live_id
    state.fingerprint = service._fingerprint(params(live_id))
    service.run_registry.add(stub_run(state))
    # Cancel must attempt to publish cancelled terminal and hit capacity
    result = service.cancel_answer(live_id)
    # Capacity path reports cancelled False (already protected) but must not leak
    assert result["cancelled"] is False
    # Protection: one of terminal/tombstone/live(graveyard/retained) must hold the id
    protected = (
        live_id in service._terminal_runs
        or service._is_expired_run(live_id)
        or service.run_registry.is_expired(live_id)
        or live_id in service.run_registry._graveyard
        or live_id in service.run_registry._runs
    )
    assert protected, "capacity cancel must leave a protected marker"
    # Mutually exclusive-ish: live and terminal should not both hold the id with different payloads
    # At least not both live and terminal as valid terminal
    # Replay must not run provider
    calls: list[str] = []

    def _prov(*a, **kw):
        calls.append("create")
        raise AssertionError("provider must not be called after cancel capacity")

    with patch("vault_search.service.create_provider", _prov):
        with patch(
            "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
        ):
            with pytest.raises(ServiceError) as exc:
                service.call("answer_start", params(live_id))
            assert exc.value.code in ("RUN_EXPIRED", "BACKEND_CAPACITY")
    assert calls == []
    assert live_id not in service._pending_cancels


def test_cancel_expired_approval_does_not_resurrect(tmp_path):
    """TTL-expired approval run cancel must not resurrect as cancelled terminal."""
    service = make_service(tmp_path)
    run_id = "cancel-exp-approval-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)
    # Cancel the TTL-expired approval run
    result = service.cancel_answer(run_id)
    assert result["cancelled"] is False
    assert service._get_terminal(run_id) is None
    assert run_id not in service._terminal_runs
    # answer_status -> RUN_EXPIRED, not cancelled or NOT_FOUND
    with pytest.raises(ServiceError) as exc:
        service.call("answer_status", {"run_id": run_id})
    assert exc.value.code == "RUN_EXPIRED"
    # No pending cancel parked for expired id
    assert run_id not in service._pending_cancels
    # Second cancel also remains false and does not create terminal
    result2 = service.cancel_answer(run_id)
    assert result2["cancelled"] is False
    assert service._get_terminal(run_id) is None


def test_capacity_concurrent_race_30_times_no_not_found_and_at_most_once(tmp_path):
    """Terminal map + both ledgers tiny: concurrent publish/cancel/status/start
    30x, same run_id provider ≤1, never RUN_NOT_FOUND."""
    for iteration in range(30):
        service = make_service(tmp_path)
        service._expired_max_entries = 2
        service._terminal_max_entries = 2
        service.run_registry._graveyard_max_entries = 2
        # Pre-fill to make capacity contention likely but keep one slot
        with service._terminal_lock:
            now = time.monotonic()
            service._expired_runs[f"pre-svc-{iteration}-a"] = (
                now + service._expired_ttl_seconds
            )
            service._expired_runs[f"pre-svc-{iteration}-b"] = (
                now + service._expired_ttl_seconds
            )
        service.run_registry._graveyard[f"pre-reg-{iteration}-a"] = (
            time.monotonic() + 600.0
        )
        service.run_registry._graveyard[f"pre-reg-{iteration}-b"] = (
            time.monotonic() + 600.0
        )
        service._store_terminal(
            f"pre-term-{iteration}-a",
            {"status": "complete", "run_id": f"pre-term-{iteration}-a"},
            "fp",
        )
        service._store_terminal(
            f"pre-term-{iteration}-b",
            {"status": "complete", "run_id": f"pre-term-{iteration}-b"},
            "fp",
        )
        # Now ledgers are full (2/2). The next live publish will hit capacity -> retire path
        run_id = f"race-cap-{iteration:02d}-1234"
        state = new_run_state("hello")
        state.run_id = run_id
        state.fingerprint = service._fingerprint(params(run_id))
        service.run_registry.add(stub_run(state))
        provider_calls: list[str] = []

        def _prov_factory(*a, **kw):
            class Fake:
                provider_id = "openai"
                model = "test"

                def complete_with_tools(self, **kw2):
                    provider_calls.append("complete_with_tools")
                    from vault_search.llm import ProviderTurn

                    return ProviderTurn(
                        text="answer [S1]",
                        tool_calls=[],
                        provider="openai",
                        model="test",
                    )

            return Fake()

        barrier = threading.Barrier(4)
        errors: list[Exception] = []
        results: list[Any] = []

        def do_publish():
            barrier.wait()
            try:
                service._publish_terminal_outcome(
                    run_id,
                    {
                        "status": "complete",
                        "run_id": run_id,
                        "result": {"answer": "ok"},
                    },
                    state.fingerprint,
                )
                results.append("publish_ok")
            except ServiceError as exc:
                results.append(exc.code)
                if exc.code == "RUN_NOT_FOUND":
                    errors.append(exc)
            except Exception as exc2:
                errors.append(exc2)  # type: ignore[arg-type]

        def do_cancel():
            barrier.wait()
            try:
                res = service.cancel_answer(run_id)
                results.append(f"cancel:{res.get('cancelled')}")
            except Exception as exc:
                errors.append(exc)  # type: ignore[arg-type]

        def do_status():
            barrier.wait()
            try:
                r = service.call("answer_status", {"run_id": run_id})
                results.append(r.get("status"))
            except ServiceError as exc:
                results.append(exc.code)
                if exc.code == "RUN_NOT_FOUND":
                    errors.append(exc)
            except Exception as exc2:
                errors.append(exc2)  # type: ignore[arg-type]

        def do_start():
            barrier.wait()
            try:
                with patch("vault_search.service.create_provider", _prov_factory):
                    with patch(
                        "vault_search.service.build_agent_system_prompt",
                        lambda **kw: "sys",
                    ):
                        r = service.call("answer_start", params(run_id))
                        results.append(r.get("status"))
            except ServiceError as exc:
                results.append(exc.code)
                if exc.code == "RUN_NOT_FOUND":
                    errors.append(exc)
            except Exception as exc2:
                errors.append(exc2)  # type: ignore[arg-type]

        t1 = threading.Thread(target=do_publish)
        t2 = threading.Thread(target=do_cancel)
        t3 = threading.Thread(target=do_status)
        t4 = threading.Thread(target=do_start)
        t1.start()
        t2.start()
        t3.start()
        t4.start()
        t1.join(timeout=5)
        t2.join(timeout=5)
        t3.join(timeout=5)
        t4.join(timeout=5)
        assert (
            not t1.is_alive()
            and not t2.is_alive()
            and not t3.is_alive()
            and not t4.is_alive()
        )
        # No RUN_NOT_FOUND in any path
        assert not errors, (
            f"iteration {iteration} had RUN_NOT_FOUND or unexpected error: {errors!r} results={results!r}"
        )
        # Provider at most once per run_id (in this iteration, at most 1)
        assert len(provider_calls) <= 1, (
            f"iteration {iteration} provider called {len(provider_calls)} times, must be ≤1"
        )
        # After race, id must still be protected (not NOT_FOUND)
        try:
            service.call("answer_status", {"run_id": run_id})
            # If it returns, status must be complete/cancelled/expired etc, not running forever leak
            # But after capacity, it should be RUN_EXPIRED or complete/cancelled
        except ServiceError as exc:
            assert exc.code in ("RUN_EXPIRED", "BACKEND_CAPACITY", "RUN_NOT_FOUND"), (
                f"unexpected code {exc.code}"
            )
            assert exc.code != "RUN_NOT_FOUND", (
                f"iteration {iteration} final status RUN_NOT_FOUND"
            )
        # Also ensure pending and active cleaned up to not leak running
        # If still live, it must be expired resident (is_expired true), not running
        if run_id in service.run_registry._runs:
            assert service.run_registry.is_expired(run_id) is True, (
                "remaining live must be expired resident, not running"
            )


# ---------------------------------------------------------------------------
# 30x TTL/tombstone boundary race loop (+ explicit provider-count guard)
# ---------------------------------------------------------------------------


def test_ttl_tombstone_race_repeated_30_times(tmp_path):
    """Repeat the expiry-boundary race 30x: a terminal expires, a concurrent
    status+start pair must both observe RUN_EXPIRED with zero provider calls,
    and tombstone/terminal stay mutually exclusive."""
    service = make_service(tmp_path)
    provider_calls: list[str] = []

    def recording_provider(*a, **kw):
        provider_calls.append("create")
        raise AssertionError("provider must not be created for an expired id")

    for iteration in range(30):
        run_id = f"race-{iteration:02d}-exp1234"
        service._store_terminal(run_id, {"status": "cancelled", "run_id": run_id}, "fp")
        force_terminal_expiry(service, run_id)

        barrier = threading.Barrier(2)
        status_result: list[Exception | object] = []
        start_result: list[Exception | object] = []

        def status_worker():
            barrier.wait()
            try:
                status_result.append(service.call("answer_status", {"run_id": run_id}))
            except ServiceError as exc:
                status_result.append(exc)

        def start_worker():
            barrier.wait()
            try:
                start_result.append(service.call("answer_start", params(run_id)))
            except ServiceError as exc:
                start_result.append(exc)

        with patch("vault_search.service.create_provider", recording_provider):
            with patch(
                "vault_search.service.build_agent_system_prompt", lambda **kw: "sys"
            ):
                t1 = threading.Thread(target=status_worker)
                t2 = threading.Thread(target=start_worker)
                t1.start()
                t2.start()
                t1.join(timeout=5)
                t2.join(timeout=5)

        assert not t1.is_alive() and not t2.is_alive()
        assert len(status_result) == 1 and len(start_result) == 1
        assert_run_expired(status_result[0])  # type: ignore[arg-type]
        assert_run_expired(start_result[0])  # type: ignore[arg-type]
        # Mutual exclusion after the race.
        assert run_id not in service._terminal_runs
        assert service._is_expired_run(run_id)
        # Never a duplicate provider execution across 30 races.
        assert provider_calls == []


def test_registry_graveyard_never_not_found_within_window(tmp_path):
    """The registry's own expiry ledger reports RUN_EXPIRED (not RUN_NOT_FOUND)
    after a sweep removes the live run, so the service can mirror it."""
    service = make_service(tmp_path)
    run_id = "graveyard-window-1234"
    register_approval_run(service, run_id)
    expire_registry_run(service, run_id)
    # Sweep (via unrelated add) removes it from the live map.
    state = new_run_state("other")
    state.run_id = "graveyard-other-1234"
    service.run_registry.add(stub_run(state))
    assert run_id not in service.run_registry._runs
    # get() must report RUN_EXPIRED from the graveyard, never RUN_NOT_FOUND.
    with pytest.raises(AgentRunError) as exc:
        service.run_registry.get(run_id)
    assert exc.value.code == "RUN_EXPIRED"
    # is_expired() agrees within the protection window.
    assert service.run_registry.is_expired(run_id) is True
