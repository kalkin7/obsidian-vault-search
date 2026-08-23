from __future__ import annotations

import json
import re
import socket
import uuid
from typing import Any

from vault_search.config import (
    MAX_ENV_NAMES_PER_SERVER as MAX_MCP_SERVER_ENV_COUNT,
    MAX_MCP_SERVERS as MAX_MCP_SERVER_COUNT,
    MAX_MCP_URL_CHARS,
)

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 2 * 1024 * 1024

ANSWER_ERROR_CODES = {
    "ANSWER_INVALID_PARAMS",
    "GROUNDING_EMPTY",
    "LLM_NOT_CONFIGURED",
    "LLM_API_KEY_MISSING",
    "LLM_AUTH_FAILED",
    "LLM_RATE_LIMITED",
    "LLM_TIMEOUT",
    "LLM_PROVIDER_UNAVAILABLE",
    "LLM_BAD_RESPONSE",
    "ANSWER_TOO_LARGE",
    "MODEL_LOADING",
}

MAX_SECRET_PAYLOAD_BYTES = 32 * 1024
MAX_SECRET_NAME_CHARS = 128
MAX_SECRET_VALUE_CHARS = 8 * 1024


def _validate_conversation(conversation: Any) -> list[dict[str, str]]:
    if not isinstance(conversation, list) or len(conversation) > 8:
        raise ProtocolError("conversation must contain at most 8 messages")
    normalized: list[dict[str, str]] = []
    for index, item in enumerate(conversation):
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            raise ProtocolError("conversation roles must be user or assistant")
        if item.get("role") != ("user" if index % 2 == 0 else "assistant"):
            raise ProtocolError(
                "conversation must alternate user and assistant messages"
            )
        content = item.get("content")
        if not isinstance(content, str) or len(content) > 8000:
            raise ProtocolError("conversation content must be at most 8000 characters")
        normalized.append({"role": str(item["role"]), "content": content})
    if len(normalized) % 2:
        raise ProtocolError("conversation must contain complete user/assistant turns")
    return normalized


_RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _validate_client_run_id(value: Any) -> str | None:
    """Optional client-generated run id (additive, plan-compatible).

    Lets the plugin cancel a first-turn run before answer_start responds.
    Existing v1 payloads that omit it keep working unchanged.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not _RUN_ID_PATTERN.match(value):
        raise ProtocolError(
            "run_id must match [A-Za-z0-9_-]{8,64} when provided"
        )
    return value


def validate_answer_start_params(params: dict[str, Any]) -> dict[str, Any]:
    """Stateful ``answer_start`` contract (plan §11.1)."""
    query = params.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 8000:
        raise ProtocolError(
            "query must be a non-empty string of at most 8000 characters"
        )
    max_context_chars = _bounded_int(
        params.get("max_context_chars", 24000), 8000, 32000, "max_context_chars"
    )
    conversation = _validate_conversation(params.get("conversation", []))
    allowed_raw = params.get("session_allowed_tools", [])
    if not isinstance(allowed_raw, list):
        raise ProtocolError("session_allowed_tools must be a list of tool names")
    allowed = [str(name)[:256] for name in allowed_raw if isinstance(name, str)]
    client_id = params.get("client_conversation_id")
    run_id = _validate_client_run_id(params.get("run_id"))
    return {
        "query": query.strip(),
        "max_context_chars": max_context_chars,
        "conversation": conversation,
        "session_allowed_tools": allowed,
        "client_conversation_id": (
            str(client_id)[:64] if isinstance(client_id, str) and client_id else None
        ),
        "run_id": run_id,
    }


def validate_answer_continue_params(params: dict[str, Any]) -> dict[str, Any]:
    run_id = params.get("run_id")
    if not isinstance(run_id, str) or not run_id.strip() or len(run_id) > 64:
        raise ProtocolError("run_id must be provided")
    raw_decisions = params.get("decisions")
    if not isinstance(raw_decisions, list) or not raw_decisions:
        raise ProtocolError("decisions must be a non-empty list")
    if len(raw_decisions) > 16:
        raise ProtocolError("too many decisions in one continue")
    decisions: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in raw_decisions:
        if not isinstance(entry, dict):
            raise ProtocolError("each decision must be an object")
        call_id = entry.get("call_id")
        choice = entry.get("decision")
        if not isinstance(call_id, str) or not call_id or len(call_id) > 256:
            raise ProtocolError("call_id must be a non-empty string")
        if call_id in seen:
            raise ProtocolError(f"duplicate call_id in decisions: {call_id}")
        seen.add(call_id)
        if choice not in {"allow_once", "allow_session", "reject"}:
            raise ProtocolError(
                "decision must be allow_once, allow_session, or reject"
            )
        decisions.append({"call_id": call_id, "decision": str(choice)})
    return {"run_id": run_id.strip(), "decisions": decisions}


def validate_answer_cancel_params(params: dict[str, Any]) -> dict[str, Any]:
    run_id = params.get("run_id")
    if not isinstance(run_id, str) or not run_id.strip() or len(run_id) > 64:
        raise ProtocolError("run_id must be provided")
    return {"run_id": run_id.strip()}


def _validate_server_id(server_id: Any) -> str:
    if not isinstance(server_id, str) or not server_id or len(server_id) > 64:
        raise ProtocolError("server id must be a string of 1-64 characters")
    if any(ord(c) < 32 or ord(c) == 127 for c in server_id):
        raise ProtocolError("server id contains invalid control characters")
    return server_id


def _validate_mcp_http_url(url: Any) -> str:
    if not isinstance(url, str):
        raise ProtocolError("http url must be a string")
    if not url:
        return ""
    if len(url) > MAX_MCP_URL_CHARS:
        raise ProtocolError(f"http url must be at most {MAX_MCP_URL_CHARS} characters")
    if any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ProtocolError("http url contains invalid whitespace or control characters")
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(url)
        if parts.scheme.lower() not in {"http", "https"} or not parts.netloc or not parts.hostname:
            raise ProtocolError("http url must be an absolute http or https URL with a hostname")
    except Exception as exc:
        if isinstance(exc, ProtocolError):
            raise
        raise ProtocolError("http url is malformed") from exc
    return url


def validate_mcp_secrets_params(params: dict[str, Any]) -> dict[str, Any]:
    """Validate the one-shot secret handoff (values never logged)."""
    servers = params.get("servers")
    http_urls = params.get("http_urls")
    if servers is None and http_urls is None:
        raise ProtocolError("'servers' or 'http_urls' object is required")
    if servers is not None and not isinstance(servers, dict):
        raise ProtocolError("'servers' must be an object")
    if http_urls is not None and not isinstance(http_urls, dict):
        raise ProtocolError("'http_urls' must be an object")

    servers_dict = servers if isinstance(servers, dict) else {}
    http_urls_dict = http_urls if isinstance(http_urls, dict) else {}

    if len(servers_dict) > MAX_MCP_SERVER_COUNT:
        raise ProtocolError(f"servers count exceeds limit of {MAX_MCP_SERVER_COUNT}")
    if len(http_urls_dict) > MAX_MCP_SERVER_COUNT:
        raise ProtocolError(f"http_urls count exceeds limit of {MAX_MCP_SERVER_COUNT}")
    if len(set(servers_dict.keys()) | set(http_urls_dict.keys())) > MAX_MCP_SERVER_COUNT:
        raise ProtocolError(f"total server count exceeds limit of {MAX_MCP_SERVER_COUNT}")

    cleaned_servers: dict[str, dict[str, str]] = {}
    for server_id, values in servers_dict.items():
        sid = _validate_server_id(server_id)
        if not isinstance(values, dict):
            raise ProtocolError("each server must map env names to values")
        if len(values) > MAX_MCP_SERVER_ENV_COUNT:
            raise ProtocolError(f"env count for server exceeds limit of {MAX_MCP_SERVER_ENV_COUNT}")
        entry: dict[str, str] = {}
        for name, value in values.items():
            if not isinstance(name, str) or not name or len(name) > MAX_SECRET_NAME_CHARS:
                raise ProtocolError("env name must be 1-128 characters")
            if any(ord(c) < 32 or ord(c) == 127 for c in name):
                raise ProtocolError("env name contains invalid control characters")
            if not isinstance(value, str) or len(value) > MAX_SECRET_VALUE_CHARS:
                raise ProtocolError("env value must be a string of at most 8 KiB")
            entry[name[:MAX_SECRET_NAME_CHARS]] = value[:MAX_SECRET_VALUE_CHARS]
        cleaned_servers[sid] = entry

    cleaned_http_urls: dict[str, str] = {}
    for server_id, url in http_urls_dict.items():
        sid = _validate_server_id(server_id)
        cleaned_http_urls[sid] = _validate_mcp_http_url(url)

    cleaned = {"servers": cleaned_servers, "http_urls": cleaned_http_urls}
    encoded_bytes = len(json.dumps(cleaned, ensure_ascii=False).encode("utf-8"))
    if encoded_bytes > MAX_SECRET_PAYLOAD_BYTES:
        raise ProtocolError("secret payload exceeds 32 KiB")
    return cleaned


class ProtocolError(RuntimeError):
    pass


def validate_answer_params(params: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize the additive ``answer`` request contract."""
    query = params.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 8000:
        raise ProtocolError(
            "query must be a non-empty string of at most 8000 characters"
        )
    top_k = _bounded_int(params.get("top_k", 8), 1, 12, "top_k")
    max_context_chars = _bounded_int(
        params.get("max_context_chars", 24000), 8000, 32000, "max_context_chars"
    )
    conversation = params.get("conversation", [])
    if not isinstance(conversation, list) or len(conversation) > 8:
        raise ProtocolError("conversation must contain at most 8 messages")
    deep = params.get("deep", False)
    if not isinstance(deep, bool):
        raise ProtocolError("deep must be a boolean")
    normalized_conversation = _validate_conversation(conversation)
    return {
        "query": query.strip(),
        "top_k": top_k,
        "max_context_chars": max_context_chars,
        "conversation": normalized_conversation,
        "deep": deep,
    }


def _bounded_int(value: Any, minimum: int, maximum: int, name: str) -> int:
    if isinstance(value, bool):
        raise ProtocolError(f"{name} must be an integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"{name} must be an integer") from exc
    if result < minimum or result > maximum:
        raise ProtocolError(f"{name} must be between {minimum} and {maximum}")
    return result


# Methods that are safe to re-issue when the connection dies during the
# READ phase (Windows loopback can reset a socket whose peer closed right
# after writing the response). Non-idempotent methods are never retried.
_IDEMPOTENT_METHODS = frozenset(
    {
        "answer_cancel",
        "health",
        "status",
        "heartbeat",
        "mcp_status",
        "mcp_refresh",
        "set_mcp_secrets",
        "skills_status",
        "skills_refresh",
        "search",
    }
)


def request(
    host: str,
    port: int,
    token: str,
    method: str,
    params: dict[str, Any] | None = None,
    timeout: float = 2.0,
) -> dict[str, Any]:
    attempts = 2 if method in _IDEMPOTENT_METHODS else 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return _request_once(host, port, token, method, params, timeout)
        except ConnectionResetError as exc:
            # Only a mid-read reset reaches here; the request was fully
            # sent, so re-issuing an idempotent method is safe.
            last_error = exc
    assert last_error is not None
    raise last_error


def _request_once(
    host: str,
    port: int,
    token: str,
    method: str,
    params: dict[str, Any] | None,
    timeout: float,
) -> dict[str, Any]:
    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": str(uuid.uuid4()),
        "token": token,
        "method": method,
        "params": params or {},
    }
    encoded = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    with socket.create_connection(
        (host, port), timeout=min(timeout, 1.0)
    ) as connection:
        connection.settimeout(timeout)
        connection.sendall(encoded)
        file = connection.makefile("rb")
        line = file.readline(MAX_MESSAGE_BYTES + 1)
    if not line:
        raise ProtocolError("Backend returned no response")
    if len(line) > MAX_MESSAGE_BYTES:
        raise ProtocolError("Backend response is too large")
    try:
        response = json.loads(line.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProtocolError("Backend returned an invalid response") from exc
    if response.get("request_id") != payload["request_id"]:
        raise ProtocolError("Mismatched request ID")
    return response
