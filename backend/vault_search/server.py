from __future__ import annotations

import argparse
import json
import os
import queue
import secrets
import socketserver
import sys
import threading
import time
from pathlib import Path
from typing import Any

from . import __version__
from .config import load_config
from .protocol import MAX_MESSAGE_BYTES, PROTOCOL_VERSION
from .runtime import atomic_write_json, vault_id
from .service import SearchService, ServiceError

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

    def __init__(self, address: tuple[str, int], handler: type[socketserver.BaseRequestHandler],
                 service: SearchService, token: str):
        self.service = service
        self.token = token
        self.tasks: queue.Queue[BackendTask] = queue.Queue()
        super().__init__(address, handler)


class RequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        request_id: Any = None
        try:
            line = self.rfile.readline(MAX_MESSAGE_BYTES + 1)
            if len(line) > MAX_MESSAGE_BYTES:
                self._send(False, request_id, error={"code": "REQUEST_TOO_LARGE", "message": "Request too large"})
                return
            payload = json.loads(line.decode("utf-8"))
            request_id = payload.get("request_id")
            if payload.get("protocol_version") != PROTOCOL_VERSION:
                self._send(False, request_id, error={"code": "PROTOCOL_MISMATCH", "message": "Unsupported protocol version"})
                return
            server: BackendServer = self.server  # type: ignore[assignment]
            if not secrets.compare_digest(str(payload.get("token", "")), server.token):
                self._send(False, request_id, error={"code": "UNAUTHORIZED", "message": "Invalid token"})
                return
            method = str(payload.get("method", ""))
            if method == "shutdown":
                self._send(True, request_id, data={"stopping": True})
                threading.Thread(target=server.shutdown, daemon=True).start()
                return
            params = payload.get("params") or {}
            if method in {"health", "status", "heartbeat", "load_model"}:
                result = server.service.call(method, params)
            else:
                task = BackendTask(method, params)
                server.tasks.put(task)
                task.done.wait()
                if task.error is not None:
                    raise task.error
                result = task.result
            self._send(True, request_id, data=result)
        except ServiceError as exc:
            error: dict[str, Any] = {"code": exc.code, "message": exc.message}
            if exc.details is not None:
                error["details"] = exc.details
            self._send(False, request_id, error=error)
        except Exception as exc:
            self._send(False, request_id, error={
                "code": "INTERNAL_ERROR",
                "message": f"{type(exc).__name__}: {exc}",
            })

    def _send(self, ok: bool, request_id: Any, data: Any = None,
              error: dict[str, Any] | None = None) -> None:
        payload = {
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "ok": ok,
        }
        if ok:
            payload["data"] = data
        else:
            payload["error"] = error
        try:
            self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()
        except OSError:
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
        "parent_pid": args.parent_pid,
        "host": host,
        "port": port,
        "token": token,
        "state": "idle" if config.lazy_model else "loading_model",
        "model_id": config.model_id,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    atomic_write_json(config.runtime_path, runtime)
    emit("listening", runtime)

    server_thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
    server_thread.start()
    if config.lazy_model:
        emit("idle", service.status())
    else:
        service.start_initialization()

    if args.watch_stdin:
        def watch_stdin() -> None:
            try:
                if os.name == "nt":
                    import ctypes
                    import msvcrt
                    handle = msvcrt.get_osfhandle(sys.stdin.fileno())
                    available = ctypes.c_ulong(0)
                    while ctypes.windll.kernel32.PeekNamedPipe(
                            handle, None, 0, None, ctypes.byref(available), None):
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
            timeout = max(config.heartbeat_timeout_seconds, 300.0) \
                if service.state not in {"idle", "ready", "ready_no_index", "error"} \
                else config.heartbeat_timeout_seconds
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
        try:
            if config.runtime_path.exists():
                current = json.loads(config.runtime_path.read_text(encoding="utf-8"))
                if int(current.get("pid", -1)) == os.getpid():
                    config.runtime_path.unlink()
        except Exception:
            pass
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
    return parser


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    args = build_parser().parse_args()
    if args.command == "serve":
        raise SystemExit(run_server(args))


if __name__ == "__main__":
    main()
