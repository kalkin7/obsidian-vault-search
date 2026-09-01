from __future__ import annotations

import contextlib
import errno as errno_module
import json
import os
import random
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlparse


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


# ---------------------------------------------------------------------------
# Observability helpers (Requirement A) — no secrets are ever logged.
# ---------------------------------------------------------------------------

_RETRYABLE_ERRNOS = {
    # POSIX — ECANCELED is explicit cancellation (e.g., task cancelled) and
    # must not be retried as a transient network error.
    errno_module.ECONNRESET,
    errno_module.ECONNABORTED,
    errno_module.EPIPE,
    errno_module.ETIMEDOUT,
    # Windows (WSA*)
    10053,  # WSAECONNABORTED
    10054,  # WSAECONNRESET
    10058,  # WSAESHUTDOWN (close during transfer)
    10060,  # WSAETIMEDOUT
}


def _safe_host(endpoint: str) -> str:
    try:
        parsed = urlparse(endpoint)
        return parsed.hostname or "unknown"
    except Exception:
        return "unknown"


def _normalize_errno(exc: BaseException) -> str | int | None:
    """Return a safe errno/code without leaking payload."""
    # Direct errno
    code = getattr(exc, "errno", None)
    if isinstance(code, int):
        return code
    # Wrapped reason
    reason = getattr(exc, "reason", None)
    if reason is not None:
        rcode = getattr(reason, "errno", None)
        if isinstance(rcode, int):
            return rcode
        # reason may be string containing code name
        rstr = str(reason)
        for name in (
            "ECONNRESET",
            "EPIPE",
            "ETIMEDOUT",
            "ECONNABORTED",
            "WSAECONNRESET",
            "WSAECONNABORTED",
        ):
            if name in rstr:
                return name
        # Try extract Windows code
        m = re.search(r"\[WinError\s+(\d+)\]", rstr)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                pass
    # Fall back to exception class name
    return type(exc).__name__


def _is_retryable_os_error(exc: BaseException) -> bool:
    """Whether exc is a transient transport error eligible for retry."""
    # ECANCELED is explicit cancellation — never retry (Issue #2)
    ecanceled = getattr(errno_module, "ECANCELED", 125)
    if getattr(exc, "errno", None) == ecanceled:
        return False
    reason = getattr(exc, "reason", None)
    if getattr(reason, "errno", None) == ecanceled:
        return False
    if isinstance(
        exc,
        (
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            TimeoutError,
            socket.timeout,
        ),
    ):
        return True
    # Check errno
    code = getattr(exc, "errno", None)
    if isinstance(code, int) and code in _RETRYABLE_ERRNOS:
        return True
    reason = getattr(exc, "reason", None)
    if reason is not None:
        if isinstance(
            reason,
            (
                ConnectionResetError,
                ConnectionAbortedError,
                BrokenPipeError,
                TimeoutError,
                socket.timeout,
                OSError,
            ),
        ):
            # Check nested errno
            rcode = getattr(reason, "errno", None)
            if isinstance(rcode, int) and rcode in _RETRYABLE_ERRNOS:
                return True
            if isinstance(
                reason,
                (
                    ConnectionResetError,
                    ConnectionAbortedError,
                    BrokenPipeError,
                    TimeoutError,
                    socket.timeout,
                ),
            ):
                return True
            # String-based detection for wrapped messages
            rstr = str(reason).lower()
            if any(
                tok in rstr
                for tok in (
                    "timed out",
                    "connection reset",
                    "broken pipe",
                    "connection aborted",
                )
            ):
                return True
            # Also check errno string names inside
            if any(
                name.lower() in rstr
                for name in (
                    "econnreset",
                    "epipe",
                    "etimedout",
                    "econnaborted",
                    "wsaeconnreset",
                )
            ):
                return True
        # errno on reason
        rcode = getattr(reason, "errno", None)
        if isinstance(rcode, int) and rcode in _RETRYABLE_ERRNOS:
            return True
    # Message fallback
    msg = str(exc).lower()
    if "timed out" in msg and "http" not in msg:  # avoid http body messages
        # Timeout strings from urllib are retryable
        if isinstance(exc, urllib.error.URLError):
            return True
    if any(
        tok in msg for tok in ("connection reset", "broken pipe", "connection aborted")
    ):
        return True
    return False


def _parse_retry_after(value: str | None, remaining: float) -> float | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    # Seconds form (RFC 7231 Section 7.1.3)
    try:
        secs = float(value)
        if 0 <= secs <= remaining:
            return secs
        if secs > remaining:
            return None
        return None
    except ValueError:
        pass
    # HTTP-date form — use standard library parser
    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(value)
        if dt is None:
            return None
        # parsedate_to_datetime may return naive datetime (no tz) for
        # obsolete formats; treat as UTC
        if dt.tzinfo is None:
            import datetime as _dt

            dt = dt.replace(tzinfo=_dt.timezone.utc)
        import datetime as _dt

        now = _dt.datetime.now(_dt.timezone.utc)
        delta = (dt - now).total_seconds()
        if delta < 0:
            # Past date — treat as 0 delay (immediate retry if time remains)
            delta = 0.0
        if 0 <= delta <= remaining:
            return delta
        if delta > remaining:
            return None
        return None
    except Exception:
        return None


class ProviderError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_code: int | None = None,
    ):
        self.code = code
        self.message = message
        # HTTP status when the error originated from a response status; used
        # by the tool-calling adapters to normalize 400/422 rejections into
        # LLM_TOOLS_UNSUPPORTED without changing the text-only contract.
        self.http_code = http_code
        super().__init__(message)


@dataclass(frozen=True)
class ToolDefinition:
    """Provider-neutral function-tool definition (plan §10.1)."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ProviderToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    malformed_arguments: bool = False


@dataclass(frozen=True)
class ProviderTurn:
    text: str
    tool_calls: list[ProviderToolCall]
    provider: str
    model: str


# Internal tagged-union message shapes understood by complete_with_tools:
#   {"role": "user", "content": str}
#   {"role": "assistant", "content": str | None, "tool_calls": [ProviderToolCall]}
#   {"role": "tool", "tool_call_id": str, "content": str}


def _parse_tool_arguments(call_id: str, name: str, raw: Any) -> ProviderToolCall:
    """Parse provider tool-call arguments; malformed JSON becomes a coded,
    non-fatal marker the agent loop reports back to the model."""
    if isinstance(raw, dict):
        return ProviderToolCall(id=call_id, name=name, arguments=raw)
    if isinstance(raw, str) and raw.strip():
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            return ProviderToolCall(id=call_id, name=name, malformed_arguments=True)
        if isinstance(value, dict):
            return ProviderToolCall(id=call_id, name=name, arguments=value)
        return ProviderToolCall(id=call_id, name=name, malformed_arguments=True)
    # None / empty string: no arguments at all.
    return ProviderToolCall(id=call_id, name=name)


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
        host = _safe_host(self.endpoint)
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        # Retryable transport errors: up to 3 total attempts (B requirement)
        max_attempts = 3
        for attempt in range(max_attempts):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderError("LLM_TIMEOUT", "Provider request timed out")
            attempt_start = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=remaining) as response:
                    # capture safe response headers for observability
                    headers = {}
                    try:
                        headers = {k.lower(): v for k, v in response.headers.items()}  # type: ignore[attr-defined]
                    except Exception:
                        try:
                            headers = dict(response.info())  # type: ignore
                        except Exception:
                            headers = {}
                    x_req_id = (
                        headers.get("x-request-id") or headers.get("x-requestid") or ""
                    )
                    # This read can itself raise ConnectionResetError/BrokenPipeError
                    try:
                        raw = response.read(2 * 1024 * 1024 + 1)
                    # pi-lens-ignore: no-boolean-in-except
                    except (
                        ConnectionResetError,
                        ConnectionAbortedError,
                        BrokenPipeError,
                        TimeoutError,
                        OSError,
                    ) as exc:
                        # Treat as transient if retry budget remains
                        # socket.timeout is TimeoutError alias — single path
                        if attempt + 1 < max_attempts and _is_retryable_os_error(exc):
                            # compute backoff before retry
                            backoff = self._backoff_delay(
                                attempt,
                                remaining - (time.monotonic() - attempt_start),
                                headers.get("retry-after"),
                            )
                            if backoff is not None and backoff <= (
                                deadline - time.monotonic()
                            ):
                                # observability: safe structured log — contract is provider/host/attempt/elapsed/x_request_id only
                                self._log_retry(
                                    attempt=attempt + 1,
                                    host=host,
                                    elapsed=time.monotonic() - attempt_start,
                                    x_request_id=x_req_id,
                                )
                                time.sleep(backoff)
                                continue
                        # No retry or not retryable — map to stable code
                        if (
                            isinstance(exc, TimeoutError)
                            or "timed out" in str(exc).lower()
                        ):
                            raise ProviderError(
                                "LLM_TIMEOUT", "Provider request timed out"
                            ) from exc
                        raise ProviderError(
                            "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                        ) from exc
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
                # Extract safe diagnostics
                elapsed = time.monotonic() - attempt_start
                # Try to get headers for retry-after even on error
                retry_after = None
                x_req_id = ""
                if isinstance(exc, urllib.error.HTTPError):
                    try:
                        retry_after = (
                            exc.headers.get("Retry-After")
                            if hasattr(exc, "headers") and exc.headers
                            else None
                        )  # type: ignore
                        x_req_id = (
                            (
                                exc.headers.get("X-Request-Id")
                                or exc.headers.get("x-request-id")
                                or ""
                            )
                            if hasattr(exc, "headers") and exc.headers
                            else ""
                        )
                    except Exception:
                        retry_after = None
                if isinstance(exc, urllib.error.HTTPError):
                    code = exc.code  # type: ignore
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
                    if code in {408, 429, 500, 502, 503, 504}:
                        # Retryable HTTP codes only: 408, 429, and limited 5xx.
                        # 409 Conflict and other 5xx (501/505/...) are not transient.
                        if attempt + 1 < max_attempts:
                            remaining_after = deadline - time.monotonic()
                            if remaining_after <= 0:
                                raise ProviderError(
                                    "LLM_TIMEOUT", "Provider request timed out"
                                ) from exc
                            # If Retry-After exceeds deadline, do not retry — timeout
                            if (
                                retry_after is not None
                                and _is_retry_after_exceeds_deadline(
                                    retry_after, remaining_after
                                )
                            ):
                                raise ProviderError(
                                    "LLM_TIMEOUT", "Provider request timed out"
                                ) from exc
                            backoff = self._backoff_delay(
                                attempt, remaining_after, retry_after
                            )
                            if backoff is not None and backoff <= remaining_after:
                                self._log_retry(
                                    attempt=attempt + 1,
                                    host=host,
                                    elapsed=elapsed,
                                    x_request_id=x_req_id,
                                )
                                time.sleep(backoff)
                                continue
                            # No time for backoff — treat as timeout
                            raise ProviderError(
                                "LLM_TIMEOUT", "Provider request timed out"
                            ) from exc
                        # Retries exhausted or no time — map to stable codes
                        if code == 429:
                            raise ProviderError(
                                "LLM_RATE_LIMITED",
                                "Provider rate limit reached",
                                http_code=code,
                            ) from exc
                        if code in {500, 502, 503, 504}:
                            raise ProviderError(
                                "LLM_PROVIDER_UNAVAILABLE",
                                "Provider is temporarily unavailable",
                                http_code=code,
                            ) from exc
                        # 408 maps to unavailable after retries
                        raise ProviderError(
                            "LLM_PROVIDER_UNAVAILABLE",
                            "Provider is temporarily unavailable",
                            http_code=code,
                        ) from exc
                    if code == 429:
                        raise ProviderError(
                            "LLM_RATE_LIMITED",
                            "Provider rate limit reached",
                            http_code=code,
                        ) from exc
                    if code in {500, 502, 503, 504}:
                        raise ProviderError(
                            "LLM_PROVIDER_UNAVAILABLE",
                            "Provider is temporarily unavailable",
                            http_code=code,
                        ) from exc
                    raise ProviderError(
                        "LLM_BAD_RESPONSE",
                        f"Provider rejected the request (HTTP {code})",
                        http_code=code,
                    ) from exc
                # Non-HTTP URLError — check retryable transport errors
                if _is_retryable_os_error(exc):
                    if attempt + 1 < max_attempts:
                        remaining_after = deadline - time.monotonic()
                        if remaining_after <= 0:
                            raise ProviderError(
                                "LLM_TIMEOUT", "Provider request timed out"
                            ) from exc
                        backoff = self._backoff_delay(attempt, remaining_after, None)
                        if backoff is not None and backoff <= remaining_after:
                            self._log_retry(
                                attempt=attempt + 1,
                                host=host,
                                elapsed=elapsed,
                                x_request_id=x_req_id,
                            )
                            time.sleep(backoff)
                            continue
                        # Retryable but no time left for backoff -> timeout
                        raise ProviderError(
                            "LLM_TIMEOUT", "Provider request timed out"
                        ) from exc
                    # Retryable but exhausted -> map to appropriate code
                    reason_str = str(getattr(exc, "reason", "")).lower()
                    if "timed out" in reason_str or isinstance(
                        getattr(exc, "reason", None), TimeoutError
                    ):
                        raise ProviderError(
                            "LLM_TIMEOUT", "Provider request timed out"
                        ) from exc
                    raise ProviderError(
                        "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                    ) from exc
                reason = str(getattr(exc, "reason", ""))
                if "timed out" in reason.lower() or isinstance(
                    getattr(exc, "reason", None), TimeoutError
                ):
                    raise ProviderError(
                        "LLM_TIMEOUT", "Provider request timed out"
                    ) from exc
                # Non-retryable transport — do not retry
                raise ProviderError(
                    "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                ) from exc
            # pi-lens-ignore: no-boolean-in-except
            except (
                ConnectionResetError,
                ConnectionAbortedError,
                BrokenPipeError,
            ) as exc:
                elapsed = time.monotonic() - attempt_start
                if attempt + 1 < max_attempts and _is_retryable_os_error(exc):
                    remaining_after = deadline - time.monotonic()
                    if remaining_after <= 0:
                        raise ProviderError(
                            "LLM_TIMEOUT", "Provider request timed out"
                        ) from exc
                    backoff = self._backoff_delay(attempt, remaining_after, None)
                    if backoff is not None and backoff <= remaining_after:
                        self._log_retry(
                            attempt=attempt + 1,
                            host=host,
                            elapsed=elapsed,
                            x_request_id="",
                        )
                        time.sleep(backoff)
                        continue
                raise ProviderError(
                    "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                ) from exc
            # pi-lens-ignore: no-boolean-in-except
            except TimeoutError as exc:
                # Direct TimeoutError — also covers socket.timeout (alias) — retry within deadline
                if attempt + 1 < max_attempts:
                    remaining_after = deadline - time.monotonic()
                    if remaining_after > 0:
                        backoff = self._backoff_delay(attempt, remaining_after, None)
                        if backoff is not None and backoff <= remaining_after:
                            self._log_retry(
                                attempt=attempt + 1,
                                host=host,
                                elapsed=time.monotonic() - attempt_start,
                                x_request_id="",
                            )
                            time.sleep(backoff)
                            continue
                raise ProviderError(
                    "LLM_TIMEOUT", "Provider request timed out"
                ) from exc
            # pi-lens-ignore: no-boolean-in-except
            except OSError as exc:
                # Generic OSError (e.g., Windows socket errors not wrapped as URLError)
                if _is_retryable_os_error(exc) and attempt + 1 < max_attempts:
                    remaining_after = deadline - time.monotonic()
                    if remaining_after > 0:
                        backoff = self._backoff_delay(attempt, remaining_after, None)
                        if backoff is not None and backoff <= remaining_after:
                            self._log_retry(
                                attempt=attempt + 1,
                                host=host,
                                elapsed=time.monotonic() - attempt_start,
                                x_request_id="",
                            )
                            time.sleep(backoff)
                            continue
                    # If retryable but no time, map to timeout when appropriate
                    if exc.errno in (errno_module.ETIMEDOUT, 10060):
                        raise ProviderError(
                            "LLM_TIMEOUT", "Provider request timed out"
                        ) from exc
                # Non-retryable OSError -> unavailable
                if exc.errno in (errno_module.ETIMEDOUT, 10060):
                    raise ProviderError(
                        "LLM_TIMEOUT", "Provider request timed out"
                    ) from exc
                raise ProviderError(
                    "LLM_PROVIDER_UNAVAILABLE", "Provider connection failed"
                ) from exc
            except json.JSONDecodeError as exc:
                raise ProviderError(
                    "LLM_BAD_RESPONSE", "Provider returned invalid JSON"
                ) from exc
        raise ProviderError("LLM_PROVIDER_UNAVAILABLE", "Provider request failed")

    def _backoff_delay(
        self, attempt: int, remaining: float, retry_after: str | None
    ) -> float | None:
        """Compute backoff delay; respect Retry-After and remaining deadline."""
        if retry_after is not None:
            parsed = _parse_retry_after(retry_after, remaining)
            if parsed is not None:
                return parsed
            # If Retry-After is present but exceeds remaining, signal timeout path
            if _is_retry_after_exceeds_deadline(retry_after, remaining):
                return None
        # Exponential backoff with jitter: 0.2 * 2^attempt, capped at 1.5s
        base = 0.2 * (2**attempt)
        capped = min(base, 1.5)
        jitter = random.uniform(0, 0.2 * capped)
        delay = capped + jitter
        # Never exceed remaining
        if delay > remaining:
            # If even minimal backoff exceeds deadline, don't sleep
            return None
        return delay

    def _log_retry(
        self,
        *,
        attempt: int,
        host: str,
        elapsed: float,
        x_request_id: str,
    ) -> None:
        # Structured safe log — no secrets, no body. Emit to stderr via print
        # so it lands in backend.log without polluting stdout protocol stream.
        # Contract: only provider, host, attempt, elapsed, x-request-id
        import sys

        safe = {
            "event": "llm_retry",
            "data": {
                "provider": self.provider_id,
                "host": host,
                "attempt": attempt,
                "elapsed": round(elapsed, 3),
                "x_request_id": x_request_id[:64] if x_request_id else None,
            },
        }
        try:
            print(json.dumps(safe, ensure_ascii=False), file=sys.stderr, flush=True)
        except Exception:
            pass


def _is_retry_after_exceeds_deadline(value: str | None, remaining: float) -> bool:
    if value is None:
        return False
    value = value.strip()
    if not value:
        return False
    try:
        secs = float(value)
        return secs > remaining
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(value)
        if dt is None:
            return False
        if dt.tzinfo is None:
            import datetime as _dt

            dt = dt.replace(tzinfo=_dt.timezone.utc)
        import datetime as _dt

        now = _dt.datetime.now(_dt.timezone.utc)
        delta = (dt - now).total_seconds()
        if delta < 0:
            delta = 0.0
        return delta > remaining
    except Exception:
        return False


class OpenAIResponsesProvider(_BaseProvider):
    def __init__(self, model: str, api_key: str | None):
        super().__init__(
            "openai", model, api_key, "https://api.openai.com/v1/responses"
        )

    @staticmethod
    def _tools_payload(tools: list[ToolDefinition]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.input_schema,
            }
            for tool in tools
        ]

    @staticmethod
    def _input_items(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for message in messages:
            role = message.get("role")
            if role == "user":
                items.append(
                    {"role": "user", "content": str(message.get("content", ""))}
                )
            elif role == "assistant":
                text = message.get("content")
                if isinstance(text, str) and text:
                    items.append(
                        {
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": text}],
                        }
                    )
                for call in message.get("tool_calls") or []:
                    items.append(
                        {
                            "type": "function_call",
                            "call_id": call.id,
                            "name": call.name,
                            "arguments": json.dumps(call.arguments, ensure_ascii=False),
                        }
                    )
            elif role == "tool":
                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": str(message.get("tool_call_id", "")),
                        "output": str(message.get("content", "")),
                    }
                )
        return items

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

    def complete_with_tools(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[ToolDefinition],
        max_output_tokens: int,
        timeout_seconds: float,
        reasoning_effort: str = "",
    ) -> ProviderTurn:
        payload: dict[str, Any] = {
            "model": self.model,
            "instructions": system,
            "input": self._input_items(messages),
            "max_output_tokens": max_output_tokens,
            "tools": self._tools_payload(tools),
        }
        effort = _normalize_effort(reasoning_effort)
        if effort:
            payload["reasoning"] = {"effort": effort}
        try:
            value = self._request(payload, timeout_seconds)
        except ProviderError as exc:
            if exc.http_code in {400, 422}:
                raise ProviderError(
                    "LLM_TOOLS_UNSUPPORTED",
                    f"Provider rejected native tool calling (HTTP {exc.http_code})",
                    http_code=exc.http_code,
                ) from exc
            raise
        output = value.get("output")
        if not isinstance(output, list):
            raise ProviderError("LLM_BAD_RESPONSE", "Response has no output array")
        text_chunks: list[str] = []
        calls: list[ProviderToolCall] = []
        seen_ids: set[str] = set()
        for item in output:
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind == "message":
                content = item.get("content")
                if isinstance(content, list):
                    for part in content:
                        if (
                            isinstance(part, dict)
                            and part.get("type") == "output_text"
                            and isinstance(part.get("text"), str)
                        ):
                            text_chunks.append(part["text"])
                elif isinstance(item.get("text"), str):
                    text_chunks.append(item["text"])
            elif kind == "function_call":
                call_id = str(item.get("call_id") or item.get("id") or "")
                name = str(item.get("name") or "")
                if not call_id or not name or call_id in seen_ids:
                    continue
                seen_ids.add(call_id)
                calls.append(
                    _parse_tool_arguments(call_id, name, item.get("arguments"))
                )
        text = "".join(text_chunks).strip()
        if not text and not calls:
            raise ProviderError(
                "LLM_BAD_RESPONSE", "OpenAI response contained no output"
            )
        return ProviderTurn(
            text=text,
            tool_calls=calls,
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

    @staticmethod
    def _tools_payload(tools: list[ToolDefinition]) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in tools
        ]

    @staticmethod
    def _chat_messages(
        system: str, messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        converted: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for message in messages:
            role = message.get("role")
            if role == "user":
                converted.append(
                    {"role": "user", "content": str(message.get("content", ""))}
                )
            elif role == "assistant":
                entry: dict[str, Any] = {"role": "assistant"}
                content = message.get("content")
                entry["content"] = content if isinstance(content, str) else None
                calls = message.get("tool_calls") or []
                if calls:
                    entry["tool_calls"] = [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                "arguments": json.dumps(
                                    call.arguments, ensure_ascii=False
                                ),
                            },
                        }
                        for call in calls
                    ]
                converted.append(entry)
            elif role == "tool":
                converted.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(message.get("tool_call_id", "")),
                        "content": str(message.get("content", "")),
                    }
                )
        return converted

    def complete_with_tools(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[ToolDefinition],
        max_output_tokens: int,
        timeout_seconds: float,
        reasoning_effort: str = "",
    ) -> ProviderTurn:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": self._chat_messages(system, messages),
            "max_tokens": max_output_tokens,
            "stream": False,
            "tools": self._tools_payload(tools),
        }
        effort = _normalize_effort(reasoning_effort)
        if effort:
            payload["reasoning_effort"] = effort
        try:
            value = self._request(payload, timeout_seconds)
        except ProviderError as exc:
            if exc.http_code in {400, 422}:
                raise ProviderError(
                    "LLM_TOOLS_UNSUPPORTED",
                    f"Provider rejected native tool calling (HTTP {exc.http_code})",
                    http_code=exc.http_code,
                ) from exc
            raise
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
        if not isinstance(message, dict):
            raise ProviderError("LLM_BAD_RESPONSE", "Choice has no message")
        text = message.get("content")
        if isinstance(text, list):
            text = "".join(
                part.get("text", "")
                for part in text
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            )
        text = text.strip() if isinstance(text, str) else ""
        calls: list[ProviderToolCall] = []
        seen_ids: set[str] = set()
        raw_calls = message.get("tool_calls")
        if isinstance(raw_calls, list):
            for raw in raw_calls:
                if not isinstance(raw, dict):
                    continue
                function = raw.get("function")
                if not isinstance(function, dict):
                    continue
                call_id = str(raw.get("id") or "")
                name = str(function.get("name") or "")
                if not call_id or not name or call_id in seen_ids:
                    continue
                seen_ids.add(call_id)
                calls.append(
                    _parse_tool_arguments(call_id, name, function.get("arguments"))
                )
        if not text and not calls:
            raise ProviderError(
                "LLM_BAD_RESPONSE",
                "Chat completion contained no content and no tool calls",
            )
        return ProviderTurn(
            text=text,
            tool_calls=calls,
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
