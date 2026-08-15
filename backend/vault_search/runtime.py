from __future__ import annotations

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


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _restrict_private_file(temporary)
    os.replace(temporary, path)
    _restrict_private_file(path)


def _restrict_private_file(path: Path) -> None:
    """Restrict a token-bearing file to the current user where supported.

    runtime.json contains a bearer token; on POSIX the file must not be world-
    or group-readable. Windows LOCALAPPDATA is user-ACL protected by default, so
    only POSIX needs an explicit chmod here.
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
