#!/usr/bin/env python3
"""Deterministic stdio MCP test server used by the McpHost E2E tests.

Hand-rolls the newline-delimited JSON-RPC framing of the MCP stdio transport
so the fixture stays stable across SDK major versions. Deterministic tools:

- ``echo(text)``       -> text content prefixed with the ``--label`` argument
- ``add(a, b)``        -> text plus structuredContent
- ``fail()``           -> isError=true result
- ``image_only()``     -> image content only (unsupported-type path)
- ``big(count)``       -> oversized text (>32k chars) truncation path
- ``slow(seconds)``    -> sleeps before replying (timeout/cancel paths)
- ``env_echo(name)``   -> echoes one child env var (secret-delivery checks)
- ``pid()``            -> child process id (cleanup assertions)

Usage: python mcp_test_server.py [--label LABEL]
"""

from __future__ import annotations

import json
import os
import sys
import time


def _label() -> str:
    if "--label" in sys.argv:
        index = sys.argv.index("--label")
        if index + 1 < len(sys.argv):
            return sys.argv[index + 1]
    return ""


TOOLS = [
    {
        "name": "echo",
        "description": "Echo the given text back",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "add",
        "description": "Add two numbers",
        "inputSchema": {
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"},
            },
            "required": ["a", "b"],
        },
    },
    {
        "name": "fail",
        "description": "Always returns an error result",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "image_only",
        "description": "Returns an image content block",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "big",
        "description": "Returns more than 32000 characters",
        "inputSchema": {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        },
    },
    {
        "name": "slow",
        "description": "Sleeps before answering",
        "inputSchema": {
            "type": "object",
            "properties": {"seconds": {"type": "number"}},
        },
    },
    {
        "name": "env_echo",
        "description": "Echo one environment variable of the child process",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "pid",
        "description": "Return the child process id",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def send(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def call_tool(name: str, arguments: dict) -> dict:
    label = _label()
    if name == "echo":
        return {"content": [{"type": "text", "text": f"{label}{arguments['text']}"}]}
    if name == "add":
        total = float(arguments["a"]) + float(arguments["b"])
        return {
            "content": [{"type": "text", "text": str(total)}],
            "structuredContent": {"sum": total},
        }
    if name == "fail":
        return {"content": [{"type": "text", "text": "intentional failure"}], "isError": True}
    if name == "image_only":
        return {
            "content": [
                {"type": "image", "data": "aGVsbG8=", "mimeType": "image/png"}
            ]
        }
    if name == "big":
        count = int(arguments.get("count") or 40000)
        return {"content": [{"type": "text", "text": "x" * count}]}
    if name == "slow":
        time.sleep(float(arguments.get("seconds") or 0))
        return {"content": [{"type": "text", "text": "done"}]}
    if name == "env_echo":
        return {
            "content": [
                {
                    "type": "text",
                    "text": os.environ.get(str(arguments["name"]), "<unset>"),
                }
            ]
        }
    if name == "pid":
        return {"content": [{"type": "text", "text": str(os.getpid())}]}
    return {
        "content": [{"type": "text", "text": f"unknown tool {name}"}],
        "isError": True,
    }


def main() -> None:
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method = message.get("method")
        request_id = message.get("id")
        if method == "initialize":
            requested = (message.get("params") or {}).get(
                "protocolVersion", "2025-06-18"
            )
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "protocolVersion": requested,
                        "capabilities": {"tools": {}},
                        "serverInfo": {
                            "name": "mcp-test-server",
                            "version": "1.0.0",
                        },
                    },
                }
            )
        elif method == "notifications/initialized":
            continue
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": request_id, "result": {}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            params = message.get("params") or {}
            try:
                result = call_tool(
                    str(params.get("name")),
                    dict(params.get("arguments") or {}),
                )
            except Exception as exc:  # noqa: BLE001 - fixture boundary
                result = {"content": [{"type": "text", "text": f"fixture error: {exc}"}], "isError": True}
            send({"jsonrpc": "2.0", "id": request_id, "result": result})
        elif request_id is not None:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "method not found"},
                }
            )


if __name__ == "__main__":
    main()
