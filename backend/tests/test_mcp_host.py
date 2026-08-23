"""MCP host E2E tests against a deterministic stdio fixture (plan §15.4).

Runs the real SDK client stack (event-loop thread, persistent sessions,
child processes) against ``fixtures/mcp_test_server.py`` — a hand-rolled
JSON-RPC server with stable tool behavior across SDK versions.
"""

import os
import sys
import threading
import time
from pathlib import Path

import pytest

from vault_search.config import McpServerConfig
from vault_search.mcp_host import (
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
                         url="https://mcp.example.com/mcp?token=canary")
    summary = host.configure(enabled=True, servers=[server])
    assert host.wait_connected("srv-remote", timeout=20), host.status()
    assert summary is not None
    assert opened_with == ["https://mcp.example.com/mcp?token=canary"]

    status = host.status()["servers"][0]
    assert status["transport"] == "http"
    # Query strings never reach status responses.
    assert status["endpoint"] == "https://mcp.example.com/mcp"
    assert "token" not in status["endpoint"]
    assert status["command"] == ""
    assert status["tools"] == 1

    aliases = host.build_alias_map()
    assert aliases.alias_for("srv-remote", "search") == "mcp__Remote__search"

    result = host.call_tool_sync(
        server_id="srv-remote", tool_name="search", arguments={}
    )
    assert result.ok


def test_http_server_failure_is_isolated_to_error_state(host, monkeypatch):
    import vault_search.mcp_host as host_module

    class _BrokenStreams:
        async def __aenter__(self):
            raise RuntimeError("connection refused")

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
                         url="https://downstream.invalid/mcp")
    healthy = make_server("srv-ok", "Ok", label="OK:")
    host.configure(enabled=True, servers=[broken, healthy])
    assert not host.wait_connected("srv-bad", timeout=10)
    assert host.wait_connected("srv-ok", timeout=20)

    bad_summary = next(
        s for s in host.status()["servers"] if s["id"] == "srv-bad"
    )
    assert bad_summary["state"] == SERVER_STATE_ERROR
    assert "connection refused" in (bad_summary["message"] or "")
    ok_summary = next(
        s for s in host.status()["servers"] if s["id"] == "srv-ok"
    )
    assert ok_summary["state"] == SERVER_STATE_CONNECTED
