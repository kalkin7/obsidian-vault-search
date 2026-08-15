from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    text: str
    provider: str
    model: str


class LLMProvider(Protocol):
    provider_id: str
    model: str

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        max_output_tokens: int,
        timeout_seconds: float,
    ) -> ProviderResponse: ...


class _BaseProvider:
    def __init__(self, provider_id: str, model: str, api_key: str | None, endpoint: str):
        self.provider_id = provider_id
        self.model = model
        self._api_key = api_key
        self.endpoint = endpoint

    def _request(self, payload: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
        if not self._api_key:
            raise ProviderError("LLM_API_KEY_MISSING", f"{self.provider_id} API key is not configured")
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        deadline = time.monotonic() + max(0.0, float(timeout_seconds))
        for attempt in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("LLM_TIMEOUT", "Provider request timed out")
            try:
                with urllib.request.urlopen(request, timeout=remaining) as response:
                    raw = response.read(2 * 1024 * 1024 + 1)
                    if len(raw) > 2 * 1024 * 1024:
                        raise ProviderError("LLM_BAD_RESPONSE", "Provider response is too large")
                    value = json.loads(raw.decode("utf-8"))
                    if not isinstance(value, dict):
                        raise ProviderError("LLM_BAD_RESPONSE", "Provider response is not an object")
                    return value
            except urllib.error.HTTPError as exc:
                if exc.code in {429, 500, 502, 503, 504} and attempt == 0:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ProviderError("LLM_TIMEOUT", "Provider request timed out") from exc
                    time.sleep(min(0.5, remaining))
                    continue
                if exc.code in {401, 403}:
                    raise ProviderError("LLM_AUTH_FAILED", "Provider authentication failed") from exc
                if exc.code == 429:
                    raise ProviderError("LLM_RATE_LIMITED", "Provider rate limit reached") from exc
                if 500 <= exc.code < 600:
                    raise ProviderError("LLM_PROVIDER_UNAVAILABLE", "Provider is temporarily unavailable") from exc
                raise ProviderError("LLM_BAD_RESPONSE", f"Provider rejected the request (HTTP {exc.code})") from exc
            except urllib.error.URLError as exc:
                reason = str(getattr(exc, "reason", ""))
                if "timed out" in reason.lower() or isinstance(getattr(exc, "reason", None), TimeoutError):
                    raise ProviderError("LLM_TIMEOUT", "Provider request timed out") from exc
                raise ProviderError("LLM_PROVIDER_UNAVAILABLE", "Provider connection failed") from exc
            except TimeoutError as exc:
                raise ProviderError("LLM_TIMEOUT", "Provider request timed out") from exc
            except json.JSONDecodeError as exc:
                raise ProviderError("LLM_BAD_RESPONSE", "Provider returned invalid JSON") from exc
        raise ProviderError("LLM_PROVIDER_UNAVAILABLE", "Provider request failed")


class OpenAIResponsesProvider(_BaseProvider):
    def __init__(self, model: str, api_key: str | None):
        super().__init__("openai", model, api_key, "https://api.openai.com/v1/responses")

    def complete(self, *, system: str, messages: list[dict[str, str]], max_output_tokens: int, timeout_seconds: float) -> ProviderResponse:
        payload = {
            "model": self.model,
            "instructions": system,
            "input": messages,
            "max_output_tokens": max_output_tokens,
        }
        value = self._request(payload, timeout_seconds)
        text = value.get("output_text")
        if not isinstance(text, str):
            chunks: list[str] = []
            for item in value.get("output", []):
                for content in item.get("content", []) if isinstance(item, dict) else []:
                    if isinstance(content, dict) and isinstance(content.get("text"), str):
                        chunks.append(content["text"])
            text = "".join(chunks)
        if not text:
            raise ProviderError("LLM_BAD_RESPONSE", "OpenAI response contained no output text")
        return ProviderResponse(text=text, provider=self.provider_id, model=str(value.get("model") or self.model))


class OpenAICompatibleProvider(_BaseProvider):
    def complete(self, *, system: str, messages: list[dict[str, str]], max_output_tokens: int, timeout_seconds: float) -> ProviderResponse:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": max_output_tokens,
            "stream": False,
        }
        value = self._request(payload, timeout_seconds)
        choices = value.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ProviderError("LLM_BAD_RESPONSE", "Chat completion contained no choices")
        message = choices[0].get("message")
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text:
            raise ProviderError("LLM_BAD_RESPONSE", "Chat completion contained no message content")
        return ProviderResponse(text=text, provider=self.provider_id, model=str(value.get("model") or self.model))


def create_provider(provider_id: str, model: str) -> LLMProvider:
    if provider_id == "openai":
        return OpenAIResponsesProvider(model, os.environ.get("OPENAI_API_KEY"))
    if provider_id == "opencode-go":
        return OpenAICompatibleProvider(
            provider_id,
            model,
            os.environ.get("OPENCODE_GO_API_KEY"),
            "https://opencode.ai/zen/go/v1/chat/completions",
        )
    if provider_id == "deepseek":
        return OpenAICompatibleProvider(
            provider_id,
            model,
            os.environ.get("DEEPSEEK_API_KEY"),
            "https://api.deepseek.com/chat/completions",
        )
    raise ProviderError("LLM_NOT_CONFIGURED", f"Unknown LLM provider: {provider_id}")
