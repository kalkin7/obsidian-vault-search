from __future__ import annotations

import json
import socket
import uuid
from typing import Any

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 2 * 1024 * 1024


class ProtocolError(RuntimeError):
    pass


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
