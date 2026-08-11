from __future__ import annotations

import fnmatch
from pathlib import Path, PurePosixPath


def normalize_relative(path: str) -> str:
    raw = str(path).replace("\\", "/").strip("/")
    parts = PurePosixPath(raw).parts
    if not raw or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Invalid vault-relative path: {path!r}")
    return "/".join(parts)


def glob_match(path: str, pattern: str) -> bool:
    path = path.replace("\\", "/").strip("/")
    pattern = pattern.replace("\\", "/").strip("/")
    if not pattern:
        return False
    if fnmatch.fnmatchcase(path, pattern):
        return True
    if pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]):
        return True
    if pattern.endswith("/**"):
        root = pattern[:-3].rstrip("/")
        return path == root or path.startswith(root + "/")
    return False


def is_in_scope(path: str, include_globs: list[str], exclude_globs: list[str]) -> bool:
    rel = normalize_relative(path)
    if not rel.lower().endswith(".md"):
        return False
    included = any(glob_match(rel, pattern) for pattern in include_globs)
    excluded = any(glob_match(rel, pattern) for pattern in exclude_globs)
    return included and not excluded


def iter_vault_files(vault: Path, include_globs: list[str],
                     exclude_globs: list[str]) -> list[str]:
    files: list[str] = []
    for file in vault.rglob("*.md"):
        try:
            rel = file.relative_to(vault).as_posix()
        except ValueError:
            continue
        if is_in_scope(rel, include_globs, exclude_globs):
            files.append(rel)
    return sorted(files)


def resolve_inside_vault(vault: Path, relative: str) -> Path:
    rel = normalize_relative(relative)
    resolved_vault = vault.resolve()
    target = (resolved_vault / Path(*PurePosixPath(rel).parts)).resolve()
    try:
        target.relative_to(resolved_vault)
    except ValueError as exc:
        raise ValueError(f"Path escapes vault: {relative}") from exc
    return target
