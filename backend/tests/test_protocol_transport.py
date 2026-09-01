"""Transport retry contract: non-idempotent RPCs are never retransmitted."""

from __future__ import annotations

import socket
import threading

import pytest

from vault_search.protocol import (
    TransportError,
    _IDEMPOTENT_METHODS,
    _NON_IDEMPOTENT_METHODS,
    request,
)


def _serve(
    handler, ready: threading.Event
) -> tuple[threading.Thread, socket.socket, str, int]:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen(16)
    host, port = server.getsockname()

    def run() -> None:
        ready.set()
        try:
            while True:
                try:
                    conn, _addr = server.accept()
                except OSError:
                    return
                try:
                    handler(conn)
                finally:
                    try:
                        conn.close()
                    except OSError:
                        pass
        finally:
            try:
                server.close()
            except OSError:
                pass

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    ready.wait(timeout=2)
    return thread, server, host, port


def test_non_idempotent_methods_are_excluded():
    for method in ("answer_start", "answer_continue", "shutdown"):
        assert method in _NON_IDEMPOTENT_METHODS
        assert method not in _IDEMPOTENT_METHODS
    assert "answer_cancel" in _IDEMPOTENT_METHODS


def test_answer_start_not_retried_on_reset(monkeypatch):
    calls = {"n": 0}

    def fake(_host, _port, _token, _method, _params, _timeout):
        calls["n"] += 1
        raise TransportError("read", ConnectionResetError("reset"))

    monkeypatch.setattr("vault_search.protocol._request_once", fake)
    with pytest.raises(TransportError):
        request("127.0.0.1", 9, "tok", "answer_start", {"query": "q"}, timeout=1.0)
    assert calls["n"] == 1


def test_status_retried_on_reset_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake(_host, _port, _token, _method, _params, _timeout):
        calls["n"] += 1
        if calls["n"] == 1:
            raise TransportError("read", ConnectionResetError("reset"))
        return {"ok": True, "data": {"state": "ready"}}

    monkeypatch.setattr("vault_search.protocol._request_once", fake)
    monkeypatch.setattr("vault_search.protocol.time.sleep", lambda _x: None)
    response = request("127.0.0.1", 9, "tok", "status", timeout=2.0)
    assert response["ok"] is True
    assert calls["n"] == 2


def test_answer_cancel_retried_on_reset(monkeypatch):
    calls = {"n": 0}

    def fake(_host, _port, _token, _method, _params, _timeout):
        calls["n"] += 1
        if calls["n"] == 1:
            raise TransportError("read", ConnectionResetError("reset"))
        return {"ok": True, "data": {"cancelled": False}}

    monkeypatch.setattr("vault_search.protocol._request_once", fake)
    monkeypatch.setattr("vault_search.protocol.time.sleep", lambda _x: None)
    response = request(
        "127.0.0.1", 9, "tok", "answer_cancel", {"run_id": "abc"}, timeout=2.0
    )
    assert response["ok"] is True
    assert calls["n"] == 2


def test_shutdown_not_retried_on_reset(monkeypatch):
    calls = {"n": 0}

    def fake(_host, _port, _token, _method, _params, _timeout):
        calls["n"] += 1
        raise TransportError("read", ConnectionResetError("reset"))

    monkeypatch.setattr("vault_search.protocol._request_once", fake)
    with pytest.raises(TransportError):
        request("127.0.0.1", 9, "tok", "shutdown", timeout=1.0)
    assert calls["n"] == 1


def test_transport_error_exposes_stage_on_connect_failure():
    with pytest.raises(TransportError) as exc:
        request("127.0.0.1", 1, "tok", "status", timeout=0.3)
    assert exc.value.stage in {"connect", "write", "read"}


def test_read_stage_empty_response_is_transport_error():
    ready = threading.Event()

    def handler(conn: socket.socket) -> None:
        conn.recv(65536)
        try:
            conn.shutdown(socket.SHUT_WR)
        except OSError:
            pass

    _thread, server, host, port = _serve(handler, ready)
    try:
        with pytest.raises(TransportError) as exc:
            request(host, port, "tok", "answer_start", timeout=1.0)
        assert exc.value.stage == "read"
    finally:
        server.close()
