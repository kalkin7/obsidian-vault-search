import io
import json
import urllib.error
import urllib.request
from email.message import Message

import pytest

from vault_search.llm import (
    OpenAICompatibleProvider,
    OpenAIResponsesProvider,
    ProviderError,
    ProviderToolCall,
    ToolDefinition,
)


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


def test_openai_responses_provider_sends_nested_reasoning(monkeypatch):
    from vault_search.llm import OpenAIResponsesProvider

    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse({"output_text": "hi", "model": "m"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAIResponsesProvider("gpt-5.6-luna", "sk-test")
    provider.complete(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        max_output_tokens=10,
        timeout_seconds=5.0,
        reasoning_effort="xhigh",
    )
    # Official Responses API shape for GPT-5.6: reasoning: {effort}.
    assert captured["body"]["reasoning"] == {"effort": "xhigh"}
    assert "reasoning_effort" not in captured["body"]


# ---------------------------------------------------------------------------
# Native tool-calling contracts (plan §10, §15.3)
# ---------------------------------------------------------------------------

SEARCH_TOOL = ToolDefinition(
    name="vault_search",
    description="search",
    input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
)


def test_responses_tools_request_shape_and_call_parsing(monkeypatch):
    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(
            {
                "model": "gpt-5.6-luna",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "조사 중"}],
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_1",
                        "name": "vault_search",
                        "arguments": '{"query": "전기차"}',
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_2",
                        "name": "vault_read",
                        "arguments": "{}",
                    },
                ],
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAIResponsesProvider("gpt-5.6-luna", "sk-test")
    turn = provider.complete_with_tools(
        system="sys",
        messages=[{"role": "user", "content": "q"}],
        tools=[SEARCH_TOOL],
        max_output_tokens=100,
        timeout_seconds=5.0,
    )
    body = captured["body"]
    assert body["tools"] == [
        {
            "type": "function",
            "name": "vault_search",
            "description": "search",
            "parameters": SEARCH_TOOL.input_schema,
        }
    ]
    assert turn.text == "조사 중"
    assert [c.id for c in turn.tool_calls] == ["call_1", "call_2"]
    assert turn.tool_calls[0].arguments == {"query": "전기차"}
    assert turn.tool_calls[1].arguments == {}


def test_responses_function_call_output_ordering(monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout=0: (_FakeResponse({"output": []})),
    )
    # Capture via a second call: first response triggers tool path.
    def capture_then_respond(request, timeout=0):
        captured.setdefault("bodies", []).append(
            json.loads(request.data.decode("utf-8"))
        )
        return _FakeResponse({"output": []})

    monkeypatch.setattr(urllib.request, "urlopen", capture_then_respond)
    provider = OpenAIResponsesProvider("m", "sk")
    messages = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": "생각",
            "tool_calls": [
                ProviderToolCall(id="c1", name="t", arguments={"a": 1})
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "결과"},
    ]
    with pytest.raises(ProviderError):
        provider.complete_with_tools(
            system="s",
            messages=messages,
            tools=[SEARCH_TOOL],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    items = captured["bodies"][0]["input"]
    kinds = [
        item.get("type") or item.get("role") for item in items
    ]
    assert kinds == ["user", "assistant", "function_call", "function_call_output"]
    assert items[2] == {
        "type": "function_call",
        "call_id": "c1",
        "name": "t",
        "arguments": '{"a": 1}',
    }
    assert items[3] == {"type": "function_call_output", "call_id": "c1", "output": "결과"}


def test_responses_empty_text_with_calls_is_valid():
    provider = OpenAIResponsesProvider("m", "sk")
    payload = {
        "model": "m",
        "output": [
            {
                "type": "function_call",
                "call_id": "c1",
                "name": "t",
                "arguments": "{}",
            }
        ],
    }

    def fake_urlopen(request, timeout=0):
        return _FakeResponse(payload)

    original = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
    try:
        turn = provider.complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            tools=[SEARCH_TOOL],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    finally:
        urllib.request.urlopen = original  # type: ignore[assignment]
    assert turn.text == ""
    assert len(turn.tool_calls) == 1


def test_responses_rejects_when_no_output_at_all(monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout=0: _FakeResponse({"model": "m", "output": []}),
    )
    provider = OpenAIResponsesProvider("m", "sk")
    with pytest.raises(ProviderError) as exc:
        provider.complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            tools=[SEARCH_TOOL],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    assert exc.value.code == "LLM_BAD_RESPONSE"


def test_responses_400_maps_to_tools_unsupported(monkeypatch):
    def fake_urlopen(request, timeout=0):
        raise urllib.error.HTTPError(
            "https://x", 400, "Bad Request", Message(), io.BytesIO(b"no tools")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAIResponsesProvider("m", "sk")
    with pytest.raises(ProviderError) as exc:
        provider.complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            tools=[SEARCH_TOOL],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    assert exc.value.code == "LLM_TOOLS_UNSUPPORTED"


def test_compatible_chat_tools_request_and_response(monkeypatch):
    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(
            {
                "model": "deepseek-v4-flash",
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "tc_1",
                                    "type": "function",
                                    "function": {
                                        "name": "vault_search",
                                        "arguments": '{"query": "주차"}',
                                    },
                                }
                            ],
                        }
                    }
                ],
            }
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAICompatibleProvider("deepseek", "deepseek-v4-flash", "sk", "https://x/v1")
    turn = provider.complete_with_tools(
        system="sys",
        messages=[{"role": "user", "content": "q"}],
        tools=[SEARCH_TOOL],
        max_output_tokens=100,
        timeout_seconds=5.0,
    )
    body = captured["body"]
    assert body["tools"][0]["type"] == "function"
    assert body["tools"][0]["function"]["name"] == "vault_search"
    assert turn.text == ""
    assert turn.tool_calls[0].id == "tc_1"
    assert turn.tool_calls[0].arguments == {"query": "주차"}


def test_compatible_tool_result_message_ordering(monkeypatch):
    captured: dict = {}

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse({"choices": [{"message": {"content": "끝"}}], "model": "m"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAICompatibleProvider("deepseek", "m", "sk", "https://x/v1")
    messages = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [ProviderToolCall(id="t1", name="f", arguments={})],
        },
        {"role": "tool", "tool_call_id": "t1", "content": "r"},
    ]
    provider.complete_with_tools(
        system="s",
        messages=messages,
        tools=[SEARCH_TOOL],
        max_output_tokens=10,
        timeout_seconds=5.0,
    )
    sent = captured["body"]["messages"]
    assert sent[0]["role"] == "system"
    assistant = sent[2]
    assert assistant["role"] == "assistant"
    assert assistant["tool_calls"][0]["id"] == "t1"
    assert sent[3] == {"role": "tool", "tool_call_id": "t1", "content": "r"}


def test_compatible_malformed_arguments_marked_not_fatal(monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout=0: _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "t1",
                                    "function": {
                                        "name": "f",
                                        "arguments": "{not json",
                                    },
                                }
                            ],
                        }
                    }
                ],
                "model": "m",
            }
        ),
    )
    provider = OpenAICompatibleProvider("deepseek", "m", "sk", "https://x/v1")
    turn = provider.complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        tools=[SEARCH_TOOL],
        max_output_tokens=10,
        timeout_seconds=5.0,
    )
    assert turn.tool_calls[0].malformed_arguments is True
    assert turn.tool_calls[0].arguments == {}


def test_compatible_422_maps_to_tools_unsupported(monkeypatch):
    def fake_urlopen(request, timeout=0):
        raise urllib.error.HTTPError(
            "https://x", 422, "Unprocessable", Message(), io.BytesIO(b"{}")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OpenAICompatibleProvider("deepseek", "m", "sk", "https://x/v1")
    with pytest.raises(ProviderError) as exc:
        provider.complete_with_tools(
            system="s",
            messages=[{"role": "user", "content": "q"}],
            tools=[SEARCH_TOOL],
            max_output_tokens=10,
            timeout_seconds=5.0,
        )
    assert exc.value.code == "LLM_TOOLS_UNSUPPORTED"


def test_duplicate_call_ids_deduplicated(monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout=0: _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {"id": "dup", "function": {"name": "f", "arguments": "{}"}},
                                {"id": "dup", "function": {"name": "f", "arguments": "{}"}},
                            ],
                        }
                    }
                ],
                "model": "m",
            }
        ),
    )
    provider = OpenAICompatibleProvider("deepseek", "m", "sk", "https://x/v1")
    turn = provider.complete_with_tools(
        system="s",
        messages=[{"role": "user", "content": "q"}],
        tools=[SEARCH_TOOL],
        max_output_tokens=10,
        timeout_seconds=5.0,
    )
    assert len(turn.tool_calls) == 1
