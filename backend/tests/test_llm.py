import io
import json
import urllib.error
import urllib.request
from email.message import Message

import pytest

from vault_search.llm import OpenAICompatibleProvider, ProviderError


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, n: int = -1):
        return self._payload[:n] if n >= 0 else self._payload


def _provider() -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        "opencode-go",
        "deepseek-v4-flash",
        "sk-test",
        "https://example.com/v1/chat/completions",
    )


def test_provider_sends_browser_like_user_agent(monkeypatch):
    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["headers"] = dict(request.headers)
        captured["url"] = request.full_url
        return _FakeResponse(
            {"choices": [{"message": {"content": "hi"}}], "model": "m"}
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    response = _provider().complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5.0,
    )
    assert response.text == "hi"
    assert captured["url"] == "https://example.com/v1/chat/completions"
    agent = next(
        (v for k, v in captured["headers"].items() if k.lower() == "user-agent"),
        "",
    )
    assert "Python-urllib" not in agent
    assert agent.startswith("Mozilla/5.0")


def test_provider_maps_cloudflare_403_to_unavailable_not_auth(monkeypatch):
    def fake_urlopen(request, timeout=0):
        raise urllib.error.HTTPError(
            "https://x",
            403,
            "Forbidden",
            Message(),
            io.BytesIO(b'{"error":"error code: 1010"}'),
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(ProviderError) as exc:
        _provider().complete(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    assert exc.value.code == "LLM_PROVIDER_UNAVAILABLE"
    assert "bot protection" in exc.value.message


def test_provider_accepts_openai_content_parts_list(monkeypatch):
    def fake_urlopen(request, timeout=0):
        return _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "text", "text": "서울입니다."},
                                {"type": "text", "text": " [S1]"},
                            ]
                        }
                    }
                ],
                "model": "m",
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    response = _provider().complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5.0,
    )
    assert response.text == "서울입니다. [S1]"


def test_provider_sends_reasoning_effort_when_set(monkeypatch):
    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(
            {"choices": [{"message": {"content": "hi"}}], "model": "m"}
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = _provider()
    provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5.0,
        reasoning_effort="high",
    )
    assert captured["body"]["reasoning_effort"] == "high"
    # auto / empty: the provider default is used — no param sent.
    provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5.0,
        reasoning_effort="auto",
    )
    assert "reasoning_effort" not in captured["body"]
