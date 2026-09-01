from __future__ import annotations

import argparse
import json
import os
import queue
import secrets
import socket
import socketserver
import sys
import threading
import time
from typing import Any

from . import __version__
from .config import load_config
from .protocol import (
    MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    ProtocolError,
    validate_answer_cancel_params,
    validate_answer_continue_params,
    validate_answer_params,
    validate_answer_start_params,
    validate_answer_status_params,
    validate_mcp_secrets_params,
)
from .runtime import atomic_write_json, vault_id
from .service import SearchService, ServiceError
from .service_lock import ServiceLock, ServiceLockError
from .indexing import IndexManager

# Short RPCs use a shorter post-flush pause (5ms) instead of the full 20ms:
# they are idempotent or tiny, and the extra time would add up on heartbeat /
# status polling. They still pause — a tight loop with no pause RSTs on Windows.
_SHORT_CLOSE_METHODS = frozenset(
    {
        "heartbeat",
        "status",
        "health",
        "answer_status",
        "answer_cancel",
    }
)

# Methods whose params are validated before entering the task queue.
_PARAM_VALIDATORS = {
    "answer": validate_answer_params,
    "answer_start": validate_answer_start_params,
    "answer_continue": validate_answer_continue_params,
    "answer_cancel": validate_answer_cancel_params,
    "answer_status": validate_answer_status_params,
    "set_mcp_secrets": validate_mcp_secrets_params,
}

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


class BackendTask:
    def __init__(self, method: str, params: dict[str, Any]):
        self.method = method
        self.params = params
        self.done = threading.Event()
        self.result: Any = None
        self.error: BaseException | None = None


class BackendServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[socketserver.BaseRequestHandler],
        service: SearchService,
        token: str,
    ):
        self.service = service
        self.token = token
        self.tasks: queue.Queue[BackendTask] = queue.Queue()
        self._lock = threading.Lock()
        self._requests_active = 0
        self._closing = False
        super().__init__(address, handler)


class RequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        request_id: Any = None
        method: str | None = None
        server: BackendServer | None = None  # type: ignore[assignment]
        incremented = False
        try:
            line = self.rfile.readline(MAX_MESSAGE_BYTES + 1)
            if len(line) > MAX_MESSAGE_BYTES:
                self._send(
                    False,
                    request_id,
                    error={"code": "REQUEST_TOO_LARGE", "message": "Request too large"},
                    method=method,
                )
                return
            payload = json.loads(line.decode("utf-8"))
            request_id = payload.get("request_id")
            if payload.get("protocol_version") != PROTOCOL_VERSION:
                self._send(
                    False,
                    request_id,
                    error={
                        "code": "PROTOCOL_MISMATCH",
                        "message": "Unsupported protocol version",
                    },
                    method=method,
                )
                return
            server = self.server  # type: ignore[assignment]
            if not secrets.compare_digest(str(payload.get("token", "")), server.token):
                self._send(
                    False,
                    request_id,
                    error={"code": "UNAUTHORIZED", "message": "Invalid token"},
                    method=method,
                )
                return
            method = str(payload.get("method", ""))
            if method == "shutdown":
                # Serialize shutdown with closing flag so concurrent idle watcher
                # and handler do not race. Mark closing before responding.
                with server._lock:
                    if server._closing:
                        # Already shutting down — idempotent success
                        self._send(
                            True, request_id, data={"stopping": True}, method=method
                        )
                        return
                    server._closing = True
                self._send(True, request_id, data={"stopping": True}, method=method)
                threading.Thread(target=server.shutdown, daemon=True).start()
                return
            # All non-shutdown requests are counted so the idle watcher never
            # sees counter==0 while a task is queued, executing, or responding.
            with server._lock:
                if server._closing:
                    self._send(
                        False,
                        request_id,
                        error={
                            "code": "SERVICE_UNAVAILABLE",
                            "message": "Server is shutting down",
                        },
                        method=method,
                    )
                    return
                server._requests_active += 1
                incremented = True
            params = payload.get("params") or {}
            if not isinstance(params, dict):
                raise ProtocolError("params must be an object")
            validator = _PARAM_VALIDATORS.get(method)
            if validator is not None:
                params = validator(params)
            if method in {"health", "status", "heartbeat", "load_model"}:
                result = server.service.call(method, params)
            elif method == "answer_cancel":
                # Out-of-band: cancellation must not wait behind a long-running
                # answer on the serialized task queue. cancel_answer only
                # touches lock-guarded state and is safe on this thread.
                result = server.service.cancel_answer(str(params.get("run_id", "")))
            elif method == "answer_status":
                # Out-of-band read-only status — must not queue behind answer_start
                result = server.service.call(method, params)
            else:
                # Keep activity fresh while task is queued
                try:
                    server.service.last_activity = time.monotonic()
                except Exception:
                    pass
                task = BackendTask(method, params)
                server.tasks.put(task)
                task.done.wait()
                if task.error is not None:
                    raise task.error
                result = task.result
            self._send(True, request_id, data=result, method=method)
        except ServiceError as exc:
            error: dict[str, Any] = {"code": exc.code, "message": exc.message}
            if exc.details is not None:
                error["details"] = exc.details
            self._send(False, request_id, error=error, method=method)
        except ProtocolError as exc:
            self._send(
                False,
                request_id,
                error={"code": "ANSWER_INVALID_PARAMS", "message": str(exc)},
                method=method,
            )
        except Exception as exc:
            self._send(
                False,
                request_id,
                error={
                    "code": "INTERNAL_ERROR",
                    "message": f"{type(exc).__name__}: {exc}",
                },
                method=method,
            )
        finally:
            if incremented and server is not None:
                with server._lock:
                    server._requests_active -= 1
                    if server._requests_active < 0:
                        server._requests_active = 0

    def _send(
        self,
        ok: bool,
        request_id: Any,
        data: Any = None,
        error: dict[str, Any] | None = None,
        method: str | None = None,
    ) -> None:
        payload = {
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "ok": ok,
        }
        if ok:
            payload["data"] = data
        else:
            payload["error"] = error
        # Half-close after flush. On Windows loopback, a full close while the
        # client still has the socket open commonly becomes RST/10054 and can
        # discard a response that was already written. Lost replies still
        # recover via run_id + answer_status.
        try:
            self.wfile.write(
                (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            )
            self.wfile.flush()
            try:
                self.request.shutdown(socket.SHUT_WR)
            except OSError:
                pass
            # Brief pause so the client can consume the response before the
            # handler returns and the socket is fully closed (Windows RST).
            # Short idempotent RPCs (heartbeat/status polling) use a smaller
            # 5ms pause; everything else 20ms. The pause is never skipped — a
            # tight loop with no pause still RST's on Windows.
            if method in _SHORT_CLOSE_METHODS:
                time.sleep(0.005)
            else:
                time.sleep(0.02)
        except OSError as exc:
            try:
                err_no = getattr(exc, "errno", None)
                safe = {
                    "event": "send_failed",
                    "data": {
                        "request_id": request_id,
                        "method": method,
                        "stage": "write",
                        "errno": err_no,
                        "exc_class": type(exc).__name__,
                    },
                }
                print(json.dumps(safe, ensure_ascii=False), file=sys.stderr, flush=True)
            except Exception:
                pass


def emit(event: str, data: dict[str, Any]) -> None:
    print(json.dumps({"event": event, "data": data}, ensure_ascii=False), flush=True)


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def run_server(args: argparse.Namespace) -> int:
    config = load_config(args.config, args.vault, args.data_dir)
    standalone = getattr(args, "owner", "plugin") == "standalone"
    if getattr(args, "lazy_model", False):
        config.lazy_model = True
    if getattr(args, "model_idle_seconds", 0.0) > 0:
        try:
            config.model_idle_timeout_seconds = float(args.model_idle_seconds)
        except (TypeError, ValueError):
            pass
    try:
        idle_exit_seconds = float(getattr(args, "idle_exit_seconds", 0.0) or 0.0)
    except (TypeError, ValueError):
        idle_exit_seconds = 0.0
    try:
        writer_lock = ServiceLock.acquire(config.data_dir)
    except ServiceLockError as exc:
        print(f"ServiceLockError: {exc}", file=sys.stderr, flush=True)
        return 2
    try:
        IndexManager.recover_interrupted_replace(config.index_dir)
        IndexManager.cleanup_stale_operation_artifacts(config.index_dir)
    except Exception as exc:
        writer_lock.close()
        print(
            f"IndexRecoveryError: {type(exc).__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 2
    token = secrets.token_urlsafe(32)
    service = SearchService(config, emit)
    server = BackendServer(("127.0.0.1", 0), RequestHandler, service, token)
    host, port = server.server_address
    runtime = {
        "runtime_schema": 1,
        "protocol_version": PROTOCOL_VERSION,
        "backend_version": __version__,
        "vault_id": vault_id(config.vault_path),
        "vault_path": config.vault_path.as_posix(),
        "pid": os.getpid(),
        "parent_pid": 0 if standalone else args.parent_pid,
        "owner": "standalone" if standalone else "plugin",
        "host": host,
        "port": port,
        "token": token,
        "state": "idle" if config.lazy_model else "loading_model",
        "model_id": config.model_id,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    atomic_write_json(config.runtime_path, runtime)
    # The token must never reach stdout: plugin-owned children and CLI
    # standalone spawns both persist stdout to backend.log. Consumers read the
    # token from runtime.json (written above) instead.
    emit("listening", {**runtime, "token": "<redacted>"})

    server_thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True
    )
    server_thread.start()
    if config.lazy_model:
        emit("idle", service.status())
    else:
        service.start_initialization()

    if not standalone:
        if args.watch_stdin:

            def watch_stdin() -> None:
                try:
                    if os.name == "nt":
                        import ctypes
                        import msvcrt

                        handle = msvcrt.get_osfhandle(sys.stdin.fileno())
                        available = ctypes.c_ulong(0)
                        while ctypes.windll.kernel32.PeekNamedPipe(
                            handle, None, 0, None, ctypes.byref(available), None
                        ):
                            time.sleep(0.5)
                    else:
                        import select

                        while True:
                            readable, _, _ = select.select([sys.stdin], [], [], 0.5)
                            if readable and not os.read(sys.stdin.fileno(), 1):
                                break
                except Exception:
                    pass
                emit("parent_disconnected", {})
                server.shutdown()

            threading.Thread(target=watch_stdin, daemon=True).start()

        if args.parent_pid:

            def watch_parent() -> None:
                while process_exists(args.parent_pid):
                    time.sleep(1.0)
                emit("parent_pid_exited", {"parent_pid": args.parent_pid})
                server.shutdown()

            threading.Thread(target=watch_parent, daemon=True).start()

        def watch_heartbeat() -> None:
            while True:
                time.sleep(1.0)
                # Model imports/initialization can hold the GIL long enough to delay the
                # loopback heartbeat handler. stdin EOF still protects parent failure.
                timeout = (
                    max(config.heartbeat_timeout_seconds, 300.0)
                    if service.state not in {"idle", "ready", "ready_no_index", "error"}
                    else config.heartbeat_timeout_seconds
                )
                if time.monotonic() - service.last_heartbeat > timeout:
                    # Electron can throttle renderer timers while the window is in the
                    # background. A live parent PID is a stronger liveness signal.
                    if args.parent_pid and process_exists(args.parent_pid):
                        service.last_heartbeat = time.monotonic()
                        continue
                    emit("heartbeat_timeout", {"timeout_seconds": timeout})
                    server.shutdown()
                    return

        threading.Thread(target=watch_heartbeat, daemon=True).start()
    else:

        def watch_idle_exit() -> None:
            if idle_exit_seconds <= 0:
                return
            while True:
                time.sleep(1.0)
                if service.state not in {"ready", "ready_no_index", "idle"}:
                    continue
                if service.initialization_requested.is_set():
                    continue
                # Use lock-protected counter; never use Queue.empty() as invariant
                should_shutdown = False
                with server._lock:
                    if server._requests_active != 0:
                        continue
                    if server._closing:
                        return
                    if getattr(service, "_index_operation_active", False):
                        continue
                    last_seen = max(service.last_activity, service.last_heartbeat)
                    if time.monotonic() - last_seen <= idle_exit_seconds:
                        continue
                    server._closing = True
                    should_shutdown = True
                if should_shutdown:
                    emit("idle_exit", {"idle_exit_seconds": idle_exit_seconds})
                    server.shutdown()
                    return

        threading.Thread(target=watch_idle_exit, daemon=True).start()

    try:
        while server_thread.is_alive():
            if service.initialization_requested.is_set():
                service.initialization_requested.clear()
                service.initialize()
            try:
                task = server.tasks.get(timeout=0.05)
            except queue.Empty:
                task = None
            if task is not None:
                try:
                    task.result = service.call(task.method, task.params)
                except BaseException as exc:
                    task.error = exc
                finally:
                    task.done.set()
            server_thread.join(timeout=0.01)
    finally:
        if server_thread.is_alive():
            server.shutdown()
            server_thread.join(timeout=2.0)
        server.server_close()
        # Every shutdown path (clean stop, parent disconnect, heartbeat
        # timeout, exception) must tear down MCP sessions/children and runs.
        try:
            service.close()
        except Exception as close_error:
            emit(
                "warning",
                {
                    "code": "SERVICE_CLOSE_FAILED",
                    "message": f"{type(close_error).__name__}: {close_error}",
                },
            )
        try:
            if config.runtime_path.exists():
                current = json.loads(config.runtime_path.read_text(encoding="utf-8"))
                if int(current.get("pid", -1)) == os.getpid():
                    config.runtime_path.unlink()
        except Exception:
            pass
        writer_lock.close()
        emit("stopped", {"pid": os.getpid()})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vault-search-backend")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--config", required=True)
    serve.add_argument("--vault")
    serve.add_argument("--data-dir")
    serve.add_argument("--parent-pid", type=int, default=0)
    serve.add_argument("--watch-stdin", action="store_true")
    serve.add_argument("--owner", choices=("plugin", "standalone"), default="plugin")
    serve.add_argument("--idle-exit-seconds", type=float, default=0.0)
    serve.add_argument("--lazy-model", action="store_true")
    serve.add_argument("--model-idle-seconds", type=float, default=0.0)
    return parser


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    args = build_parser().parse_args()
    if args.command == "serve":
        raise SystemExit(run_server(args))


if __name__ == "__main__":
    main()
