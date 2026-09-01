import io
import json
import urllib.error
import urllib.request
from email.message import Message
from email.utils import format_datetime
import datetime

import pytest

from vault_search.llm import (
    OpenAICompatibleProvider,
    OpenAIResponsesProvider,
    ProviderError,
)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()
        self.headers = {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n=-1):
        return self._payload[:n] if n >= 0 else self._payload

    def info(self):
        return self.headers


def _provider():
    return OpenAICompatibleProvider("opencode-go", "test", "sk", "https://example.com")


def test_direct_timeout_retries_then_succeeds(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            raise TimeoutError("timed out")
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok"
    assert len(calls) == 2


def test_direct_timeout_exhausted_returns_timeout(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        raise TimeoutError("timed out")

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5,
        )
    assert exc.value.code == "LLM_TIMEOUT"
    assert len(calls) == 3


def test_socket_timeout_retries(monkeypatch):
    import socket

    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            raise socket.timeout("timed out")
        return _FakeResponse({"choices": [{"message": {"content": "ok2"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok2"


def test_ecanceled_not_retryable(monkeypatch):
    import errno

    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        err = OSError(errno.ECANCELED, "canceled")
        err.errno = errno.ECANCELED
        raise err

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5,
        )
    assert exc.value.code == "LLM_PROVIDER_UNAVAILABLE"
    assert len(calls) == 1


def test_response_read_connectionreset_retries(monkeypatch):
    provider = _provider()
    calls = []

    class FakeReadError:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            raise ConnectionResetError("read reset")

        headers = {}

        def info(self):
            return {}

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            return FakeReadError()
        return _FakeResponse({"choices": [{"message": {"content": "ok3"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok3"


def test_408_retry(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(
                "https://x", 408, "err", Message(), io.BytesIO(b"")
            )
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok"
    assert len(calls) == 2


def test_409_not_retryable(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        raise urllib.error.HTTPError(
            "https://x", 409, "conflict", Message(), io.BytesIO(b"")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5,
        )
    assert exc.value.code == "LLM_BAD_RESPONSE"
    assert len(calls) == 1


def test_501_not_retryable(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        raise urllib.error.HTTPError(
            "https://x", 501, "nope", Message(), io.BytesIO(b"")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5,
        )
    assert exc.value.code == "LLM_BAD_RESPONSE"
    assert len(calls) == 1


def test_400_not_retryable(monkeypatch):
    provider = _provider()
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        raise urllib.error.HTTPError(
            "https://x", 400, "Bad", Message(), io.BytesIO(b"")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5,
        )
    assert exc.value.code == "LLM_BAD_RESPONSE"
    assert len(calls) == 1


def test_retry_after_http_date_future_within_deadline(monkeypatch):
    provider = OpenAIResponsesProvider("gpt-test", "sk")
    # Retry-After as HTTP-date 2 seconds in future, deadline 5 seconds -> should retry
    calls = []
    future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        seconds=1
    )
    date_str = format_datetime(future)

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            hdr = Message()
            hdr.add_header("Retry-After", date_str)
            raise urllib.error.HTTPError(
                req.full_url, 429, "rate", hdr, io.BytesIO(b"")
            )
        return _FakeResponse({"output_text": "ok", "model": "m"})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    # Mock time to control deadline: we need monotonic for deadline, but HTTP-date uses wall time
    # Use real time, should succeed
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok"
    assert len(calls) == 2


def test_retry_after_http_date_exceeds_deadline(monkeypatch):
    provider = OpenAIResponsesProvider("gpt-test", "sk")
    future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        seconds=10
    )
    date_str = format_datetime(future)

    def fake(req, timeout=0):
        hdr = Message()
        hdr.add_header("Retry-After", date_str)
        raise urllib.error.HTTPError(req.full_url, 429, "rate", hdr, io.BytesIO(b""))

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    with pytest.raises(ProviderError) as exc:
        provider._request({"model": "t"}, timeout_seconds=1.0)
    assert exc.value.code == "LLM_TIMEOUT"


def test_retry_after_past_date_immediate_retry(monkeypatch):
    provider = OpenAIResponsesProvider("gpt-test", "sk")
    past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=10)
    date_str = format_datetime(past)
    calls = []

    def fake(req, timeout=0):
        calls.append(1)
        if len(calls) == 1:
            hdr = Message()
            hdr.add_header("Retry-After", date_str)
            raise urllib.error.HTTPError(req.full_url, 503, "err", hdr, io.BytesIO(b""))
        return _FakeResponse({"output_text": "ok", "model": "m"})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    r = provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5,
    )
    assert r.text == "ok"


def test_no_secret_in_logs(monkeypatch, capsys):
    provider = OpenAICompatibleProvider(
        "openai", "gpt-test", "sk-secret123", "https://example.com"
    )

    def fake(req, timeout=0):
        raise ConnectionResetError("reset")

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    monkeypatch.setattr("vault_search.llm.time.sleep", lambda x: None)
    try:
        provider.complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=1,
        )
    except ProviderError:
        pass
    captured = capsys.readouterr()
    assert "sk-secret123" not in captured.err
    assert "sk-secret123" not in captured.out
    assert "Authorization" not in captured.err
