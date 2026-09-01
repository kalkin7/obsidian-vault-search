import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from vault_search.config import SearchConfig
from vault_search.errors import ServiceError
from vault_search.service import SearchService


def make_service(tmp_path: Path, ttl=10.0, max_entries=100):
    config = SearchConfig(
        vault_path=tmp_path, data_dir=tmp_path / "data", model_id="__fake__"
    )
    service = SearchService(config, lambda e, d: None)
    service.state = "ready"
    service.index = object()  # type: ignore[assignment]
    service.search_engine = SimpleNamespace(  # type: ignore[assignment]
        search_detailed=lambda *a, **kw: SimpleNamespace(results=[])
    )
    service._terminal_ttl_seconds = ttl
    service._terminal_max_entries = max_entries
    # Also need to reset internal dict to empty after init TTL change
    service._terminal_runs.clear()
    service._expired_runs.clear()
    return service


def test_lru_a_b_get_a_then_c_evicts_b(tmp_path):
    service = make_service(tmp_path, ttl=100, max_entries=2)
    # store a
    service._store_terminal("a", {"status": "complete", "run_id": "a"}, "fp_a")
    time.sleep(0.01)
    service._store_terminal("b", {"status": "complete", "run_id": "b"}, "fp_b")
    # access a -> moves to end, recency: b(oldest), a(newest)
    ent = service._get_terminal("a")
    assert ent is not None
    payload, _ = ent
    assert payload["run_id"] == "a"
    # store c -> should evict b (LRU), keep a,c
    service._store_terminal("c", {"status": "complete", "run_id": "c"}, "fp_c")
    assert "b" not in service._terminal_runs
    assert "a" in service._terminal_runs
    assert "c" in service._terminal_runs
    # order should be a (older) then c (newest) ? After get, order was b,a then evict b -> a,c ; after storing c, order a,c
    keys = list(service._terminal_runs.keys())
    assert keys == ["a", "c"]


def test_get_does_not_extend_expiry(tmp_path):
    service = make_service(tmp_path, ttl=5.0, max_entries=10)
    service._store_terminal("a", {"status": "complete", "run_id": "a"}, "fp_a")
    # capture expiry
    _, _, exp_before = service._terminal_runs["a"]
    time.sleep(0.05)
    service._get_terminal("a")
    _, _, exp_after = service._terminal_runs["a"]
    assert exp_before == exp_after, "TTL should be fixed, not sliding on get"
    # Also ensure get moves recency but not expiry
    # Store b, then get a, then check order
    service._store_terminal("b", {"status": "complete", "run_id": "b"}, "fp_b")
    # order currently a,b -> after get a should be b,a
    service._get_terminal("a")
    assert list(service._terminal_runs.keys()) == ["b", "a"]


def test_expired_removed_before_lru(tmp_path):
    # max 2, store a and b, let a expire, then store c -> should remove expired a, not evict b
    service = make_service(tmp_path, ttl=0.1, max_entries=2)
    service._store_terminal("a", {"status": "complete", "run_id": "a"}, "fp_a")
    service._store_terminal("b", {"status": "complete", "run_id": "b"}, "fp_b")
    assert len(service._terminal_runs) == 2
    time.sleep(0.15)  # a and b expired? But we need only a expired, keep b alive
    # Refresh b's expiry by re-access? No, expiry fixed, so both will expire. To keep b alive, set longer ttl for b?
    # Instead test with different TTL: store a with short ttl, b with longer
    # Simplest: use service with ttl 0.05 for a, then change ttl for b
    service2 = make_service(tmp_path, ttl=0.05, max_entries=2)
    service2._store_terminal("a", {"status": "complete", "run_id": "a"}, "fp_a")
    time.sleep(0.02)
    # Change TTL for b to longer before storing b
    service2._terminal_ttl_seconds = 10.0
    service2._store_terminal("b", {"status": "complete", "run_id": "b"}, "fp_b")
    # Now wait for a to expire but b not yet
    time.sleep(0.06)
    # Now store c — expired a should be swept before LRU, so b remains, and c added, no eviction of b
    service2._store_terminal("c", {"status": "complete", "run_id": "c"}, "fp_c")
    assert "a" not in service2._terminal_runs, "expired a should be gone"
    assert "b" in service2._terminal_runs, "b should remain, not evicted"
    assert "c" in service2._terminal_runs
    assert len(service2._terminal_runs) == 2


def test_first_terminal_wins(tmp_path):
    service = make_service(tmp_path, ttl=100, max_entries=10)
    payload_complete = {
        "status": "complete",
        "run_id": "run1",
        "result": {"answer": "ok"},
    }
    payload_cancel = {"status": "cancelled", "run_id": "run1"}
    winner1, _, _ = service._store_terminal("run1", payload_complete, "fp1")
    assert winner1 is not None
    assert winner1["status"] == "complete"
    winner2, _, _ = service._store_terminal("run1", payload_cancel, "fp1")
    assert winner2 is not None
    assert winner2["status"] == "complete", (
        "first wins, second cancelled should not overwrite"
    )
    assert winner2 is winner1

    # reverse
    service2 = make_service(tmp_path, ttl=100, max_entries=10)
    w1, _, _ = service2._store_terminal("run2", payload_cancel, "fp2")
    assert w1 is not None
    assert w1["status"] == "cancelled"
    w2, _, _ = service2._store_terminal("run2", payload_complete, "fp2")
    assert w2 is not None
    assert w2["status"] == "cancelled"

    # Also test cancel_answer uses same store
    service3 = make_service(tmp_path, ttl=100, max_entries=2)
    service3._store_terminal("x", {"status": "complete", "run_id": "x"}, "fp_x")
    service3._store_terminal("y", {"status": "complete", "run_id": "y"}, "fp_y")
    # x is LRU? order x,y
    # get x -> makes y LRU
    service3._get_terminal("x")
    # Now cancel direct insertion for z should evict y (LRU), not x
    # Simulate cancel path: it will call _store_terminal internally
    # Use service3.cancel_answer for a new run? But cancel_answer for non-existent will park pending, not terminal.
    # Directly test store eviction again with cancel-like payload
    service3._store_terminal("z", {"status": "cancelled", "run_id": "z"}, "fp_z")
    assert "y" not in service3._terminal_runs
    assert "x" in service3._terminal_runs
    assert "z" in service3._terminal_runs


def test_failed_cancelled_not_store_prompt(tmp_path):
    """Ensure failed/cancelled terminals don't store prompt/conversation/evidence"""
    service = make_service(tmp_path)
    # Simulate storing failed
    service._store_terminal(
        "run_failed",
        {
            "status": "failed",
            "run_id": "run_failed",
            "code": "LLM_TIMEOUT",
            "message": "timeout",
        },
        "fp",
    )
    failed = service._get_terminal("run_failed")
    assert failed is not None
    payload, _ = failed
    assert "prompt" not in payload
    assert "conversation" not in payload
    assert "evidence" not in payload
    assert set(payload.keys()) <= {"status", "run_id", "code", "message"}

    service._store_terminal(
        "run_cancel", {"status": "cancelled", "run_id": "run_cancel"}, "fp2"
    )
    cancelled = service._get_terminal("run_cancel")
    assert cancelled is not None
    payload2, _ = cancelled
    assert "prompt" not in payload2
    assert "conversation" not in payload2
    assert "evidence" not in payload2
    assert set(payload2.keys()) <= {"status", "run_id"}


def test_lru_eviction_status_is_run_expired(tmp_path):
    service = make_service(tmp_path, ttl=100, max_entries=2)
    service._store_terminal(
        "run-aaaa", {"status": "complete", "run_id": "run-aaaa"}, "fp_a"
    )
    service._store_terminal(
        "run-bbbb", {"status": "complete", "run_id": "run-bbbb"}, "fp_b"
    )
    service._store_terminal(
        "run-cccc", {"status": "complete", "run_id": "run-cccc"}, "fp_c"
    )
    assert "run-aaaa" not in service._terminal_runs
    with pytest.raises(ServiceError) as exc:
        service.call("answer_status", {"run_id": "run-aaaa"})
    assert exc.value.code == "RUN_EXPIRED"
    with pytest.raises(ServiceError) as exc2:
        service.call(
            "answer_start",
            {
                "query": "hello",
                "conversation": [],
                "max_context_chars": 24000,
                "session_allowed_tools": [],
                "run_id": "run-aaaa",
            },
        )
    assert exc2.value.code == "RUN_EXPIRED"


def test_ttl_expiry_is_run_expired_not_not_found(tmp_path):
    service = make_service(tmp_path, ttl=0.05, max_entries=10)
    service._store_terminal(
        "expire01", {"status": "complete", "run_id": "expire01"}, "fp"
    )
    time.sleep(0.08)
    with pytest.raises(ServiceError) as exc:
        service.call("answer_status", {"run_id": "expire01"})
    assert exc.value.code == "RUN_EXPIRED"
    with pytest.raises(ServiceError) as unknown:
        service.call("answer_status", {"run_id": "unknown1"})
    assert unknown.value.code == "RUN_NOT_FOUND"
    # Tombstones do not keep payload bodies.
    assert "expire01" not in service._terminal_runs
    assert "expire01" in service._expired_runs
