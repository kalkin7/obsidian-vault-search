from __future__ import annotations

import contextlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol


def _error_snippet(exc: urllib.error.URLError) -> str:
    """Best-effort body read for HTTP errors (used to tell Cloudflare bot
    filtering apart from real auth failures)."""
    if not isinstance(exc, urllib.error.HTTPError):
        return ""
    with contextlib.suppress(Exception):
        return exc.read(200).decode("utf-8", errors="replace")
    return ""


def _normalize_effort(value: str) -> str:
    """Return the reasoning-effort override to send, or "" when the caller
    wants the provider default ("" or "auto")."""
    effort = value.strip().lower()
    if effort in {"none", "low", "medium", "high", "xhigh", "max"}:
        return effort
    return ""


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
        reasoning_effort: str = "",
    ) -> ProviderResponse: ...


class _BaseProvider:
    def __init__(
        self, provider_id: str, model: str, api_key: str | None, endpoint: str
    ):
        self.provider_id = provider_id
        self.model = model
        self._api_key = api_key
        self.endpoint = endpoint

    def _request(
        self, payload: dict[str, Any], timeout_seconds: float
    ) -> dict[str, Any]:
        if not self._api_key:
            raise ProviderError(
                "LLM_API_KEY_MISSING", f"{self.provider_id} API key is not configured"
            )
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        # A browser-like User-Agent is required: some gateways (e.g. OpenCode
        # Zen behind Cloudflare) return 403 error 1010 for the default
        # "Python-urllib/3.x" signature even with a perfectly valid key.
        request = urllib.request.Request(
            self.endpoint,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
            },
        )
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        for attempt in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("LLM_TIMEOUT", "Provider request timed out")
            try:
                with urllib.request.urlopen(request, timeout=remaining) as response:
                    raw = response.read(2 * 1024 * 1024 + 1)
                    if len(raw) > 2 * 1024 * 1024:
                        raise ProviderError(
                            "LLM_BAD_RESPONSE", "Provider response is too large"
                        )
                    value = json.loads(raw.decode("utf-8"))
                    if not isinstance(value, dict):
                        raise ProviderError(
                            "LLM_BAD_RESPONSE", "Provider response is not an object"
                        )
                    return value
            # The no-boolean-in-except rule walks into the handler body and
            # flags its and/or expressions; the except clause itself is plain.
            # pi-lens-ignore: no-boolean-in-except
            except urllib.error.URLError as exc:
                if isinstance(exc, urllib.error.HTTPError):
                    code = exc.code
                    if code in {429, 500, 502, 503, 504} and attempt == 0:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise ProviderError(
                                "LLM_TIMEOUT", "Provider request timed out"
                            ) from exc
                        time.sleep(min(0.5, remaining))
                        continue
                    if code in {401, 403}:
                        # Cloudflare bot filtering (403 error 1010) is NOT an auth
                        # failure — report it distinctly so users are not told
                        # their key is invalid when it is fine.
                        snippet = _error_snippet(exc)
                        lowered = snippet.lower()
                        if (
                            "1010" in lowered
                            or "cloudflare" in lowered
                            or "cf-" in lowered
                        ):
                            raise ProviderError(
                                "LLM_PROVIDER_UNAVAILABLE",
                                "Provider rejected the client (bot protection). Please retry.",
                            ) from exc
                        raise ProviderError(
                            "LLM_AUTH_FAILED", "Provider authentication failed"
                        ) from exc
                    if code == 429:
                        raise ProviderError(
                            "LLM_RATE_LIMITED", "Provider rate limit reached"
                        ) from exc
                    if 500 <= code < 600:
                        raise ProviderError(
                            "LLM_PROVIDER_UNAVAILABLE",
                            "Provider is temporarily unavailable",
                        ) from exc
                    raise ProviderError(
                        "LLM_BAD_RESPONSE",
                        f"Provider rejected the request (HTTP {code})",
                    ) from exc
                reason = str(getattr(exc, "reason", ""))
                if "timed out" in reason.lower() or isinstance(
                    getattr(exc, "reason", None), TimeoutError
                ):
                    raise ProviderError(
                        "LLM_TIMEOUT", "Provider request timed out"
                    ) from exc
                raise ProviderError(
                    "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                ) from exc
            except TimeoutError as exc:
                raise ProviderError(
                    "LLM_TIMEOUT", "Provider request timed out"
                ) from exc
            except json.JSONDecodeError as exc:
                raise ProviderError(
                    "LLM_BAD_RESPONSE", "Provider returned invalid JSON"
                ) from exc
        raise ProviderError("LLM_PROVIDER_UNAVAILABLE", "Provider request failed")


class OpenAIResponsesProvider(_BaseProvider):
    def __init__(self, model: str, api_key: str | None):
        super().__init__(
            "openai", model, api_key, "https://api.openai.com/v1/responses"
        )

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        max_output_tokens: int,
        timeout_seconds: float,
        reasoning_effort: str = "",
    ) -> ProviderResponse:
        payload = {
            "model": self.model,
            "instructions": system,
            "input": messages,
            "max_output_tokens": max_output_tokens,
        }
        effort = _normalize_effort(reasoning_effort)
        if effort:
            # GPT-5.6+ uses the nested reasoning object in the Responses API
            # (the flat reasoning_effort field is not the documented shape).
            payload["reasoning"] = {"effort": effort}
        value = self._request(payload, timeout_seconds)
        text = value.get("output_text")
        if not isinstance(text, str):
            chunks: list[str] = []
            for item in value.get("output", []):
                for content in (
                    item.get("content", []) if isinstance(item, dict) else []
                ):
                    if isinstance(content, dict) and isinstance(
                        content.get("text"), str
                    ):
                        chunks.append(content["text"])
            text = "".join(chunks)
        if not text:
            raise ProviderError(
                "LLM_BAD_RESPONSE", "OpenAI response contained no output text"
            )
        return ProviderResponse(
            text=text,
            provider=self.provider_id,
            model=str(value.get("model") or self.model),
        )


class OpenAICompatibleProvider(_BaseProvider):
    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        max_output_tokens: int,
        timeout_seconds: float,
        reasoning_effort: str = "",
    ) -> ProviderResponse:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": max_output_tokens,
            "stream": False,
        }
        effort = _normalize_effort(reasoning_effort)
        if effort:
            payload["reasoning_effort"] = effort
        value = self._request(payload, timeout_seconds)
        choices = value.get("choices")
        if (
            not isinstance(choices, list)
            or not choices
            or not isinstance(choices[0], dict)
        ):
            raise ProviderError(
                "LLM_BAD_RESPONSE", "Chat completion contained no choices"
            )
        message = choices[0].get("message")
        text = message.get("content") if isinstance(message, dict) else None
        if isinstance(text, list):
            # OpenAI content-parts format: [{"type": "text", "text": "..."}]
            text = "".join(
                part.get("text", "")
                for part in text
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            )
        if not isinstance(text, str) or not text.strip():
            # Reasoning models (e.g. deepseek-v4-flash behind OpenCode Go)
            # fill `reasoning_content` first; an empty `content` usually means
            # the output budget was consumed by chain-of-thought.
            raise ProviderError(
                "LLM_BAD_RESPONSE",
                "Chat completion contained no message content "
                "(reasoning may have consumed the output token budget)",
            )
        return ProviderResponse(
            text=text.strip(),
            provider=self.provider_id,
            model=str(value.get("model") or self.model),
        )


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
