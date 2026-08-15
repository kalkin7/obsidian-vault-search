from __future__ import annotations

import json
import socket
import uuid
from typing import Any

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


class ProtocolError(RuntimeError):
    pass


def validate_answer_params(params: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize the additive ``answer`` request contract."""
    query = params.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 8000:
        raise ProtocolError("query must be a non-empty string of at most 8000 characters")
    top_k = _bounded_int(params.get("top_k", 8), 1, 12, "top_k")
    max_context_chars = _bounded_int(
        params.get("max_context_chars", 24000), 8000, 32000, "max_context_chars"
    )
    conversation = params.get("conversation", [])
    if not isinstance(conversation, list) or len(conversation) > 8:
        raise ProtocolError("conversation must contain at most 8 messages")
    normalized_conversation: list[dict[str, str]] = []
    for index, item in enumerate(conversation):
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            raise ProtocolError("conversation roles must be user or assistant")
        if item.get("role") != ("user" if index % 2 == 0 else "assistant"):
            raise ProtocolError("conversation must alternate user and assistant messages")
        content = item.get("content")
        if not isinstance(content, str) or len(content) > 8000:
            raise ProtocolError("conversation content must be at most 8000 characters")
        normalized_conversation.append({"role": str(item["role"]), "content": content})
    if len(normalized_conversation) % 2:
        raise ProtocolError("conversation must contain complete user/assistant turns")
    return {
        "query": query.strip(),
        "top_k": top_k,
        "max_context_chars": max_context_chars,
        "conversation": normalized_conversation,
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


def request(host: str, port: int, token: str, method: str,
            params: dict[str, Any] | None = None, timeout: float = 2.0) -> dict[str, Any]:
    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": str(uuid.uuid4()),
        "token": token,
        "method": method,
        "params": params or {},
    }
    encoded = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    with socket.create_connection((host, port), timeout=min(timeout, 1.0)) as connection:
        connection.settimeout(timeout)
        connection.sendall(encoded)
        file = connection.makefile("rb")
        line = file.readline(MAX_MESSAGE_BYTES + 1)
    if not line:
        raise ProtocolError("Backend returned no response")
    if len(line) > MAX_MESSAGE_BYTES:
        raise ProtocolError("Backend response is too large")
    response = json.loads(line.decode("utf-8"))
    if response.get("request_id") != payload["request_id"]:
        raise ProtocolError("Mismatched request ID")
    return response
