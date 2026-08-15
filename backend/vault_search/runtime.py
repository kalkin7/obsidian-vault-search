from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
from typing import Any


def canonical_vault_path(vault: str | Path) -> str:
    value = Path(vault).resolve().as_posix()
    return value.lower() if os.name == "nt" else value


def vault_id(vault: str | Path) -> str:
    return hashlib.sha256(canonical_vault_path(vault).encode("utf-8")).hexdigest()[:20]


def default_data_dir(vault: str | Path) -> Path:
    root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return root / "ObsidianVaultSearch" / "vaults" / vault_id(vault)


def _write_private_text(path: Path, content: str) -> None:
    """Write a token-bearing file with owner-only permissions from the start.

    On POSIX the bearer token must never be world/group-readable, even
    transiently: creating the file with an explicit 0600 mode (the umask can
    only narrow it) guarantees privacy from the first byte instead of relying
    on a chmod after the fact. Windows LOCALAPPDATA is user-ACL protected, so
    the plain write is sufficient there.
    """
    if os.name == "nt":
        path.write_text(content, encoding="utf-8")
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
    except Exception:
        # os.fdopen takes ownership of fd on success; on failure close it to
        # avoid leaking the descriptor.
        with contextlib.suppress(OSError):
            os.close(fd)
        raise


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    _write_private_text(temporary, json.dumps(payload, ensure_ascii=False, indent=2))
    os.replace(temporary, path)
    # The replaced file inherits the temp file's 0600 mode; re-assert it as a
    # belt-and-suspenders measure for files created by older code paths.
    _restrict_private_file(path)


def _restrict_private_file(path: Path) -> None:
    """Restrict a token-bearing file to the current user where supported.

    runtime.json contains a bearer token; on POSIX the file must not be world-
    or group-readable. Windows LOCALAPPDATA is user-ACL protected by default,
    so only POSIX needs an explicit chmod here. Atomic writes create the file
    with 0600 from the outset; this only re-asserts it for pre-existing files.
    """
    try:
        if os.name != "nt":
            os.chmod(path, 0o600)
    except OSError:
        pass


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return None
