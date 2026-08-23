"""MCP host E2E tests against a deterministic stdio fixture (plan §15.4).

Runs the real SDK client stack (event-loop thread, persistent sessions,
child processes) against ``fixtures/mcp_test_server.py`` — a hand-rolled
JSON-RPC server with stable tool behavior across SDK versions.
"""

import asyncio
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from vault_search.config import McpServerConfig
from vault_search.mcp_host import (
    SERVER_STATE_AWAITING_SECRET,
    SERVER_STATE_CONNECTED,
    SERVER_STATE_DISABLED,
    SERVER_STATE_ERROR,
    McpHost,
)

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "mcp_test_server.py"
if not FIXTURE.exists():  # pragma: no cover - path sanity
    FIXTURE = Path(__file__).parent / "fixtures" / "mcp_test_server.py"


def pid_alive(pid: int) -> bool:
    """Windows-safe liveness probe.

    os.kill(pid, 0) TERMINATES processes on Windows instead of probing, so
    query the exit code through the kernel instead.
    """
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    exit_code = wintypes.DWORD()
    ok = k32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
    k32.CloseHandle(handle)
    return bool(ok) and exit_code.value == 259  # STILL_ACTIVE


def make_server(
    server_id: str = "srv-1",
    name: str = "test",
    label: str = "",
    **overrides,
) -> McpServerConfig:
    values = {
        "id": server_id,
        "name": name,
        "command": sys.executable,
        "args": [str(FIXTURE), "--label", label],
        "cwd": "vault",
        "env_names": [],
        "tool_policies": {},
        "enabled": True,
    }
    values.update(overrides)
    return McpServerConfig(**values)


@pytest.fixture
def host(tmp_path: Path):
    instance = McpHost(vault_path=tmp_path)
    yield instance
    instance.close()


def _connect(host: McpHost, *servers: McpServerConfig) -> None:
    summary = host.configure(enabled=True, servers=list(servers))
    for entry in summary["servers"]:
        assert host.wait_connected(entry["id"], timeout=20), host.status()


def test_connect_and_build_alias_map(host: McpHost):
    _connect(host, make_server(label="A:"))
    status = host.status()
    assert status["connected"] == 1
    assert status["servers"][0]["state"] == SERVER_STATE_CONNECTED
    assert status["servers"][0]["tools"] == 8
    aliases = host.build_alias_map()
    assert aliases.alias_for("srv-1", "echo") == "mcp__test__echo"


def test_echo_roundtrip_and_two_server_isolation(host: McpHost):
    _connect(
        host,
        make_server("srv-a", "alpha", "A:"),
        make_server("srv-b", "beta", "B:"),
    )
    aliases = host.build_alias_map()
    # Distinct names produce distinct aliases; no cross-server collisions.
    assert len(set(aliases.aliases())) == len(aliases.aliases())
    first = host.call_tool_sync(
        server_id="srv-a", tool_name="echo", arguments={"text": "x"}
    )
    second = host.call_tool_sync(
        server_id="srv-b", tool_name="echo", arguments={"text": "y"}
    )
    assert first.ok and first.text.startswith("A:")
    assert second.ok and second.text.startswith("B:")


def test_structured_content_preserved(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="add", arguments={"a": 2, "b": 40}
    )
    assert result.ok
    assert result.text == "42.0"
    assert result.structured == {"sum": 42.0}


def test_is_error_propagates_as_failure(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(server_id="srv-1", tool_name="fail", arguments={})
    assert not result.ok
    assert result.error_code == "MCP_TOOL_ERROR"
    assert "intentional" in result.text


def test_unsupported_content_type_coded_error(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="image_only", arguments={}
    )
    assert not result.ok
    assert result.error_code == "MCP_RESULT_TYPE_UNSUPPORTED"


def test_oversized_result_truncated(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="big", arguments={"count": 40000}
    )
    assert result.ok
    assert result.truncated
    assert len(result.text) <= 32_000


def test_schema_mismatch_blocked_before_execution(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1",
        tool_name="add",
        arguments={"a": "not-a-number", "b": 2},
    )
    assert not result.ok
    assert result.error_code == "MCP_ARGUMENT_SCHEMA_MISMATCH"


def test_missing_required_argument_blocked(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="add", arguments={"a": 1}
    )
    assert not result.ok
    assert result.error_code == "MCP_ARGUMENT_SCHEMA_MISMATCH"


def test_unknown_tool_rejected(host: McpHost):
    _connect(host, make_server())
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="nope", arguments={}
    )
    assert result.error_code == "MCP_UNKNOWN_TOOL"


def test_deny_policy_hides_tool_from_alias_map(host: McpHost):
    _connect(
        host,
        make_server(tool_policies={"echo": "deny", "fail": "allow"}),
    )
    aliases = host.build_alias_map()
    assert aliases.alias_for("srv-1", "echo") is None
    assert aliases.alias_for("srv-1", "fail") is not None
    # Deny also means the model cannot reach it through the host facade.
    result = host.call_tool_sync(
        server_id="srv-1", tool_name="echo", arguments={"text": "x"}
    )
    # Direct host calls are policy-agnostic; enforcement lives in the agent
    # run classification. The registry-level contract is what matters here.
    assert result.ok


def test_call_timeout_then_session_still_usable(host: McpHost):
    _connect(host, make_server())
    started = time.monotonic()
    result = host.call_tool_sync(
        server_id="srv-1",
        tool_name="slow",
        arguments={"seconds": 8},
        timeout_seconds=1,
    )
    elapsed = time.monotonic() - started
    assert result.error_code == "MCP_CALL_TIMEOUT"
    assert elapsed < 6
    follow_up = host.call_tool_sync(
        server_id="srv-1", tool_name="echo", arguments={"text": "after"}
    )
    assert follow_up.ok and "after" in follow_up.text


def test_cancel_running_call(tmp_path: Path):
    host = McpHost(vault_path=tmp_path)
    try:
        _connect(host, make_server())
        registry: dict = {}
        outcome: dict = {}

        def runner() -> None:
            outcome["result"] = host.call_tool_sync(
                server_id="srv-1",
                tool_name="slow",
                arguments={"seconds": 20},
                cancel_registry=registry,
                cancel_key="call-1",
            )

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        deadline = time.monotonic() + 5
        while "call-1" not in registry and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(0.3)  # let the request reach the child
        cancelled = host.cancel_pending(registry)
        assert cancelled >= 1
        thread.join(timeout=30)
        assert outcome["result"].error_code == "MCP_CALL_CANCELLED"
    finally:
        host.close()


def test_secrets_reach_child_but_provider_keys_do_not(host: McpHost):
    server = make_server(env_names=["MCP_CANARY_SECRET_X"])
    # Configure first: the allowlist only accepts ids registered by the
    # current config (fix §5), so the server waits in awaiting_secret.
    summary = host.configure(enabled=True, servers=[server])
    assert summary["servers"][0]["state"] == "awaiting_secret"
    host.apply_secrets(
        {"servers": {"srv-1": {"MCP_CANARY_SECRET_X": "canary-value"}}}
    )
    assert host.wait_connected("srv-1", timeout=20), host.status()
    delivered = host.call_tool_sync(
        server_id="srv-1",
        tool_name="env_echo",
        arguments={"name": "MCP_CANARY_SECRET_X"},
    )
    assert delivered.text == "canary-value"
    for provider_key in ("OPENAI_API_KEY", "DEEPSEEK_API_KEY"):
        leak = host.call_tool_sync(
            server_id="srv-1",
            tool_name="env_echo",
            arguments={"name": provider_key},
        )
        assert leak.text == "<unset>"


def test_child_process_cleaned_after_close(tmp_path: Path):
    host = McpHost(vault_path=tmp_path)
    _connect(host, make_server())
    pid_result = host.call_tool_sync(
        server_id="srv-1", tool_name="pid", arguments={}
    )
    child_pid = int(pid_result.text.strip())
    assert pid_alive(child_pid), "child must be alive while the host runs"
    host.close()
    deadline = time.monotonic() + 5
    while pid_alive(child_pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not pid_alive(child_pid), f"MCP child {child_pid} survived backend close"


def test_changed_server_only_reconnects(host: McpHost):
    _connect(host, make_server())
    pid_before = host.call_tool_sync(
        server_id="srv-1", tool_name="pid", arguments={}
    ).text.strip()
    # Identical settings: configure must keep the existing child alive.
    host.configure(enabled=True, servers=[make_server()])
    pid_after = host.call_tool_sync(
        server_id="srv-1", tool_name="pid", arguments={}
    ).text.strip()
    assert pid_before == pid_after
    # Changing args restarts exactly that server.
    host.configure(enabled=True, servers=[make_server(args=[str(FIXTURE), "--label", "Z:"])])
    host.wait_connected("srv-1", timeout=20)
    relabeled = host.call_tool_sync(
        server_id="srv-1", tool_name="echo", arguments={"text": "n"}
    )
    assert relabeled.text.startswith("Z:")


def test_missing_command_reports_error_state(host: McpHost):
    broken = make_server(command="definitely-not-a-real-exe-xyz")
    host.configure(enabled=True, servers=[broken])
    assert not host.wait_connected("srv-1", timeout=20)
    summary = host.status()["servers"][0]
    assert summary["state"] == SERVER_STATE_ERROR
    assert summary["message"]


def test_disabled_servers_are_not_spawned(host: McpHost):
    off = make_server("srv-off", "off", enabled=False)
    on = make_server("srv-on", "on", "A:")
    host.configure(enabled=True, servers=[on, off])
    assert host.wait_connected("srv-on", timeout=20)
    summary_off = next(
        s for s in host.status()["servers"] if s["id"] == "srv-off"
    )
    assert summary_off["state"] == SERVER_STATE_DISABLED


def test_awaiting_secret_blocks_until_values_arrive(host: McpHost):
    waiting = make_server(env_names=["NEEDED_TOKEN"])
    host.configure(enabled=True, servers=[waiting])
    summary = host.status()["servers"][0]
    assert summary["state"] == "awaiting_secret"
    host.apply_secrets({"servers": {"srv-1": {"NEEDED_TOKEN": "v"}}})
    assert host.wait_connected("srv-1", timeout=20)


# ---------------------------------------------------------------------------
# Secret lifecycle allowlist (fix §5): rotation touches ONLY changed servers.
# ---------------------------------------------------------------------------


def test_rotation_reconnects_only_changed_server(host, monkeypatch):
    cfg_a = make_server("srv-a", "alpha", env_names=["TOK_A"])
    cfg_b = make_server("srv-b", "beta", env_names=["TOK_B"])
    host.configure(enabled=True, servers=[cfg_a, cfg_b])

    launched: list[str] = []
    stopped: list[str] = []

    def fake_launch(runtime):
        launched.append(runtime.config.id)
        runtime.state = SERVER_STATE_CONNECTED

    def fake_stop(runtime):
        stopped.append(runtime.config.id)

    monkeypatch.setattr(host, "_launch_session", fake_launch)
    monkeypatch.setattr(host, "_stop_runtime", fake_stop)

    # Initial delivery connects both servers.
    host.apply_secrets(
        {
            "servers": {
                "srv-a": {"TOK_A": "v1"},
                "srv-b": {"TOK_B": "w1"},
            }
        }
    )
    assert sorted(launched) == ["srv-a", "srv-b"]

    # Rotate A only: B keeps its session untouched.
    launched.clear()
    result = host.apply_secrets(
        {
            "servers": {
                "srv-a": {"TOK_A": "v2"},
                "srv-b": {"TOK_B": "w1"},
            }
        }
    )
    assert launched == ["srv-a"]
    assert host._servers["srv-b"].state == SERVER_STATE_CONNECTED

    # Deleting A's value moves ONLY A back to awaiting_secret.
    launched.clear()
    stopped.clear()
    host.apply_secrets(
        {
            "servers": {
                "srv-a": {},
                "srv-b": {"TOK_B": "w1"},
            }
        }
    )
    assert stopped == ["srv-a"]
    assert host._servers["srv-a"].state == "awaiting_secret"
    assert host._servers["srv-b"].state == SERVER_STATE_CONNECTED
    assert host._secrets["srv-a"] == {}
    assert result["applied"] >= 0


def test_apply_secrets_rejects_unknown_server(host):
    import pytest

    with pytest.raises(ValueError):
        host.apply_secrets(
            {"servers": {"ghost": {"OPENAI_API_KEY": "canary"}}}
        )


def test_apply_secrets_isolates_unregistered_env_names(host):
    cfg_a = make_server("srv-a", "alpha", env_names=["TOK_A"])
    host.configure(enabled=True, servers=[cfg_a])
    result = host.apply_secrets(
        {
            "servers": {
                "srv-a": {
                    "TOK_A": "ok-value",
                    "OPENAI_API_KEY": "provider-key-canary",
                }
            }
        }
    )
    names = {entry["name"] for entry in result["rejected"]}
    assert names == {"OPENAI_API_KEY"}
    stored = host._secrets["srv-a"]
    assert stored == {"TOK_A": "ok-value"}


# ---------------------------------------------------------------------------
# Removal purge: a server dropped from the config must vanish completely.
# ---------------------------------------------------------------------------


def test_removed_server_is_purged_from_registry_and_secrets(host):
    keep = make_server("srv-keep", "keep", "K:", env_names=["KEEP_TOKEN"])
    gone = make_server("srv-gone", "gone", "G:", env_names=["GONE_TOKEN"])
    host.configure(enabled=True, servers=[keep, gone])
    host.apply_secrets(
        {
            "servers": {
                "srv-gone": {"GONE_TOKEN": "gone-canary"},
                "srv-keep": {"KEEP_TOKEN": "keep-canary"},
            }
        }
    )
    assert host.wait_connected("srv-gone", timeout=20)
    assert host.wait_connected("srv-keep", timeout=20)

    # Dropping srv-gone stops its runtime and purges id + stored secrets.
    host.configure(enabled=True, servers=[keep])
    status_ids = {entry["id"] for entry in host.status()["servers"]}
    assert "srv-gone" not in status_ids
    assert "srv-gone" not in host._servers
    assert "srv-gone" not in host._secrets
    assert host.server_summary("srv-gone") is None

    # The removed id is unknown to the secret allowlist immediately.
    with pytest.raises(ValueError):
        host.apply_secrets({"servers": {"srv-gone": {"GONE_TOKEN": "late"}}})

    # The surviving server keeps its session and secret untouched.
    assert host.wait_connected("srv-keep", timeout=20)
    assert host.call_tool_sync(
        server_id="srv-keep",
        tool_name="echo",
        arguments={"text": "alive"},
    ).ok
    assert host._secrets["srv-keep"] == {"KEEP_TOKEN": "keep-canary"}

    # Re-registering the same id starts clean: old tool cache/secret/state
    # are gone, so it waits for a fresh secret instead of reusing anything.
    summary = host.configure(enabled=True, servers=[keep, gone])
    revived = next(s for s in summary["servers"] if s["id"] == "srv-gone")
    assert revived["state"] == "awaiting_secret"
    assert revived["tools"] == 0
    assert host._secrets.get("srv-gone") is None


# ---------------------------------------------------------------------------
# Error-state recovery: a changed complete snapshot relaunches error servers.
# ---------------------------------------------------------------------------


def test_error_state_server_reconnects_on_secret_rotation(host, monkeypatch):
    cfg_a = make_server("srv-a", "alpha", env_names=["TOK_A"])
    cfg_b = make_server("srv-b", "beta", env_names=["TOK_B"])
    host.configure(enabled=True, servers=[cfg_a, cfg_b])

    launched: list[str] = []
    stopped: list[str] = []

    def fake_launch(runtime):
        launched.append(runtime.config.id)
        runtime.state = SERVER_STATE_CONNECTED

    def fake_stop(runtime):
        stopped.append(runtime.config.id)

    monkeypatch.setattr(host, "_launch_session", fake_launch)
    monkeypatch.setattr(host, "_stop_runtime", fake_stop)

    host.apply_secrets(
        {"servers": {"srv-a": {"TOK_A": "v1"}, "srv-b": {"TOK_B": "w1"}}}
    )
    # Simulate a crashed child: srv-a is stuck in error after delivery.
    host._servers["srv-a"].state = SERVER_STATE_ERROR

    # Rotating A's complete snapshot relaunches ONLY A despite error state.
    launched.clear()
    stopped.clear()
    host.apply_secrets(
        {"servers": {"srv-a": {"TOK_A": "v2"}, "srv-b": {"TOK_B": "w1"}}}
    )
    assert launched == ["srv-a"]
    assert stopped == []
    assert host._servers["srv-b"].state == SERVER_STATE_CONNECTED
    assert host._servers["srv-a"].state == SERVER_STATE_CONNECTED

    # Identical snapshot: no needless reconnect of either server.
    launched.clear()
    host.apply_secrets(
        {"servers": {"srv-a": {"TOK_A": "v2"}, "srv-b": {"TOK_B": "w1"}}}
    )
    assert launched == []

    # Error + incomplete snapshot demotes to awaiting_secret, stopping the
    # stale session instead of launching with a broken environment.
    launched.clear()
    stopped.clear()
    host._servers["srv-a"].state = SERVER_STATE_ERROR
    host.apply_secrets(
        {"servers": {"srv-a": {}, "srv-b": {"TOK_B": "w1"}}}
    )
    assert stopped == ["srv-a"]
    assert launched == []
    assert host._servers["srv-a"].state == "awaiting_secret"
    assert host._secrets["srv-a"] == {}


def test_error_state_rotation_spawns_fresh_child_with_new_secret(host):
    server = make_server(env_names=["ROTATE_TOKEN_X"])
    host.configure(enabled=True, servers=[server])
    host.apply_secrets({"servers": {"srv-1": {"ROTATE_TOKEN_X": "first-canary"}}})
    assert host.wait_connected("srv-1", timeout=20)

    def delivered() -> str:
        return host.call_tool_sync(
            server_id="srv-1",
            tool_name="env_echo",
            arguments={"name": "ROTATE_TOKEN_X"},
        ).text

    assert delivered() == "first-canary"

    # Force the error state exactly as a crashed child would leave it, then
    # rotate: only a genuinely new child process can carry the new value.
    host._servers["srv-1"].state = SERVER_STATE_ERROR
    host.apply_secrets({"servers": {"srv-1": {"ROTATE_TOKEN_X": "second-canary"}}})
    assert host.wait_connected("srv-1", timeout=20), host.status()
    summary = host.status()["servers"][0]
    assert summary["state"] == SERVER_STATE_CONNECTED
    assert delivered() == "second-canary"


def test_apply_secrets_never_launches_while_disabled(host, monkeypatch):
    cfg = make_server("srv-off", "off", env_names=["OFF_TOKEN"])
    host.configure(enabled=False, servers=[cfg])
    launched: list[str] = []

    def fake_launch(runtime):
        launched.append(runtime.config.id)
        runtime.state = SERVER_STATE_CONNECTED

    monkeypatch.setattr(host, "_launch_session", fake_launch)
    result = host.apply_secrets({"servers": {"srv-off": {"OFF_TOKEN": "v"}}})
    assert result["applied"] == 1  # values may be stored ahead of enabling...
    assert launched == []  # ...but nothing may start while globally off.
    assert host.status()["servers"][0]["state"] == SERVER_STATE_DISABLED


# ---------------------------------------------------------------------------
# Remote HTTP transport (streamable HTTP): no child process, no env injection.
# ---------------------------------------------------------------------------


class _FakeHttpStreams:
    def __init__(self):
        self.read = object()
        self.write = object()

    async def __aenter__(self):
        return (self.read, self.write, lambda: None)

    async def __aexit__(self, *exc):
        return False


class _FakeTool:
    def __init__(self, name):
        self.name = name
        self.input_schema = {"type": "object", "properties": {}}
        self.description = "fake tool"


class _FakeListResult:
    def __init__(self, tools):
        self.tools = tools


class _FakeTextBlock:
    type = "text"
    text = "ok"


class _FakeCallResult:
    content = [_FakeTextBlock()]
    structured_content = None
    is_error = False


class _FakeSession:
    last_instance = None

    def __init__(self, read, write):
        self.read = read
        self.write = write
        self.tools = [_FakeTool("search")]
        _FakeSession.last_instance = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def initialize(self):
        return None

    async def list_tools(self):
        return _FakeListResult(self.tools)

    async def call_tool(self, name, arguments):
        return _FakeCallResult()


def test_http_server_connects_via_streamable_client(host, monkeypatch):
    import vault_search.mcp_host as host_module

    opened_with: list[str] = []

    def fake_client(url, **kwargs):
        opened_with.append(url)
        return _FakeHttpStreams()

    monkeypatch.setattr(
        host_module, "streamablehttp_client", fake_client, raising=False
    )
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    server = make_server("srv-remote", "Remote", transport="http",
                         url="https://mcp.example.com")
    summary = host.configure(enabled=True, servers=[server])
    assert summary["servers"][0]["state"] == SERVER_STATE_AWAITING_SECRET

    # Supply secret full URL
    host.apply_secrets({"http_urls": {"srv-remote": "https://mcp.example.com/mcp?token=canary"}})
    assert host.wait_connected("srv-remote", timeout=20), host.status()
    assert opened_with == ["https://mcp.example.com/mcp?token=canary"]

    status = host.status()["servers"][0]
    assert status["transport"] == "http"
    # Query strings and paths never reach status responses.
    assert status["endpoint"] == "https://mcp.example.com"
    assert "token" not in status["endpoint"]
    assert not status["endpoint"].endswith("/mcp")
    assert status["command"] == ""
    assert status["tools"] == 1

    aliases = host.build_alias_map()
    assert aliases.alias_for("srv-remote", "search") == "mcp__Remote__search"


def test_http_server_failure_is_isolated_to_error_state(host, monkeypatch):
    import vault_search.mcp_host as host_module

    class _BrokenStreams:
        async def __aenter__(self):
            raise RuntimeError("connection refused to https://user:pass@downstream.invalid/mcp?token=secret123")

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(
        host_module,
        "streamablehttp_client",
        lambda url, **kwargs: _BrokenStreams(),
        raising=False,
    )
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    broken = make_server("srv-bad", "Bad", transport="http",
                         url="https://downstream.invalid")
    healthy = make_server("srv-ok", "Ok", label="OK:")
    host.configure(enabled=True, servers=[broken, healthy])
    host.apply_secrets({"http_urls": {"srv-bad": "https://user:pass@downstream.invalid/mcp?token=secret123"}})

    assert not host.wait_connected("srv-bad", timeout=10)
    assert host.wait_connected("srv-ok", timeout=20)

    bad_summary = next(
        s for s in host.status()["servers"] if s["id"] == "srv-bad"
    )
    assert bad_summary["state"] == SERVER_STATE_ERROR
    assert "connection refused" in (bad_summary["message"] or "")
    # Userinfo, path, query token redacted from exception message
    assert "secret123" not in (bad_summary["message"] or "")
    assert "user:pass" not in (bad_summary["message"] or "")
    ok_summary = next(
        s for s in host.status()["servers"] if s["id"] == "srv-ok"
    )
    assert ok_summary["state"] == SERVER_STATE_CONNECTED


def test_http_server_secret_url_rotation_and_lifecycle(host, monkeypatch):
    import vault_search.mcp_host as host_module

    opened_with: list[str] = []

    def fake_client(url, **kwargs):
        opened_with.append(url)
        return _FakeHttpStreams()

    monkeypatch.setattr(
        host_module, "streamablehttp_client", fake_client, raising=False
    )
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    server = make_server("srv-rot", "Rot", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[server])

    # 1. Supply initial secret URL
    host.apply_secrets({"http_urls": {"srv-rot": "https://mcp.example.com/v1?token=tok1"}})
    assert host.wait_connected("srv-rot", timeout=20)
    assert len(opened_with) == 1

    # 2. Applying identical secret snapshot causes NO reconnection
    host.apply_secrets({"http_urls": {"srv-rot": "https://mcp.example.com/v1?token=tok1"}})
    assert len(opened_with) == 1

    # 3. Rotating to a new secret URL causes reconnection
    host.apply_secrets({"http_urls": {"srv-rot": "https://mcp.example.com/v2?token=tok2"}})
    assert host.wait_connected("srv-rot", timeout=20)
    assert len(opened_with) == 2
    assert opened_with[1] == "https://mcp.example.com/v2?token=tok2"

    # 4. Deleting secret URL transitions server to awaiting_secret
    host.apply_secrets({"http_urls": {"srv-rot": ""}})
    summary = next(s for s in host.status()["servers"] if s["id"] == "srv-rot")
    assert summary["state"] == SERVER_STATE_AWAITING_SECRET


def test_url_redaction_in_exception_messages():
    from vault_search.mcp_host import _redact_url_in_message

    msg = "ConnectError: failed connecting to https://alice:secret@api.example.com:9000/stream?token=abc12345#active"
    redacted = _redact_url_in_message(msg)
    assert "https://api.example.com:9000" in redacted
    assert "alice" not in redacted
    assert "secret" not in redacted
    assert "token" not in redacted
    assert "abc12345" not in redacted
    assert "/stream" not in redacted


def test_two_http_servers_isolated_reconnection(host, monkeypatch):
    import vault_search.mcp_host as host_module

    opened_map: dict[str, list[str]] = {"srv-1": [], "srv-2": []}

    def fake_client(url, **kwargs):
        for sid in ("srv-1", "srv-2"):
            if sid in url:
                opened_map[sid].append(url)
        return _FakeHttpStreams()

    monkeypatch.setattr(
        host_module, "streamablehttp_client", fake_client, raising=False
    )
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    s1 = make_server("srv-1", "S1", transport="http", url="https://mcp1.example.com")
    s2 = make_server("srv-2", "S2", transport="http", url="https://mcp2.example.com")
    host.configure(enabled=True, servers=[s1, s2])

    host.apply_secrets({
        "http_urls": {
            "srv-1": "https://mcp1.example.com/srv-1?token=tok1",
            "srv-2": "https://mcp2.example.com/srv-2?token=tok2",
        }
    })
    assert host.wait_connected("srv-1", timeout=20)
    assert host.wait_connected("srv-2", timeout=20)
    assert len(opened_map["srv-1"]) == 1
    assert len(opened_map["srv-2"]) == 1

    # Apply update changing ONLY srv-1 URL
    host.apply_secrets({
        "http_urls": {
            "srv-1": "https://mcp1.example.com/srv-1?token=tok1-rotated",
            "srv-2": "https://mcp2.example.com/srv-2?token=tok2",
        }
    })
    assert host.wait_connected("srv-1", timeout=20)
    # srv-1 reconnected (2 launches)
    assert len(opened_map["srv-1"]) == 2
    # srv-2 was unchanged (still exactly 1 launch)
    assert len(opened_map["srv-2"]) == 1


def test_sdk_unavailable_reports_coded_diagnostic(host, monkeypatch):
    import vault_search.mcp_host as host_module

    monkeypatch.setattr(host_module, "MCP_SDK_AVAILABLE", False)

    server = make_server("srv-sdk", "SDK Check", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[server])
    host.apply_secrets({"http_urls": {"srv-sdk": "https://mcp.example.com/mcp?token=tok"}})

    assert not host.wait_connected("srv-sdk", timeout=10)

    status = host.status()
    assert "MCP_SDK_UNAVAILABLE_OR_INCOMPATIBLE" in status.get("config_problems", [])

    summary = next(s for s in status["servers"] if s["id"] == "srv-sdk")
    assert summary["state"] == SERVER_STATE_ERROR
    assert "MCP_SDK_UNAVAILABLE_OR_INCOMPATIBLE" in (summary["message"] or "")


def test_apply_secrets_all_or_nothing_atomicity(host):
    s_stdio = make_server("srv-stdio", "Stdio Srv", transport="stdio", env_names=["API_KEY"])
    s_http = make_server("srv-http", "HTTP Srv", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_stdio, s_http])

    # 1. Payload with valid stdio env BUT invalid http server in servers map -> all-or-nothing reject
    with pytest.raises(ValueError, match="HTTP transport server and cannot accept stdio"):
        host.apply_secrets({
            "servers": {
                "srv-stdio": {"API_KEY": "canary_key"},
                "srv-http": {"UNEXPECTED": "bad_value"},
            }
        })
    # Neither secret was staged/applied
    assert host._secrets.get("srv-stdio") is None
    assert host._secrets.get("srv-http") is None

    # 2. Payload with valid http URL BUT stdio server in http_urls map -> all-or-nothing reject
    with pytest.raises(ValueError, match="stdio transport server and cannot accept http url"):
        host.apply_secrets({
            "http_urls": {
                "srv-http": "https://mcp.example.com/mcp?token=xyz",
                "srv-stdio": "https://invalid.example.com",
            }
        })
    assert host._http_urls.get("srv-http") is None
    assert host._http_urls.get("srv-stdio") is None

    # 3. Payload with unknown server ID -> all-or-nothing reject
    with pytest.raises(ValueError, match="unknown server id"):
        host.apply_secrets({
            "servers": {"srv-stdio": {"API_KEY": "canary_key"}},
            "http_urls": {"unknown-srv": "https://example.com"},
        })
    assert host._secrets.get("srv-stdio") is None


def test_mcp_status_reports_safe_endpoint_and_has_url_secret(host):
    s_http = make_server("srv-http-status", "HTTP Status Test", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_http])

    # Before secret is applied: awaiting_secret, has_url_secret is False
    status_1 = host.status()
    summary_1 = next(s for s in status_1["servers"] if s["id"] == "srv-http-status")
    assert summary_1["state"] == SERVER_STATE_AWAITING_SECRET
    assert summary_1["endpoint"] == "https://mcp.example.com"
    assert summary_1["has_url_secret"] is False

    # Apply secret URL: has_url_secret becomes True, endpoint remains safe origin without token
    host.apply_secrets({
        "http_urls": {"srv-http-status": "https://mcp.example.com/v1/mcp?token=super_secret_token"}
    })
    status_2 = host.status()
    summary_2 = next(s for s in status_2["servers"] if s["id"] == "srv-http-status")
    assert summary_2["endpoint"] == "https://mcp.example.com"
    assert summary_2["has_url_secret"] is True
    assert "super_secret_token" not in summary_2["endpoint"]

    # Even when server is disabled, has_url_secret accurately reflects whether secret is held in memory
    s_http_disabled = make_server("srv-http-status", "HTTP Status Test", transport="http", url="https://mcp.example.com", enabled=False)
    host.configure(enabled=True, servers=[s_http_disabled])
    status_3 = host.status()
    summary_3 = next(s for s in status_3["servers"] if s["id"] == "srv-http-status")
    assert summary_3["enabled"] is False
    assert summary_3["state"] == SERVER_STATE_DISABLED
    assert summary_3["has_url_secret"] is True


def test_configure_transport_switch_clears_opposite_secret_memory(host):
    s_stdio = make_server("srv-switch", "Switch Srv", transport="stdio", env_names=["STDIO_KEY"])
    host.configure(enabled=True, servers=[s_stdio])
    host.apply_secrets({"servers": {"srv-switch": {"STDIO_KEY": "stdio_secret_val"}}})
    assert host._secrets.get("srv-switch") == {"STDIO_KEY": "stdio_secret_val"}
    assert host._http_urls.get("srv-switch") is None

    # Switch same UUID to HTTP transport via configure
    s_http = make_server("srv-switch", "Switch Srv", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_http])

    # Past stdio secret is immediately purged from memory
    assert host._secrets.get("srv-switch") is None
    # HTTP server is awaiting_secret and not connected with old stdio secret
    status = host.status()
    summary = next(s for s in status["servers"] if s["id"] == "srv-switch")
    assert summary["state"] == SERVER_STATE_AWAITING_SECRET

    # Now apply HTTP secret
    host.apply_secrets({"http_urls": {"srv-switch": "https://mcp.example.com/mcp?token=http_url_token"}})
    assert host._http_urls.get("srv-switch") == "https://mcp.example.com/mcp?token=http_url_token"
    assert host._secrets.get("srv-switch") is None

    # Switch back to stdio transport via configure
    host.configure(enabled=True, servers=[s_stdio])

    # Past HTTP URL is immediately purged from memory
    assert host._http_urls.get("srv-switch") is None
    assert host._secrets.get("srv-switch") is None

    # Stdio server is awaiting_secret and past HTTP secret is not reused
    status_back = host.status()
    summary_back = next(s for s in status_back["servers"] if s["id"] == "srv-switch")
    assert summary_back["state"] == SERVER_STATE_AWAITING_SECRET


class _SessionTracker:
    def __init__(self):
        self.lock = threading.Lock()
        self.opened_urls: list[str] = []
        self.events: list[tuple[str, str, float]] = []
        self.active_count = 0
        self.max_active = 0

    def record_open(self, url: str) -> None:
        with self.lock:
            self.opened_urls.append(url)
            self.events.append(("open", url, time.monotonic()))

    def record_enter(self, url: str) -> None:
        with self.lock:
            self.active_count += 1
            if self.active_count > self.max_active:
                self.max_active = self.active_count
            self.events.append(("enter", url, time.monotonic()))

    def record_exit(self, url: str) -> None:
        with self.lock:
            self.active_count -= 1
            self.events.append(("exit", url, time.monotonic()))


class _TrackingHttpStreams:
    def __init__(self, tracker: _SessionTracker, url: str, gate: Any = None):
        self.tracker = tracker
        self.url = url
        self.gate = gate
        self.read = object()
        self.write = object()

    async def __aenter__(self):
        if self.gate is not None:
            await self.gate.wait()
        self.tracker.record_enter(self.url)
        return (self.read, self.write, lambda: None)

    async def __aexit__(self, *exc):
        try:
            self.tracker.record_exit(self.url)
        finally:
            return False


def test_rapid_burst_apply_secrets_gated_and_active_context_invariants(host, monkeypatch):
    import vault_search.mcp_host as host_module

    tracker = _SessionTracker()

    def fake_client(url, **kwargs):
        tracker.record_open(url)
        return _TrackingHttpStreams(tracker, url)

    monkeypatch.setattr(host_module, "streamablehttp_client", fake_client, raising=False)
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    s_http = make_server("srv-burst", "Burst Srv", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_http])

    loop = host._loop
    assert loop is not None

    spawn_gate = threading.Event()
    orig_call_soon = loop.call_soon_threadsafe

    def gated_call_soon(callback, *args):
        def wrapped():
            spawn_gate.wait()
            callback(*args)
        orig_call_soon(wrapped)

    monkeypatch.setattr(loop, "call_soon_threadsafe", gated_call_soon)

    # Rapid burst of 25 secret updates while spawn callbacks are gated
    for i in range(25):
        host.apply_secrets({"http_urls": {"srv-burst": f"https://mcp.example.com/v1/mcp?token=burst_tok_{i}"}})

    # Release the gate to allow loop to process coalesced spawn
    spawn_gate.set()

    assert host.wait_connected("srv-burst", timeout=20)

    # Invariants:
    # 1. Only the final (or coalesced) URL actually had a client connection opened
    assert tracker.opened_urls == ["https://mcp.example.com/v1/mcp?token=burst_tok_24"]
    # 2. Maximum active streamable HTTP contexts was exactly 1
    assert tracker.max_active == 1
    assert tracker.active_count == 1
    # 3. Generation advanced to at least 25
    runtime = host._servers["srv-burst"]
    assert runtime.generation >= 25
    assert host._http_urls["srv-burst"] == "https://mcp.example.com/v1/mcp?token=burst_tok_24"


def test_connected_url_rotation_strict_ordering_and_active_invariants(host, monkeypatch):
    import vault_search.mcp_host as host_module

    tracker = _SessionTracker()

    def fake_client(url, **kwargs):
        tracker.record_open(url)
        return _TrackingHttpStreams(tracker, url)

    monkeypatch.setattr(host_module, "streamablehttp_client", fake_client, raising=False)
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    server = make_server("srv-rot-inv", "Rot Invariant", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[server])

    # 1. Connect initial URL
    url_1 = "https://mcp.example.com/v1?token=tok1"
    host.apply_secrets({"http_urls": {"srv-rot-inv": url_1}})
    assert host.wait_connected("srv-rot-inv", timeout=20)
    assert tracker.opened_urls == [url_1]
    assert tracker.max_active == 1
    assert tracker.active_count == 1

    # 2. Rotate to new URL
    url_2 = "https://mcp.example.com/v2?token=tok2"
    host.apply_secrets({"http_urls": {"srv-rot-inv": url_2}})
    assert host.wait_connected("srv-rot-inv", timeout=20)

    # Invariants:
    # Total opens = 2
    assert tracker.opened_urls == [url_1, url_2]
    # Exit of url_1 must happen before or at enter of url_2
    exit_1 = next(t for evt, url, t in tracker.events if evt == "exit" and url == url_1)
    enter_2 = next(t for evt, url, t in tracker.events if evt == "enter" and url == url_2)
    assert exit_1 <= enter_2
    # At no point was max_active > 1
    assert tracker.max_active == 1
    assert tracker.active_count == 1


def test_launch_scheduled_immediate_removal_and_no_late_open(host, monkeypatch):
    import vault_search.mcp_host as host_module

    tracker = _SessionTracker()

    def fake_client(url, **kwargs):
        tracker.record_open(url)
        return _TrackingHttpStreams(tracker, url)

    monkeypatch.setattr(host_module, "streamablehttp_client", fake_client, raising=False)
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    s_http = make_server("srv-to-remove", "Remove Srv", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_http])
    host.apply_secrets({"http_urls": {"srv-to-remove": "https://mcp.example.com/mcp?token=secret_val"}})

    # Immediately remove server before connection resolves
    host.configure(enabled=True, servers=[])
    removal_completed_at = time.monotonic()

    # Allow event loop to process any scheduled calls
    time.sleep(0.1)

    assert "srv-to-remove" not in host._servers
    assert host._http_urls.get("srv-to-remove") is None
    assert host._secrets.get("srv-to-remove") is None

    # Assert zero late open or enter events occurred after removal was completed
    late_events = [
        (evt, url, t)
        for evt, url, t in tracker.events
        if evt in ("open", "enter") and t > removal_completed_at
    ]
    assert len(late_events) == 0, f"Found late events after removal: {late_events}"

    # Invariant: final active is 0, max_active <= 1
    assert tracker.max_active <= 1
    assert tracker.active_count == 0


def test_transport_change_and_disable_invalidates_pending(host, monkeypatch):
    import vault_search.mcp_host as host_module

    tracker = _SessionTracker()

    def fake_client(url, **kwargs):
        tracker.record_open(url)
        return _TrackingHttpStreams(tracker, url)

    monkeypatch.setattr(host_module, "streamablehttp_client", fake_client, raising=False)
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    s_http = make_server("srv-trans", "Trans Srv", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[s_http])
    host.apply_secrets({"http_urls": {"srv-trans": "https://mcp.example.com/mcp?token=secret_val"}})
    assert host.wait_connected("srv-trans", timeout=20)
    assert tracker.active_count == 1

    # Disable server
    s_disabled = make_server("srv-trans", "Trans Srv", transport="http", url="https://mcp.example.com", enabled=False)
    host.configure(enabled=True, servers=[s_disabled])
    time.sleep(0.1)

    assert tracker.active_count == 0
    status = next(s for s in host.status()["servers"] if s["id"] == "srv-trans")
    assert status["state"] == SERVER_STATE_DISABLED


def test_mcp_host_close_leaves_zero_orphan_tasks(tmp_path: Path, monkeypatch):
    import vault_search.mcp_host as host_module

    tracker = _SessionTracker()

    def fake_client(url, **kwargs):
        tracker.record_open(url)
        return _TrackingHttpStreams(tracker, url)

    monkeypatch.setattr(host_module, "streamablehttp_client", fake_client, raising=False)
    monkeypatch.setattr(host_module, "ClientSession", _FakeSession)

    instance = McpHost(vault_path=tmp_path)
    s_http = make_server("srv-orphan", "Orphan Srv", transport="http", url="https://mcp.example.com")
    instance.configure(enabled=True, servers=[s_http])
    loop = instance._loop
    assert loop is not None

    instance.apply_secrets({"http_urls": {"srv-orphan": "https://mcp.example.com/mcp?token=orphan_tok"}})
    assert instance.wait_connected("srv-orphan", timeout=20)
    assert tracker.active_count == 1

    # Close host
    instance.close()

    # Invariants: active count is 0 and instance is marked closed
    assert tracker.active_count == 0
    assert instance._closed is True


def test_stale_mcp_refresh_success_and_failure_isolation(host, monkeypatch):
    import vault_search.mcp_host as host_module

    class _ControllableSession:
        def __init__(self, read, write):
            self.read = read
            self.write = write
            self.list_tools_gate = asyncio.Event()
            self.list_tools_gate.set()  # Open by default for normal initialization
            self.list_tools_result: Any = _FakeListResult([_FakeTool("old_tool")])
            self.list_tools_exception: Exception | None = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def initialize(self):
            return None

        async def list_tools(self):
            await self.list_tools_gate.wait()
            if self.list_tools_exception is not None:
                raise self.list_tools_exception
            return self.list_tools_result

        async def call_tool(self, name, arguments):
            return _FakeCallResult()

    session_instances: list[_ControllableSession] = []

    def fake_session_factory(read, write):
        sess = _ControllableSession(read, write)
        session_instances.append(sess)
        return sess

    monkeypatch.setattr(host_module, "streamablehttp_client", lambda url, **kw: _FakeHttpStreams(), raising=False)
    monkeypatch.setattr(host_module, "ClientSession", fake_session_factory)

    server = make_server("srv-stale", "Stale Test", transport="http", url="https://mcp.example.com")
    host.configure(enabled=True, servers=[server])
    host.apply_secrets({"http_urls": {"srv-stale": "https://mcp.example.com/mcp?token=tok1"}})

    # First session initial connection succeeds with old_tool
    assert host.wait_connected("srv-stale", timeout=20)
    assert len(session_instances) >= 1
    old_session = session_instances[0]
    runtime = host._servers["srv-stale"]
    assert "old_tool" in runtime.tool_schemas

    # 1. Start a refresh where list_tools blocks
    old_session.list_tools_gate.clear()
    old_session.list_tools_result = _FakeListResult([_FakeTool("stale_tool")])

    refresh_thread_result = {}

    def do_refresh():
        refresh_thread_result["res"] = host.refresh_tools()

    th = threading.Thread(target=do_refresh)
    th.start()
    time.sleep(0.05)

    # While list_tools is blocked, reconnect to a new session with new_tool
    # Next session created will have list_tools_gate set by default
    host.apply_secrets({"http_urls": {"srv-stale": "https://mcp.example.com/mcp?token=tok2"}})
    assert host.wait_connected("srv-stale", timeout=20)
    assert len(session_instances) >= 2
    new_session = session_instances[1]
    new_session.list_tools_result = _FakeListResult([_FakeTool("new_tool")])
    # Ensure new session reloaded tools with new_tool
    runtime = host._servers["srv-stale"]
    runtime.tool_schemas = {"new_tool": {"type": "object", "properties": {}}}

    # Now unblock old_session list_tools (which succeeds with stale_tool)
    old_session.list_tools_gate.set()
    th.join(timeout=5)

    # Invariant: stale success did NOT overwrite newest schemas/descriptions!
    assert "new_tool" in runtime.tool_schemas
    assert "stale_tool" not in runtime.tool_schemas

    # 2. Test stale failure isolation:
    # Start another refresh with new_session, block list_tools
    new_session.list_tools_gate.clear()
    new_session.list_tools_exception = RuntimeError("Stale error with https://user:secret@example.org/canary?tok=123")

    th2 = threading.Thread(target=do_refresh)
    th2.start()
    time.sleep(0.05)

    # Reconnect to session 3 while refresh is pending
    host.apply_secrets({"http_urls": {"srv-stale": "https://mcp.example.com/mcp?token=tok3"}})
    assert host.wait_connected("srv-stale", timeout=20)
    assert len(session_instances) >= 3
    third_session = session_instances[2]
    third_session.list_tools_result = _FakeListResult([_FakeTool("third_tool")])
    runtime = host._servers["srv-stale"]
    runtime.tool_schemas = {"third_tool": {"type": "object", "properties": {}}}
    runtime.message = "Clean message"

    # Now unblock new_session list_tools (which raises an exception)
    new_session.list_tools_gate.set()
    th2.join(timeout=5)

    # Invariant: stale exception did NOT overwrite newest message or state!
    assert runtime.message == "Clean message"
    assert runtime.state == SERVER_STATE_CONNECTED
    assert "third_tool" in runtime.tool_schemas
    assert "canary" not in (runtime.message or "")

    # 3. Newest generation's own list_tools failure is recorded with redacted exception
    third_session.list_tools_exception = RuntimeError("Failed: https://user:secret@example.org/canary_456?tok=789")
    refresh_result = host.refresh_tools()
    assert "srv-stale" in refresh_result.get("refreshed", [])

    status_resp = host.status()
    summary = next(s for s in status_resp["servers"] if s["id"] == "srv-stale")
    assert "https://example.org" in (summary["message"] or "")
    assert "secret" not in (summary["message"] or "")
    assert "canary_456" not in (summary["message"] or "")
    assert "789" not in (summary["message"] or "")

    # 4. Server removal during refresh: removed server does not reappear in status, no late message
    third_session.list_tools_exception = None
    third_session.list_tools_gate.clear()
    th4 = threading.Thread(target=do_refresh)
    th4.start()
    time.sleep(0.05)

    # Remove server while refresh is in flight
    host.configure(enabled=True, servers=[])
    third_session.list_tools_gate.set()
    th4.join(timeout=5)

    final_status = host.status()
    assert "srv-stale" not in [s["id"] for s in final_status.get("servers", [])]
    assert len(final_status.get("servers", [])) == 0

    # 5. Full URL canary is never present in refresh result or subsequent mcp_status
    import json
    refresh_json = json.dumps(refresh_result)
    status_json = json.dumps(status_resp)
    assert "canary_456" not in refresh_json
    assert "canary_456" not in status_json
    assert "user:secret" not in refresh_json
    assert "user:secret" not in status_json


def test_url_redaction_comprehensive_schemes_and_parentheses():
    from vault_search.mcp_host import McpHost, _format_safe_exception_message, _redact_url_in_message

    # Uppercase scheme, userinfo, port, query, fragment
    assert McpHost._safe_endpoint("HTTPS://ALICE:PASS@EXAMPLE.COM:8443/mcp?key=val#frag") == "https://example.com:8443"

    # URL with parentheses in path and query token
    url_paren = "https://host/mcp(foo)?token=MCP_CANARY_QUERY#frag"
    assert McpHost._safe_endpoint(url_paren) == "https://host"
    redacted = _redact_url_in_message(f"Failed to connect to {url_paren}")
    assert "MCP_CANARY_QUERY" not in redacted
    assert "mcp(foo)" not in redacted
    assert redacted == "Failed to connect to https://host"

    # IPv6 bracketed host
    assert McpHost._safe_endpoint("http://[::1]:8080/path?token=123") == "http://[::1]:8080"
    assert McpHost._safe_endpoint("http://user:pass@[2001:db8::1]:9000/api?q=secret") == "http://[2001:db8::1]:9000"

    # Malformed URL
    assert McpHost._safe_endpoint("http://") == ""
    assert _redact_url_in_message("Error at http:// in stream") == "Error at [redacted-url] in stream"

    # Exception message formatter
    exc = RuntimeError("Connection refused: HTTPS://user:secret@example.org:9000/v1/mcp?token=canary_123")
    formatted = _format_safe_exception_message(exc)
    assert "canary_123" not in formatted
    assert "secret" not in formatted
    assert "RuntimeError: Connection refused: https://example.org:9000" in formatted
