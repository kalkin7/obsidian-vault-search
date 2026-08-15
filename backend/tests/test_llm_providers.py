import json
from urllib.error import HTTPError

import pytest

from vault_search.llm import (
    OpenAICompatibleProvider,
    OpenAIResponsesProvider,
    ProviderError,
)


def test_openai_responses_normalizes_output_text(monkeypatch):
    provider = OpenAIResponsesProvider("gpt-test", "secret")
    monkeypatch.setattr(provider, "_request", lambda payload, timeout: {"output_text": "hello", "model": "gpt-test"})
    response = provider.complete(system="system", messages=[{"role": "user", "content": "q"}], max_output_tokens=10, timeout_seconds=1)
    assert response.text == "hello"
    assert response.provider == "openai"


def test_chat_compatible_normalizes_choice(monkeypatch):
    provider = OpenAICompatibleProvider("deepseek", "deepseek-test", "secret", "https://example.test")
    monkeypatch.setattr(provider, "_request", lambda payload, timeout: {"choices": [{"message": {"content": "hello"}}]})
    response = provider.complete(system="system", messages=[], max_output_tokens=10, timeout_seconds=1)
    assert response.text == "hello"
    assert response.provider == "deepseek"


def test_missing_key_is_coded_without_exposing_secret():
    provider = OpenAIResponsesProvider("gpt-test", None)
    with pytest.raises(ProviderError) as error:
        provider.complete(system="system", messages=[], max_output_tokens=10, timeout_seconds=1)
    assert error.value.code == "LLM_API_KEY_MISSING"
    assert "None" not in str(error.value)


def test_provider_retry_stays_within_one_absolute_deadline(monkeypatch):
    provider = OpenAIResponsesProvider("gpt-test", "secret")
    clock = [0.0]
    calls = []

    def fake_monotonic():
        return clock[0]

    def fake_urlopen(request, timeout):
        calls.append(timeout)
        clock[0] = 0.8
        raise HTTPError(request.full_url, 503, "unavailable", {}, None)

    def fake_sleep(delay):
        clock[0] += delay

    monkeypatch.setattr("vault_search.llm.time.monotonic", fake_monotonic)
    monkeypatch.setattr("vault_search.llm.time.sleep", fake_sleep)
    monkeypatch.setattr("vault_search.llm.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(ProviderError) as error:
        provider._request({"model": "test"}, timeout_seconds=1.0)

    assert error.value.code == "LLM_TIMEOUT"
    assert len(calls) == 1
    assert calls[0] == pytest.approx(1.0)
