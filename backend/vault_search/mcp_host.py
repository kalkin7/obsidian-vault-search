"""MCP host living inside the Python sidecar (plan §5.2, §9.1).

Owns one background event-loop thread and persistent stdio sessions for every
enabled local MCP server. The rest of the backend talks to it through the
synchronous facade (:class:`McpHost`) — never through asyncio directly.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .agent_tools import (
    MAX_PROVIDER_TOOLS,
    NormalizedToolResult,
    ToolAliasMap,
    ToolArgumentError,
    normalize_mcp_result,
    tool_error_result,
    validate_arguments_against_schema,
    validate_input_schema,
    validate_tool_arguments,
)
from .config import McpServerConfig

try:  # The MCP SDK is optional at import time so unit tests can stub it.
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import get_default_environment, stdio_client

    MCP_SDK_AVAILABLE = True
except Exception:  # pragma: no cover - exercised only without the SDK
    MCP_SDK_AVAILABLE = False


CONNECT_TIMEOUT_SECONDS = 10.0
LIST_TOOLS_TIMEOUT_SECONDS = 10.0
DEFAULT_CALL_TIMEOUT_SECONDS = 30.0
MAX_CALL_TIMEOUT_SECONDS = 120.0
SHUTDOWN_PER_SERVER_SECONDS = 2.0
SHUTDOWN_TOTAL_SECONDS = 5.0

SERVER_STATE_DISABLED = "disabled"
SERVER_STATE_AWAITING_SECRET = "awaiting_secret"
SERVER_STATE_CONNECTING = "connecting"
SERVER_STATE_CONNECTED = "connected"
SERVER_STATE_ERROR = "error"


def _result_attr(result: Any, snake: str, camel: str, default: Any = None) -> Any:
    """Read an SDK result field across SDK major versions (2.x renamed the
    camelCase 1.x fields to snake_case)."""
    value = getattr(result, snake, None)
    if value is None and camel:
        value = getattr(result, camel, None)
    return default if value is None else value


@dataclass(slots=True)
class _ServerRuntime:
    config: McpServerConfig
    state: str = SERVER_STATE_DISABLED
    message: str | None = None
    stop_event: asyncio.Event | None = None
    session_task: asyncio.Task[Any] | None = None
    session: Any | None = None
    tool_schemas: dict[str, dict[str, Any]] = field(default_factory=dict)
    tool_descriptions: dict[str, str] = field(default_factory=dict)
    ready: asyncio.Event | None = None


class McpHost:
    """Lifecycle owner for MCP stdio sessions and their child processes."""

    def __init__(self, vault_path: Path, plugin_path: Path | None = None):
        self.vault_path = vault_path
        self.plugin_path = plugin_path
        self.enabled = False
        self.alias_map = ToolAliasMap()
        # Result of the last build_alias_map call (fix §6 status surface).
        self.alias_surface_info: dict[str, Any] = {
            "discovered": 0,
            "exposed": 0,
            "truncated": False,
        }
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._started = threading.Event()
        self._closed = False
        self._lock = threading.RLock()
        self._servers: dict[str, _ServerRuntime] = {}
        self._secrets: dict[str, dict[str, str]] = {}
        self._pending_futures: dict[str, asyncio.Future[Any]] = {}
        self._active_tasks: dict[str, asyncio.Task[Any]] = {}
        self._tasks_lock = threading.Lock()
        self._devnull: Any | None = None

    # ------------------------------------------------------------------
    # Thread lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        with self._lock:
            if self._thread is not None or self._closed:
                return
            self._thread = threading.Thread(
                target=self._thread_main, name="mcp-host-loop", daemon=True
            )
            self._thread.start()
            self._started.wait(timeout=10)

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        self._started.set()
        try:
            loop.run_forever()
        finally:
            loop.close()

    def close(self) -> None:
        """Stop every session/child then join the loop thread."""
        with self._lock:
            if self._closed or self._loop is None:
                self._closed = True
                return
            loop = self._loop
            self._closed = True
        deadline_total = time.monotonic() + SHUTDOWN_TOTAL_SECONDS
        runtimes = list(self._servers.values())
        for runtime in runtimes:
            remaining = deadline_total - time.monotonic()
            if remaining <= 0:
                break
            future = asyncio.run_coroutine_threadsafe(
                self._shutdown_server(runtime), loop
            )
            try:
                # Outer budget exceeds the inner shield timeout so the forced
                # cancel inside _shutdown_server can still land.
                future.result(timeout=SHUTDOWN_PER_SERVER_SECONDS + 2.0)
            except Exception:
                pass
        # Anything still alive after the cooperative phase is force-cancelled;
        # cancelling the session task tears down the async-with stack, which
        # terminates the child process.
        remaining_tasks = [
            runtime.session_task
            for runtime in runtimes
            if runtime.session_task is not None and not runtime.session_task.done()
        ]
        if remaining_tasks:

            def force_cancel() -> None:
                for task in remaining_tasks:
                    task.cancel()

            loop.call_soon_threadsafe(force_cancel)
        loop.call_soon_threadsafe(loop.stop)
        if self._thread is not None:
            self._thread.join(timeout=3)
        if self._devnull is not None:
            try:
                self._devnull.close()
            except OSError:
                pass
            self._devnull = None

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def configure(
        self, *, enabled: bool, servers: list[McpServerConfig]
    ) -> dict[str, Any]:
        """Apply new settings: only changed servers are reconnected."""
        if not self._closed:
            self.start()
        self.enabled = enabled
        with self._lock:
            old_by_id = {rid: rt.config for rid, rt in self._servers.items()}
        new_ids = {server.id for server in servers}

        removed = [rid for rid in old_by_id if rid not in new_ids]
        for rid in removed:
            # Purge BEFORE stopping so status()/apply_secrets can never see a
            # half-torn-down runtime; the id becomes unknown immediately.
            with self._lock:
                runtime = self._servers.pop(rid, None)
                self._secrets.pop(rid, None)
            if runtime is not None:
                self._stop_runtime(runtime)

        summaries: list[dict[str, Any]] = []
        for server in servers:
            previous = old_by_id.get(server.id)
            unchanged = (
                previous is not None
                and previous.command == server.command
                and previous.args == server.args
                and previous.cwd == server.cwd
                and previous.enabled == server.enabled
                and previous.env_names == server.env_names
            )
            missing_secret = bool(server.env_names) and not set(
                server.env_names
            ).issubset(set(self._secrets.get(server.id, {}).keys()))
            runtime = self._servers.get(server.id)
            if runtime is None:
                runtime = _ServerRuntime(config=server)
                self._servers[server.id] = runtime
            else:
                runtime.config = server
            if not enabled or not server.enabled:
                self._stop_runtime(runtime)
                runtime.state = SERVER_STATE_DISABLED
                summaries.append(self._summary(runtime))
                continue
            if missing_secret:
                self._stop_runtime(runtime)
                runtime.state = SERVER_STATE_AWAITING_SECRET
                runtime.message = "환경 변수 값이 저장되지 않았습니다"
                summaries.append(self._summary(runtime))
                continue
            if unchanged and runtime.state == SERVER_STATE_CONNECTED:
                summaries.append(self._summary(runtime))
                continue
            # New, changed, or previously-waiting server: (re)connect.
            self._launch_session(runtime)
            summaries.append(self._summary(runtime))
        return {"servers": summaries}

    def apply_secrets(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Receive per-server env values over the authenticated protocol.

        Allowlist rules (fix §5):
        - every server id must exist in the current configuration, otherwise
          the whole payload is rejected — arbitrary ids must never be able to
          pre-seed env values for future servers;
        - per known server, env names outside that server's ``env_names`` are
          isolated (dropped and reported by name; values are never echoed);
        - each listed server's stored mapping is REPLACED wholesale, so a
          snapshot without a previously-sent value performs the deletion.
        """
        servers = payload.get("servers")
        if not isinstance(servers, dict):
            raise ValueError("payload must contain a 'servers' object")
        applied = 0
        rejected_names: list[dict[str, str]] = []
        plan_launch: list[_ServerRuntime] = []
        plan_await: list[_ServerRuntime] = []
        with self._lock:
            configured = {sid: rt.config for sid, rt in self._servers.items()}
            unknown = sorted({str(sid) for sid in servers} - set(configured))
            if unknown:
                raise ValueError(f"unknown server id(s): {', '.join(unknown)}")
            decisions: list[tuple[_ServerRuntime, McpServerConfig, dict[str, str], bool]] = []
            for server_id, values in servers.items():
                if not isinstance(values, dict):
                    continue
                config = configured[str(server_id)]
                allowed = set(config.env_names)
                cleaned: dict[str, str] = {}
                for name, value in values.items():
                    if not isinstance(name, str) or not isinstance(value, str):
                        continue
                    bounded_name = name[:128]
                    if bounded_name not in allowed:
                        # Isolate: an unregistered env name (e.g. a provider
                        # key such as OPENAI_API_KEY) never reaches storage,
                        # so it cannot be injected into any child environment.
                        rejected_names.append(
                            {"server_id": config.id, "name": bounded_name}
                        )
                        continue
                    cleaned[bounded_name] = value[:8192]
                    applied += 1
                old = self._secrets.get(config.id)
                self._secrets[config.id] = cleaned
                runtime = self._servers[config.id]
                decisions.append(
                    (runtime, config, cleaned, old != cleaned)
                )
            handled = {
                id(runtime)
                for runtime, _config, _cleaned, changed in decisions
                if changed
            }
            for runtime, config, cleaned, changed in decisions:
                if not changed or not config.enabled or not self.enabled:
                    continue
                missing_secret = bool(config.env_names) and not set(
                    config.env_names
                ).issubset(set(cleaned.keys()))
                if missing_secret:
                    plan_await.append(runtime)
                elif runtime.state in {
                    SERVER_STATE_CONNECTED,
                    SERVER_STATE_CONNECTING,
                    SERVER_STATE_AWAITING_SECRET,
                    SERVER_STATE_ERROR,
                }:
                    # Rotation/deletion touches ONLY this server; every other
                    # session stays untouched. An error-state server whose
                    # complete snapshot changed gets a fresh launch instead of
                    # staying stuck in error until a full reconfigure.
                    plan_launch.append(runtime)
            # Awaiting servers whose values are now complete may connect.
            for runtime in self._servers.values():
                if id(runtime) in handled or runtime in plan_launch:
                    continue
                if (
                    runtime.state == SERVER_STATE_AWAITING_SECRET
                    and set(runtime.config.env_names).issubset(
                        set(self._secrets.get(runtime.config.id, {}).keys())
                    )
                ):
                    plan_launch.append(runtime)
        # Execute outside the lock: stop/launch block on the loop thread.
        for runtime in plan_await:
            self._stop_runtime(runtime)
            runtime.state = SERVER_STATE_AWAITING_SECRET
            runtime.message = "환경 변수 값이 저장되지 않았습니다"
        for runtime in plan_launch:
            runtime.message = None
            self._launch_session(runtime)
        return {
            "applied": applied,
            "rejected": rejected_names,
        }

    # ------------------------------------------------------------------
    # Session management (event-loop side)
    # ------------------------------------------------------------------

    def _child_env(self, config: McpServerConfig) -> dict[str, str] | None:
        base = get_default_environment() if MCP_SDK_AVAILABLE else {
            k: v
            for k, v in os.environ.items()
            if k.lower()
            in {"path", "systemroot", "comspec", "pathext", "temp", "tmp"}
        }
        env = dict(base)
        env.update(self._secrets.get(config.id, {}))
        return env

    def _cwd_path(self, config: McpServerConfig) -> Path | None:
        if config.cwd == "vault":
            return self.vault_path
        if config.cwd == "plugin":
            return self.plugin_path
        candidate = Path(config.cwd)
        return candidate if candidate.is_dir() else None

    def _launch_session(self, runtime: _ServerRuntime) -> None:
        assert self._loop is not None
        self._stop_runtime(runtime)
        runtime.state = SERVER_STATE_CONNECTING
        runtime.message = None
        loop = self._loop

        def spawn() -> None:
            runtime.ready = asyncio.Event()
            runtime.stop_event = asyncio.Event()
            runtime.session_task = loop.create_task(self._session_main(runtime))

        loop.call_soon_threadsafe(spawn)

    def _stop_runtime(self, runtime: _ServerRuntime) -> None:
        if self._loop is None or runtime.session_task is None:
            return
        loop = self._loop
        stop_event = runtime.stop_event
        task = runtime.session_task

        def request_stop() -> None:
            if stop_event is not None:
                stop_event.set()

        loop.call_soon_threadsafe(request_stop)
        try:
            # Wait briefly for a clean context-manager teardown.
            concurrent = asyncio.run_coroutine_threadsafe(
                self._wait_task(task, SHUTDOWN_PER_SERVER_SECONDS), loop
            )
            concurrent.result(timeout=SHUTDOWN_PER_SERVER_SECONDS + 1.5)
        except Exception:
            if not task.done():
                loop.call_soon_threadsafe(task.cancel)
        runtime.session_task = None
        runtime.session = None
        runtime.tool_schemas = {}
        runtime.tool_descriptions = {}

    async def _wait_task(self, task: asyncio.Future[Any], timeout: float) -> None:
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except Exception:
            pass

    async def _session_main(self, runtime: _ServerRuntime) -> None:
        config = runtime.config
        stop_event = runtime.stop_event
        assert stop_event is not None
        cwd = self._cwd_path(config)
        try:
            if not MCP_SDK_AVAILABLE:
                raise RuntimeError("MCP SDK is not installed in this runtime")
            if cwd is None:
                raise RuntimeError(f"working directory is unavailable: {config.cwd}")
            params = StdioServerParameters(
                command=config.command,
                args=list(config.args),
                cwd=str(cwd),
                env=self._child_env(config),
            )
            if self._devnull is None:
                self._devnull = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
            # stderr of the child is discarded: a hostile/broken MCP server
            # could echo back the very env values we passed it (plan §15.4).
            async with stdio_client(params, errlog=self._devnull) as (read, write):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(
                        session.initialize(), timeout=CONNECT_TIMEOUT_SECONDS
                    )
                    await self._reload_tools(runtime, session)
                    runtime.session = session
                    runtime.state = SERVER_STATE_CONNECTED
                    runtime.message = None
                    if runtime.ready is not None:
                        runtime.ready.set()
                    await stop_event.wait()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            runtime.state = SERVER_STATE_ERROR
            runtime.message = f"{type(exc).__name__}: {exc}"
            if runtime.ready is not None:
                runtime.ready.set()

    async def _reload_tools(self, runtime: _ServerRuntime, session: Any) -> None:
        result = await asyncio.wait_for(
            session.list_tools(), timeout=LIST_TOOLS_TIMEOUT_SECONDS
        )
        schemas: dict[str, dict[str, Any]] = {}
        descriptions: dict[str, str] = {}
        for tool in getattr(result, "tools", []) or []:
            name = str(_result_attr(tool, "name", "name") or "")
            if not name:
                continue
            try:
                # SDK 1.x exposes camelCase inputSchema; 2.x input_schema.
                raw_schema = _result_attr(tool, "input_schema", "inputSchema", {})
                schema = validate_input_schema(raw_schema)
            except ValueError:
                # Malformed schema isolates the single tool, not the server.
                continue
            schemas[name] = schema
            description = _result_attr(tool, "description", "description")
            if isinstance(description, str):
                descriptions[name] = description[:2000]
        runtime.tool_schemas = schemas
        runtime.tool_descriptions = descriptions

    # ------------------------------------------------------------------
    # Public operations
    # ------------------------------------------------------------------

    def wait_connected(self, server_id: str, timeout: float = 12.0) -> bool:
        """Block until the server reaches a terminal/connecting resolution.

        Polls in short slices so a session relaunch (new ready event of a
        newer generation) cannot be missed behind a stale set event.
        """
        assert self._loop is not None
        deadline = time.monotonic() + max(0.1, timeout)
        while True:
            runtime = self._servers.get(server_id)
            if runtime is None:
                return False
            if runtime.state == SERVER_STATE_CONNECTED:
                return True
            if runtime.state == SERVER_STATE_ERROR:
                return False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            ready = runtime.ready
            if ready is None or ready.is_set():
                # spawn() has not run yet, or this is an older event
                # generation: yield briefly and re-read the state.
                time.sleep(0.02)
                continue
            future = asyncio.run_coroutine_threadsafe(
                self._wait_event(ready, min(0.25, remaining)), self._loop
            )
            try:
                future.result(timeout=1.0)
            except Exception:
                pass

    @staticmethod
    async def _wait_event(event: asyncio.Event, timeout: float) -> None:
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass

    async def _shutdown_server(self, runtime: _ServerRuntime) -> None:
        """Cooperative teardown: signal the session loop, then force-cancel."""
        stop_event = runtime.stop_event
        task = runtime.session_task
        if stop_event is not None:
            stop_event.set()
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(task), timeout=SHUTDOWN_PER_SERVER_SECONDS
                )
            except asyncio.TimeoutError:
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=1.0)
                except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                    pass
            except Exception:
                pass
        runtime.session = None
        runtime.session_task = None

    def list_server_tools(self, server_id: str) -> dict[str, dict[str, Any]]:
        runtime = self._servers.get(server_id)
        if runtime is None:
            return {}
        return dict(runtime.tool_schemas)

    def refresh_tools(self) -> dict[str, Any]:
        """Force re-listing tools from every connected session."""
        if self._loop is None:
            return {"refreshed": []}
        connected = [
            runtime
            for runtime in self._servers.values()
            if runtime.state == SERVER_STATE_CONNECTED and runtime.session
        ]

        async def reload_all() -> None:
            for runtime in connected:
                try:
                    await self._reload_tools(runtime, runtime.session)
                except Exception as exc:
                    runtime.message = f"{type(exc).__name__}: {exc}"

        future = asyncio.run_coroutine_threadsafe(reload_all(), self._loop)
        try:
            future.result(timeout=LIST_TOOLS_TIMEOUT_SECONDS * len(connected) + 5)
        except Exception:
            pass
        return {
            "refreshed": [runtime.config.id for runtime in connected],
            **self.status(),
        }

    def build_alias_map(
        self, max_tools: int = MAX_PROVIDER_TOOLS
    ) -> ToolAliasMap:
        """Build the provider-facing alias map with a deterministic cap.

        Servers are visited in sorted-id order and tools in sorted-name order,
        so the first ``max_tools`` eligible tools always win regardless of
        dict ordering or platform quirks. The cap bounds both what the model
        sees AND what it can execute: unregistered aliases simply do not
        resolve (fix §6).
        """
        alias_map = ToolAliasMap()
        discovered = 0
        registered = 0
        for server_id in sorted(self._servers):
            runtime = self._servers[server_id]
            if runtime.state != SERVER_STATE_CONNECTED:
                continue
            for tool_name in sorted(runtime.tool_schemas):
                policy = runtime.config.tool_policies.get(tool_name)
                if policy == "deny":
                    continue
                discovered += 1
                if registered >= max_tools:
                    continue
                alias_map.register(server_id, runtime.config.name, tool_name)
                registered += 1
        self.alias_surface_info = {
            "discovered": discovered,
            "exposed": registered,
            "truncated": registered < discovered,
        }
        self.alias_map = alias_map
        return alias_map

    def call_tool_sync(
        self,
        *,
        server_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        timeout_seconds: float = DEFAULT_CALL_TIMEOUT_SECONDS,
        cancel_registry: dict[str, Any] | None = None,
        cancel_key: str | None = None,
    ) -> NormalizedToolResult:
        """Blocking call executed from the service worker thread."""
        runtime = self._servers.get(server_id)
        if runtime is None:
            return tool_error_result("MCP_UNKNOWN_SERVER", f"unknown server {server_id}")
        if runtime.state != SERVER_STATE_CONNECTED or runtime.session is None:
            return tool_error_result(
                "MCP_SERVER_NOT_CONNECTED",
                f"server '{runtime.config.name}' is not connected",
            )
        schema = runtime.tool_schemas.get(tool_name)
        if schema is None:
            return tool_error_result(
                "MCP_UNKNOWN_TOOL", f"tool '{tool_name}' is not exposed by this server"
            )
        bounded_timeout = min(
            max(1.0, timeout_seconds), MAX_CALL_TIMEOUT_SECONDS
        )
        try:
            validate_tool_arguments(tool_name, arguments)
        except ToolArgumentError as exc:
            return tool_error_result("MCP_INVALID_ARGUMENTS", str(exc))
        problem = validate_arguments_against_schema(arguments, schema)
        if problem:
            return tool_error_result(
                "MCP_ARGUMENT_SCHEMA_MISMATCH",
                f"arguments do not match the tool schema: {problem}",
            )

        async def invoke() -> NormalizedToolResult:
            assert runtime.session is not None
            try:
                result = await asyncio.wait_for(
                    runtime.session.call_tool(tool_name, arguments),
                    timeout=bounded_timeout,
                )
            except asyncio.TimeoutError:
                return tool_error_result(
                    "MCP_CALL_TIMEOUT",
                    f"'{tool_name}' timed out after {bounded_timeout:.0f}s",
                )
            except asyncio.CancelledError:
                return tool_error_result(
                    "MCP_CALL_CANCELLED", f"'{tool_name}' was cancelled"
                )
            content = _result_attr(result, "content", "")
            structured = _result_attr(result, "structured_content", "structuredContent")
            is_error = bool(
                getattr(result, "is_error", None)
                if hasattr(result, "is_error")
                else getattr(result, "isError", False)
            )
            return normalize_mcp_result(
                content, is_error=is_error, structured_content=structured
            )

        async def tracked() -> NormalizedToolResult:
            # Register the real asyncio task so cancel_pending can interrupt a
            # call that is already running inside the loop thread.
            task = asyncio.current_task()
            if task is not None and cancel_key:
                with self._tasks_lock:
                    self._active_tasks[cancel_key] = task
            try:
                return await invoke()
            finally:
                if cancel_key:
                    with self._tasks_lock:
                        self._active_tasks.pop(cancel_key, None)

        assert self._loop is not None
        future = asyncio.run_coroutine_threadsafe(tracked(), self._loop)
        if cancel_registry is not None and cancel_key:
            cancel_registry[cancel_key] = future
        try:
            return future.result(timeout=bounded_timeout + 15)
        except (asyncio.CancelledError, concurrent.futures.CancelledError):
            return tool_error_result("MCP_CALL_CANCELLED", f"'{tool_name}' was cancelled")
        except concurrent.futures.TimeoutError:
            return tool_error_result(
                "MCP_CALL_TIMEOUT", f"'{tool_name}' exceeded the transport budget"
            )
        except Exception:
            return tool_error_result("MCP_CALL_FAILED", "tool invocation failed")
        finally:
            if cancel_registry is not None and cancel_key:
                cancel_registry.pop(cancel_key, None)

    def cancel_pending(self, cancel_registry: dict[str, Any]) -> int:
        """Cancel every pending/running call registered under ``registry``.

        Works across threads: running coroutines are cancelled on the loop
        thread via ``call_soon_threadsafe``; calls that have not started yet
        are dropped by cancelling their transport future.
        """
        entries = list(cancel_registry.items())
        cancel_registry.clear()
        keys = [key for key, _ in entries]

        def do_cancel_tasks() -> None:
            with self._tasks_lock:
                targets = [self._active_tasks.get(key) for key in keys]
            for task in targets:
                if task is not None and not task.done():
                    task.cancel()

        if self._loop is not None:
            self._loop.call_soon_threadsafe(do_cancel_tasks)
        cancelled = 0
        for _key, future in entries:
            try:
                if future.cancel():
                    cancelled += 1
            except Exception:
                pass
        return len(keys)

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    @staticmethod
    def _summary(runtime: _ServerRuntime) -> dict[str, Any]:
        return {
            "id": runtime.config.id,
            "name": runtime.config.name,
            "state": runtime.state,
            "message": runtime.message,
            "enabled": runtime.config.enabled,
            "command": runtime.config.command,
            "tools": len(runtime.tool_schemas),
            "tool_names": sorted(runtime.tool_schemas.keys()),
            "env_names": list(runtime.config.env_names),
            "tool_policies": dict(runtime.config.tool_policies),
        }

    def server_summary(self, server_id: str) -> dict[str, Any] | None:
        runtime = self._servers.get(server_id)
        if runtime is None:
            return None
        return {
            "id": runtime.config.id,
            "name": runtime.config.name,
            "state": runtime.state,
            "tool_policies": dict(runtime.config.tool_policies),
            "tool_descriptions": dict(runtime.tool_descriptions),
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            servers = [self._summary(rt) for rt in self._servers.values()]
        return {
            "enabled": self.enabled,
            "servers": servers,
            "connected": sum(
                1 for summary in servers if summary["state"] == SERVER_STATE_CONNECTED
            ),
        }

    def shutdown_children_nowait(self) -> None:
        """Best-effort synchronous teardown used by tests."""
        self.close()


__all__ = [
    "McpHost",
    "SERVER_STATE_AWAITING_SECRET",
    "SERVER_STATE_CONNECTED",
    "SERVER_STATE_CONNECTING",
    "SERVER_STATE_DISABLED",
    "SERVER_STATE_ERROR",
]
