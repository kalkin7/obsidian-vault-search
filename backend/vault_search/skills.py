"""Skill discovery and progressive loading for the API agent (plan §8).

Skills are ``SKILL.md`` packages under project-local roots
(``.agents/skills``, ``.claude/skills``, ``.opencode/skills``) or explicit
user-added roots. Discovery exposes only a bounded catalog (id, name,
description); the body loads on demand via :func:`load_skill_body` and
reference files via :func:`read_skill_resource` — both are strictly read-only
and never execute anything found in a skill folder.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

MAX_SKILL_MD_BYTES = 64 * 1024
MAX_SKILLS_PER_ROOT = 200
MAX_ACTIVE_SKILLS = 100
MAX_DESCRIPTION_CHARS = 2_000
MAX_RESOURCE_FILE_BYTES = 64 * 1024
MAX_RUN_RESOURCE_BUDGET_BYTES = 256 * 1024

DEFAULT_ROOT_DIRS = (".agents", ".claude", ".opencode")
FRONTMATTER_PATTERN = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?", re.DOTALL)

# Resource files that must never be shipped to the model even when they live
# inside a skill directory.
SECRET_SUFFIXES = {
    ".env",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".jks",
    ".keystore",
    ".crt",
    ".cer",
    ".der",
}
SECRET_BASENAMES = {
    "credentials",
    "credentials.json",
    "secrets.yaml",
    "secrets.yml",
    "secrets.json",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
}


class SkillError(Exception):
    """Coded skill failure surfaced to the model as a tool error."""


def normalize_name(name: str) -> str:
    """Canonical, case-insensitive-safe name used inside the skill id."""
    collapsed = re.sub(r"\s+", "-", name.strip().lower())
    return re.sub(r"[^0-9a-z가-힣._-]", "", collapsed)[:128] or "unnamed"


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _resolve_root(vault: Path, raw_path: str) -> Path | None:
    """Resolve a configured root path.

    Vault-relative paths must stay inside the vault. Explicit absolute paths
    are allowed (user opt-in) but must exist. Returns the resolved directory
    or None when the path escapes / does not exist.
    """
    cleaned = raw_path.replace("\\", "/").strip()
    if not cleaned:
        return None
    candidate = Path(cleaned)
    try:
        if candidate.is_absolute():
            resolved = candidate.resolve()
            return resolved if resolved.is_dir() else None
        resolved = (vault / candidate).resolve()
        if not _is_within(resolved, vault.resolve()):
            return None
        return resolved if resolved.is_dir() else None
    except OSError:
        return None


def parse_frontmatter(text: str) -> dict[str, str]:
    """Extract the simple ``key: value`` frontmatter subset skills use.

    Handles BOM and CRLF. Raises ValueError on missing/malformed frontmatter.
    Nested YAML structures are rejected: skills only declare scalars here.
    """
    cleaned = text.lstrip("﻿").lstrip("\ufeff")
    match = FRONTMATTER_PATTERN.match(cleaned)
    if not match:
        raise ValueError("frontmatter delimiters (--- ... ---) not found")
    try:
        loaded = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise ValueError(f"malformed frontmatter YAML: {exc}") from exc
    if not isinstance(loaded, dict):
        raise ValueError("frontmatter must be a mapping")
    scalars: dict[str, str] = {}
    for key, value in loaded.items():
        if isinstance(value, bool):
            scalars[str(key)] = "true" if value else "false"
        elif isinstance(value, (int, float)):
            scalars[str(key)] = str(value)
        elif isinstance(value, str):
            scalars[str(key)] = value.strip()
        else:
            scalars[str(key)] = "" if value is None else str(value)
    return scalars


@dataclass(frozen=True, slots=True)
class SkillEntry:
    id: str  # canonical "<root_id>:<normalized-name>"
    root_id: str
    name: str
    description: str
    dir_path: str  # absolute, posix separators
    file_path: str  # absolute SKILL.md path, posix separators


@dataclass(slots=True)
class RootScanState:
    root_id: str
    path: str
    enabled: bool
    state: str = "ok"  # ok | disabled | missing | error
    message: str | None = None
    skill_count: int = 0


@dataclass(slots=True)
class ScanResult:
    entries: list[SkillEntry] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    roots: list[RootScanState] = field(default_factory=list)


@dataclass(slots=True)
class RunResourceBudget:
    """Per-run cap on total bytes shipped to the model.

    Two instances exist per run: the skill-resource sub-budget (default) and
    the shared run-context budget constructed with an explicit limit.
    """

    remaining_bytes: int = MAX_RUN_RESOURCE_BUDGET_BYTES

    def consume(self, size: int) -> None:
        if size > self.remaining_bytes:
            raise SkillError(
                f"resource budget exhausted "
                f"(limit {self.remaining_bytes + size} bytes per run)"
            )
        self.remaining_bytes -= size

    def try_consume(self, size: int) -> bool:
        """Non-raising variant used by the shared run-context budget."""
        if size > self.remaining_bytes:
            return False
        self.remaining_bytes -= size
        return True


def _safe_child(root: Path, child: Path) -> Path | None:
    """Return the resolved child when it stays inside the resolved root."""
    try:
        resolved_root = root.resolve()
        resolved_child = child.resolve()
    except OSError:
        return None
    if not _is_within(resolved_child, resolved_root):
        return None
    return resolved_child


class SkillRegistry:
    """Discovers SKILL.md packages and serves bounded reads."""

    def __init__(self, vault_path: Path) -> None:
        self.vault_path = vault_path
        self._scan = ScanResult()
        self._by_id: dict[str, SkillEntry] = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def refresh(
        self,
        *,
        user_roots: list[tuple[str, str, bool]] | None = None,
        enabled_skills: set[str] | None = None,
    ) -> ScanResult:
        """Rescan all configured roots.

        ``user_roots`` carries ``(id, path, enabled)`` triples from settings;
        project-local default roots are always scanned but their skills only
        enter the catalog when the corresponding root is enabled there too.
        ``enabled_skills`` is the catalog allowlist of canonical skill ids:
        ``None`` keeps every discovered skill active (registry-level default),
        an empty set means "no active skills", and any listed-but-missing id
        is simply ignored until it appears.
        """
        scan = ScanResult()
        by_id: dict[str, SkillEntry] = {}
        name_owners: dict[str, list[str]] = {}

        def scan_root(root_id: str, root_dir: Path, enabled: bool) -> None:
            state = RootScanState(
                root_id=root_id, path=root_dir.as_posix(), enabled=enabled
            )
            scan.roots.append(state)
            if not enabled:
                state.state = "disabled"
                return
            if not root_dir.is_dir():
                state.state = "missing"
                state.message = "directory does not exist"
                return
            try:
                candidates = sorted(
                    p for p in root_dir.iterdir() if (p / "SKILL.md").is_file()
                )
            except OSError as exc:
                state.state = "error"
                state.message = f"scan failed: {type(exc).__name__}: {exc}"
                return
            if len(candidates) > MAX_SKILLS_PER_ROOT:
                scan.problems.append(
                    f"skill root {root_id}: more than {MAX_SKILLS_PER_ROOT} "
                    "skills; excess ignored"
                )
                candidates = candidates[:MAX_SKILLS_PER_ROOT]
            for skill_dir in candidates:
                safe_dir = _safe_child(root_dir, skill_dir)
                if safe_dir is None or not _safe_child(
                    root_dir, safe_dir / "SKILL.md"
                ):
                    scan.problems.append(
                        f"skill at {skill_dir.name} skipped: path escapes its root"
                    )
                    continue
                entry_or_error = self._load_entry(
                    root_id, safe_dir, safe_dir / "SKILL.md"
                )
                if isinstance(entry_or_error, str):
                    scan.problems.append(entry_or_error)
                    continue
                entry = entry_or_error
                state.skill_count += 1
                if len(by_id) >= MAX_ACTIVE_SKILLS:
                    scan.problems.append(
                        f"active skill limit ({MAX_ACTIVE_SKILLS}) reached; "
                        f"'{entry.name}' ignored"
                    )
                    state.skill_count -= 1
                    continue
                if entry.id in by_id:
                    # Case-insensitive Windows path collision on the same
                    # canonical id: keep the first (lexically sorted) skill.
                    continue
                by_id[entry.id] = entry
                name_owners.setdefault(normalize_name(entry.name), []).append(
                    entry.id
                )

        # Project-local default roots are enabled when an enabled user root
        # resolves to the same directory; otherwise they are discovered but
        # disabled so the settings UI can offer them.
        enabled_dirs: set[Path] = set()
        for _rid, raw_path, is_enabled in user_roots or []:
            if not is_enabled:
                continue
            resolved = _resolve_root(self.vault_path, raw_path)
            if resolved is not None:
                enabled_dirs.add(resolved)
        for dirname in DEFAULT_ROOT_DIRS:
            root_dir = self.vault_path / dirname / "skills"
            root_id = f"project:{dirname}"
            resolved = root_dir.resolve() if root_dir.exists() else root_dir
            scan_root(root_id, root_dir, resolved in enabled_dirs)

        for rid, raw_path, is_enabled in user_roots or []:
            if rid.startswith("project:"):
                continue
            resolved = _resolve_root(self.vault_path, raw_path)
            if resolved is None:
                state = RootScanState(
                    root_id=rid,
                    path=raw_path,
                    enabled=is_enabled,
                    state="disabled" if not is_enabled else "error",
                )
                if is_enabled:
                    state.message = "path escapes the vault or does not exist"
                scan.roots.append(state)
                continue
            already_scanned = any(
                r.root_id == rid and r.path == resolved.as_posix()
                for r in scan.roots
            )
            if not already_scanned:
                scan_root(rid, resolved, is_enabled)

        for normalized, owners in sorted(name_owners.items()):
            if len(owners) > 1:
                scan.conflicts.append(
                    f"duplicate skill name '{normalized}': {', '.join(sorted(owners))}"
                )

        scan.entries = list(by_id.values())
        # The catalog the model can see is the allowlist intersection, not
        # raw discovery: unselected skills never reach catalog_lines,
        # skill_load, or read_resource.
        if enabled_skills is None:
            self._by_id = by_id
        else:
            allowed = {str(item) for item in enabled_skills}
            self._by_id = {
                skill_id: entry
                for skill_id, entry in by_id.items()
                if skill_id in allowed
            }
        self._scan = scan
        return scan

    def _load_entry(
        self, root_id: str, skill_dir: Path, skill_md: Path
    ) -> SkillEntry | str:
        try:
            raw_size = skill_md.stat().st_size
        except OSError as exc:
            return f"skill {skill_md.as_posix()}: unreadable ({exc})"
        if raw_size > MAX_SKILL_MD_BYTES:
            return (
                f"skill {skill_md.as_posix()}: SKILL.md exceeds "
                f"{MAX_SKILL_MD_BYTES} bytes"
            )
        try:
            text = skill_md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            return f"skill {skill_md.as_posix()}: unreadable ({exc})"
        try:
            meta = parse_frontmatter(text)
        except ValueError as exc:
            return f"skill {skill_md.as_posix()}: {exc}"
        name = meta.get("name", "").strip()
        if not name:
            return f"skill {skill_md.as_posix()}: frontmatter 'name' missing"
        if len(name) > 128:
            return f"skill {skill_md.as_posix()}: name longer than 128 characters"
        description = meta.get("description", "").strip().replace("\n", " ")
        if len(description) > MAX_DESCRIPTION_CHARS:
            description = description[:MAX_DESCRIPTION_CHARS]
        return SkillEntry(
            id=f"{root_id}:{normalize_name(name)}",
            root_id=root_id,
            name=name,
            description=description,
            dir_path=skill_dir.resolve().as_posix(),
            file_path=skill_md.resolve().as_posix(),
        )

    # ------------------------------------------------------------------
    # Catalog access
    # ------------------------------------------------------------------

    @property
    def problems(self) -> list[str]:
        return list(self._scan.problems)

    @property
    def conflicts(self) -> list[str]:
        return list(self._scan.conflicts)

    @property
    def roots(self) -> list[RootScanState]:
        return list(self._scan.roots)

    def get(self, skill_id: str) -> SkillEntry | None:
        return self._by_id.get(skill_id)

    def catalog_entries(self) -> list[SkillEntry]:
        return list(self._by_id.values())

    def catalog_lines(self) -> list[str]:
        lines = []
        for entry in self._by_id.values():
            description = entry.description or "(no description)"
            lines.append(f"- {entry.id} :: {entry.name} :: {description}")
        return lines

    def status(self) -> dict[str, object]:
        return {
            "roots": [
                {
                    "id": root.root_id,
                    "path": root.path,
                    "enabled": root.enabled,
                    "state": root.state,
                    "message": root.message,
                    "skills": root.skill_count,
                }
                for root in self._scan.roots
            ],
            "skills": [
                {
                    "id": entry.id,
                    "name": entry.name,
                    "description": entry.description,
                    "path": entry.file_path,
                }
                for entry in self._by_id.values()
            ],
            "problems": list(self._scan.problems),
            "conflicts": list(self._scan.conflicts),
            "active_count": len(self._by_id),
            "catalog_chars": sum(len(line) + 1 for line in self.catalog_lines()),
        }

    # ------------------------------------------------------------------
    # Progressive loading
    # ------------------------------------------------------------------

    def load_body(self, skill_id: str) -> str:
        entry = self._require(skill_id)
        path = Path(entry.file_path)
        try:
            if path.stat().st_size > MAX_SKILL_MD_BYTES:
                raise SkillError(
                    f"SKILL.md exceeds {MAX_SKILL_MD_BYTES} bytes"
                )
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise SkillError(f"cannot read skill body: {exc}") from exc
        return text

    def read_resource(
        self, skill_id: str, relative_path: str, budget: RunResourceBudget
    ) -> str:
        entry = self._require(skill_id)
        cleaned = (relative_path or "").replace("\\", "/").strip()
        if (
            not cleaned
            or cleaned.startswith("/")
            or Path(cleaned).is_absolute()
            or ".." in cleaned.split("/")
        ):
            raise SkillError(
                "resource path must be relative to the skill folder"
            )
        base = Path(entry.dir_path)
        target = base / cleaned
        safe_target = _safe_child(base, target)
        if safe_target is None or not safe_target.is_relative_to(base):
            raise SkillError("resource path escapes the skill folder")
        lowered_name = safe_target.name.lower()
        if (
            lowered_name.endswith(tuple(SECRET_SUFFIXES))
            or lowered_name in SECRET_BASENAMES
            or lowered_name.startswith(".env")
        ):
            raise SkillError(
                f"resource '{safe_target.name}' looks like a credential and is blocked"
            )
        if lowered_name.startswith(".") and any(
            marker in lowered_name
            for marker in ("secret", "credential", "passwd", "password", "token")
        ):
            raise SkillError(
                f"resource '{safe_target.name}' looks like a credential and is blocked"
            )
        if not safe_target.is_file():
            raise SkillError(f"resource not found: {cleaned}")
        size = safe_target.stat().st_size
        if size > MAX_RESOURCE_FILE_BYTES:
            raise SkillError(
                f"resource exceeds {MAX_RESOURCE_FILE_BYTES} bytes per file"
            )
        budget.consume(size)
        try:
            return safe_target.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise SkillError(f"resource is not UTF-8 text: {cleaned}") from exc
        except OSError as exc:
            raise SkillError(f"cannot read resource: {exc}") from exc

    def _require(self, skill_id: str) -> SkillEntry:
        entry = self._by_id.get(skill_id)
        if entry is None:
            known = ", ".join(sorted(self._by_id)) or "(none)"
            raise SkillError(f"unknown skill '{skill_id}'. Known skills: {known}")
        return entry
