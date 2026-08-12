from __future__ import annotations

import argparse
import json
import os
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


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vault-search")
    parser.add_argument("--vault")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--startup-timeout", type=float, default=180.0)
    sub = parser.add_subparsers(dest="command", required=True)
    search = sub.add_parser("search")
    search.add_argument("query")
    search.add_argument("--top", type=int, default=20)
    search.add_argument("--verbose", action="store_true")
    search.add_argument("--match", choices=("any", "all", "phrase"), default="any")
    search.add_argument("--intent", choices=(
        "exact", "known-item", "topic", "timeline", "value", "korean-morphology"))
    search.add_argument("--json", action="store_true", dest="json_output")
    sub.add_parser("status")
    return parser


def main() -> None:
    args = make_parser().parse_args()
    try:
        vault = discover_vault(args.vault)
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
                error = response.get("error") or {}
                print(f"[{error.get('code', 'ERROR')}] {error.get('message', 'Search failed')}", file=sys.stderr)
                raise SystemExit(4)
            data = response.get("data") or {}
            results = data.get("results", [])
            if args.json_output:
                print(json.dumps(results, ensure_ascii=False, indent=2))
            else:
                for item in results:
                    print(f"[{item['rank']}] {item['file_path']} ({item['score']:.6f})")
                    text = str(item.get("content", "")).strip().replace("\n", " ")
                    print("   " + (text[:240] + "…" if len(text) > 240 else text))
            return
        response = call_runtime(vault, "status", {}, args.timeout)
        print(json.dumps(response.get("data") if response.get("ok") else response,
                         ensure_ascii=False, indent=2))
    except (ValueError, ServiceUnavailable) as exc:
        print(f"[SERVICE_UNAVAILABLE] {exc}", file=sys.stderr)
        raise SystemExit(3) from exc


class ServiceUnavailable(RuntimeError):
    pass


if __name__ == "__main__":
    main()
