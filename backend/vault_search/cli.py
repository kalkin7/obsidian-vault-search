from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .protocol import ProtocolError, request
from .runtime import default_data_dir, read_json, vault_id

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def discover_vault(explicit: str | None) -> Path:
    if explicit:
        vault = Path(explicit).resolve()
        if (vault / ".obsidian").is_dir():
            return vault
        raise ValueError(f"Not an Obsidian vault: {vault}")
    env = os.environ.get("OBSIDIAN_VAULT_ROOT")
    if env:
        return discover_vault(env)
    current = Path.cwd().resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".obsidian").is_dir():
            return candidate
    raise ValueError("Could not find an Obsidian vault; use --vault")


def _pid_is_running(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    except Exception:
        return False


def call_runtime(vault: Path, method: str, params: dict[str, Any],
                 timeout: float) -> dict[str, Any]:
    runtime = _read_runtime(vault)
    try:
        return request(
            str(runtime.get("host", "127.0.0.1")),
            int(runtime["port"]),
            str(runtime["token"]),
            method,
            params,
            timeout=timeout,
        )
    except (OSError, KeyError, ValueError, ProtocolError, json.JSONDecodeError) as exc:
        raise ServiceUnavailable(f"Vault Search Service is unavailable: {exc}") from exc


def _read_runtime(vault: Path) -> dict[str, Any]:
    runtime_path = default_data_dir(vault) / "runtime.json"
    runtime = read_json(runtime_path)
    if runtime is None:
        raise ServiceUnavailable(
            f"Vault Search Service is not running for {vault}. Open the vault in Obsidian or start the plugin.")
    if runtime.get("vault_id") != vault_id(vault):
        raise ServiceUnavailable("Stale runtime belongs to a different vault")
    try:
        pid = int(runtime["pid"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ServiceUnavailable("Backend runtime is stale") from exc
    if not _pid_is_running(pid):
        raise ServiceUnavailable("Backend runtime is stale")
    return runtime


def _runtime_is_valid(vault: Path) -> bool:
    try:
        runtime = _read_runtime(vault)
    except ServiceUnavailable:
        return False
    try:
        response = request(
            str(runtime.get("host", "127.0.0.1")),
            int(runtime["port"]),
            str(runtime["token"]),
            "health",
            timeout=2.0,
        )
        return bool(response.get("ok"))
    except (OSError, KeyError, ValueError, ProtocolError, json.JSONDecodeError):
        return False


def _backend_root_for(vault: Path) -> Path:
    """Resolve the Python package root used to spawn the backend.

    Prefers the plugin-side backend (which is provisioned to match the
    installed plugin version); falls back to the CLI's own package.
    """
    plugin_backend = vault / ".obsidian" / "plugins" / "obsidian-vault-search" / "backend"
    if (plugin_backend / "vault_search" / "__main__.py").exists():
        return plugin_backend
    import vault_search
    return Path(vault_search.__file__).resolve().parents[1]


def _windowless_python(python: str) -> str:
    """Return a Python executable that never opens a console window.

    pythonw.exe is the Windows GUI-subsystem build of python.exe; spawning it
    with redirected stdout/stderr runs headless with no conhost at all. Falls
    back to python.exe on non-Windows or when pythonw.exe is absent.
    """
    if os.name != "nt":
        return python
    executable = Path(python)
    windowless = executable.with_name("pythonw.exe")
    if windowless.exists():
        return str(windowless)
    # python.exe may have been found via PATH; probe for a sibling pythonw.exe.
    for directory in (executable.parent, Path(sys.executable).parent):
        candidate = directory / "pythonw.exe"
        if candidate.exists():
            return str(candidate)
    return python


def _spawn_standalone(vault: Path, timeout: float, idle_exit_seconds: float) -> dict[str, Any]:
    """Start a detached standalone backend and wait until it is listening.

    Returns the runtime dict. On Windows the process is created outside the
    current process tree with stdout/stderr redirected to backend.log so no
    pipe is left open and the CLI can exit independently.
    """
    data_dir = default_data_dir(vault)
    config_path = data_dir / "service-config.json"
    machine = read_json(data_dir / "machine.json")
    if machine is None:
        raise ServiceUnavailable(
            f"Vault Search backend is not installed for {vault}. Open the vault in Obsidian to provision it.")
    python = str(machine.get("pythonExecutable") or "python")
    if not Path(python).exists():
        raise ServiceUnavailable(f"Configured Python does not exist: {python}")
    if not config_path.exists():
        raise ServiceUnavailable(
            f"Vault Search service config is missing: {config_path}. Open the vault in Obsidian to create it.")
    backend_root = _backend_root_for(vault)
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONPATH"] = str(backend_root) + (
        os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    server_args = [
        "-X", "utf8", "-m", "vault_search", "serve",
        "--config", str(config_path),
        "--vault", str(vault),
        "--data-dir", str(data_dir),
        "--owner", "standalone",
        "--lazy-model",
        "--model-idle-seconds", "300",
    ]
    if idle_exit_seconds > 0:
        server_args.extend(["--idle-exit-seconds", str(idle_exit_seconds)])
    log_path = data_dir / "backend.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    # Use pythonw.exe when available so the detached server never attaches a
    # console window (CREATE_NO_WINDOW still leaves a conhost on some builds).
    server_python = _windowless_python(python)
    with open(log_path, "a", encoding="utf-8") as log:
        creationflags = 0
        start_new_session = False
        if os.name == "nt":
            creationflags = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        else:
            start_new_session = True
        process = subprocess.Popen(
            [server_python, *server_args],
            cwd=str(backend_root), env=env,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            creationflags=creationflags, start_new_session=start_new_session,
            close_fds=True,
        )
    runtime_path = data_dir / "runtime.json"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        runtime = read_json(runtime_path)
        if runtime is not None and runtime.get("vault_id") == vault_id(vault) \
                and int(runtime.get("pid", 0)) == process.pid \
                and _pid_is_running(int(runtime["pid"])):
            return runtime
        if process.poll() is not None:
            raise ServiceUnavailable(
                f"Standalone backend exited during startup (code {process.returncode}); see {log_path}")
        time.sleep(0.1)
    raise ServiceUnavailable("Standalone backend did not start listening in time")


def _ensure_search_runtime(vault: Path, timeout: float,
                           idle_exit_seconds: float, no_start: bool) -> None:
    if _runtime_is_valid(vault):
        return
    if no_start:
        raise ServiceUnavailable(
            f"Vault Search Service is not running for {vault} and --no-start was given.")
    try:
        _spawn_standalone(vault, timeout, idle_exit_seconds)
    except ServiceUnavailable:
        # A concurrent spawner may have won the ServiceLock. Poll for its
        # runtime file until the winner becomes reachable.
        deadline = time.monotonic() + max(1.0, timeout)
        while time.monotonic() < deadline:
            time.sleep(0.25)
            if _runtime_is_valid(vault):
                return
        raise


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vault-search")
    parser.add_argument("--vault")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--startup-timeout", type=float, default=180.0)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_runtime_flags(target: argparse.ArgumentParser) -> None:
        target.add_argument("--no-start", action="store_true",
                            help="Do not start a standalone backend when none is running")
        target.add_argument("--idle-exit-seconds", type=float, default=1800.0,
                            help="Standalone backend idle-exit window when starting it (default 1800s)")

    search = sub.add_parser("search")
    search.add_argument("query")
    search.add_argument("--top", type=int, default=None)
    search.add_argument("--verbose", action="store_true")
    search.add_argument("--match", choices=("any", "all", "phrase"), default="any")
    search.add_argument("--intent", choices=(
        "exact", "known-item", "topic", "timeline", "value", "korean-morphology"))
    search.add_argument("--json", action="store_true", dest="json_output")
    add_runtime_flags(search)
    sub.add_parser("status")
    for name, method in (("rebuild-vectors", "rebuild_vectors"),
                         ("rebuild-all", "rebuild_all")):
        rebuild = sub.add_parser(name)
        rebuild.set_defaults(rebuild_method=method)
        add_runtime_flags(rebuild)
    return parser


def main() -> None:
    args = make_parser().parse_args()
    try:
        vault = discover_vault(args.vault)
        if args.command in {"search", "rebuild-vectors", "rebuild-all"}:
            _ensure_search_runtime(vault, args.startup_timeout,
                                   args.idle_exit_seconds, args.no_start)
        if args.command == "search":
            params = {
                "query": args.query,
                "top_k": args.top,
                "verbose": args.verbose,
                "match_mode": args.match,
            }
            if args.intent:
                params["intent"] = args.intent
            response = call_runtime(vault, "search", params, args.timeout)
            error = response.get("error") or {}
            if not response.get("ok") and error.get("code") == "MODEL_LOADING":
                deadline = time.monotonic() + max(1.0, args.startup_timeout)
                while time.monotonic() < deadline:
                    time.sleep(0.25)
                    status = call_runtime(vault, "status", {}, args.timeout)
                    state = (status.get("data") or {}).get("state") if status.get("ok") else "error"
                    if state in {"ready", "ready_no_index"}:
                        response = call_runtime(vault, "search", params, args.timeout)
                        break
                    if state == "error":
                        message = str((status.get("data") or {}).get("error") or "Backend initialization failed")
                        response = {"ok": False, "error": {"code": "BACKEND_ERROR", "message": message}}
                        break
                else:
                    print("[MODEL_LOADING] Model startup timed out", file=sys.stderr)
                    raise SystemExit(4)
            if not response.get("ok"):
                _print_error(response.get("error") or {})
                raise SystemExit(4)
            data = response.get("data") or {}
            results = data.get("results", [])
            diagnostics = data.get("diagnostics") or {}
            if diagnostics.get("candidate_pool_size") is not None:
                pool = int(diagnostics["candidate_pool_size"])
                requested = int(diagnostics.get("requested_top_k") or 0)
                if requested > pool:
                    print(
                        f"[POOL_WARNING] 요청한 top-K({requested})보다 후보 풀이 작습니다(실제 {pool}). "
                        f"bm25TopK/vectorTopK 또는 키워드 채널을 늘리세요.",
                        file=sys.stderr)
            if args.json_output:
                print(json.dumps(results, ensure_ascii=False, indent=2))
            else:
                for item in results:
                    print(f"[{item['rank']}] {item['file_path']} ({item['score']:.6f})")
                    text = str(item.get("content", "")).strip().replace("\n", " ")
                    print("   " + (text[:240] + "…" if len(text) > 240 else text))
            return
        if args.command in {"rebuild-vectors", "rebuild-all"}:
            _ensure_model_ready(vault, args)
            response = call_runtime(vault, args.rebuild_method, {}, args.timeout)
            if not response.get("ok"):
                _print_error(response.get("error") or {})
                raise SystemExit(4)
            print(json.dumps(response.get("data") if response.get("ok") else response,
                             ensure_ascii=False, indent=2))
            return
        response = call_runtime(vault, "status", {}, args.timeout)
        print(json.dumps(response.get("data") if response.get("ok") else response,
                         ensure_ascii=False, indent=2))
    except (ValueError, ServiceUnavailable) as exc:
        print(f"[SERVICE_UNAVAILABLE] {exc}", file=sys.stderr)
        raise SystemExit(3) from exc


def _ensure_model_ready(vault: Path, args: argparse.Namespace) -> None:
    """Make sure the backend model is loaded before an index operation.

    A lazy backend starts in ``idle``; index operations (rebuild) need the
    embedding model. Trigger ``load_model`` and wait for a terminal state.
    """
    deadline = time.monotonic() + max(1.0, args.startup_timeout)
    while time.monotonic() < deadline:
        status = call_runtime(vault, "status", {}, args.timeout)
        state = (status.get("data") or {}).get("state") if status.get("ok") else "error"
        if state in {"ready", "ready_no_index"}:
            return
        if state in {"starting", "loading_model"}:
            time.sleep(0.25)
            continue
        if state == "idle":
            call_runtime(vault, "load_model", {}, args.timeout)
            time.sleep(0.25)
            continue
        if state == "error":
            message = str((status.get("data") or {}).get("error") or "Backend initialization failed")
            raise ServiceUnavailable(f"Backend initialization failed: {message}")
    raise ServiceUnavailable("Backend model did not become ready in time")


def _print_error(error: dict[str, Any]) -> None:
    code = error.get("code", "ERROR")
    message = error.get("message", "Request failed")
    print(f"[{code}] {message}", file=sys.stderr)
    if code == "INDEX_REBUILD_REQUIRED":
        details = error.get("details") or {}
        action = details.get("recommended_action")
        if action == "rebuild_vectors":
            print("복구 방법: 벡터 재구축 — Obsidian 설정에서 '벡터 재구축'을 실행하거나"
                  " `vault-search rebuild-vectors` 를 사용하세요.", file=sys.stderr)
        elif action == "rebuild_all":
            print("복구 방법: 전체 재구축 — Obsidian 설정에서 '전체 재구축'을 실행하거나"
                  " `vault-search rebuild-all` 을 사용하세요.", file=sys.stderr)


class ServiceUnavailable(RuntimeError):
    pass


if __name__ == "__main__":
    main()
