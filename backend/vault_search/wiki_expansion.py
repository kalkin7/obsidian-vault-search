from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

import yaml

from .config import SearchConfig
from .scope import is_in_scope, normalize_relative, resolve_inside_vault

PRESERVE_RESULTS = 30
MAX_WIKI_FILES = 5
MAX_SOURCE_RESULTS = 5
MAX_WIKI_BYTES = 256 * 1024
RELATION_QUERY_RE = re.compile(
    r"(?:전체\s*(?:경과|이력|전말|연결)|공통\s*패턴|(?:사례|사안|문서|이슈|업체|인물|담당자).{0,12}연결)"
)


def _wiki_prefixes(config: SearchConfig) -> tuple[str, ...]:
    """Trailing-slash prefixes for the configured wiki folders."""
    return tuple(f"{folder.rstrip('/')}/" for folder in config.wiki_folders)


def should_expand_wiki_sources(
    query: str, intent: str | None, top_k: int, direct_count: int
) -> bool:
    if direct_count == 0 or (direct_count >= top_k and top_k <= PRESERVE_RESULTS):
        return False
    if intent is not None:
        return intent == "timeline"
    return RELATION_QUERY_RE.search(query) is not None


def expand_wiki_sources(
    connection: sqlite3.Connection,
    config: SearchConfig,
    direct: list[dict[str, Any]],
    query: str,
    intent: str | None,
    top_k: int,
    verbose: bool,
    query_tokens: list[str],
    match_mode: str,
) -> list[dict[str, Any]]:
    if not should_expand_wiki_sources(query, intent, top_k, len(direct)):
        return direct

    wiki_paths = [
        str(item["file_path"])
        for item in direct[:PRESERVE_RESULTS]
        if str(item["file_path"]).startswith(_wiki_prefixes(config))
    ][:MAX_WIKI_FILES]
    if not wiki_paths:
        return direct

    direct_paths = {str(item["file_path"]) for item in direct}
    candidates: list[tuple[str, str]] = []
    seen: set[str] = set()
    for wiki_path in wiki_paths:
        for source in _read_sources(config, wiki_path):
            if source in direct_paths or source in seen:
                continue
            seen.add(source)
            candidates.append((source, wiki_path))
            if len(candidates) >= MAX_SOURCE_RESULTS:
                break
        if len(candidates) >= MAX_SOURCE_RESULTS:
            break
    if not candidates:
        return direct

    source_rows = _source_rows(connection, [path for path, _wiki in candidates])
    expanded: list[dict[str, Any]] = []
    for source, wiki_path in candidates:
        row = source_rows.get(source)
        if row is None:
            continue
        content, heading_path, start_line = row
        entry: dict[str, Any] = {
            "rank": 0,
            "file_path": source,
            "score": 0.0,
            "content": content,
            "heading_path": heading_path,
            "start_line": start_line,
            "expanded": True,
            "source": "wiki_sources",
            "linked_from": wiki_path,
        }
        if verbose:
            entry.update(
                {
                    "channels": ["wiki_sources"],
                    "query_tokens": query_tokens,
                    "match_mode": match_mode,
                    "bm25_rank": -1,
                    "body_rank": -1,
                    "heading_rank": -1,
                    "file_rank": -1,
                    "vector_rank": -1,
                    "title_rank": -1,
                    "rrf_contributions": {},
                }
            )
        expanded.append(entry)

    if not expanded:
        return direct
    insertion = min(PRESERVE_RESULTS, len(direct))
    merged = [*direct[:insertion], *expanded, *direct[insertion:]]
    merged = merged[:top_k]
    tail_score = min(item["score"] for item in direct[:insertion])
    for rank, item in enumerate(merged, 1):
        item["rank"] = rank
        if item.get("expanded"):
            item["score"] = round(tail_score - rank / 1_000_000, 6)
    return merged


def _read_sources(config: SearchConfig, wiki_path: str) -> list[str]:
    try:
        target = resolve_inside_vault(config.vault_path, wiki_path)
        before = target.stat()
        if before.st_size > MAX_WIKI_BYTES:
            return []
        text = target.read_text(encoding="utf-8")
        after = target.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            return []
    except (OSError, UnicodeError, ValueError):
        return []
    lines = text.removeprefix("\ufeff").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return []
    end = next(
        (
            index
            for index, line in enumerate(lines[1:], 1)
            if line.strip() in {"---", "..."}
        ),
        None,
    )
    if end is None:
        return []
    try:
        metadata = yaml.safe_load("".join(lines[1:end]))
    except yaml.YAMLError:
        return []
    if not isinstance(metadata, dict):
        return []
    raw = metadata.get("sources")
    values = raw if isinstance(raw, list) else [raw]
    sources: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        try:
            relative = normalize_relative(value)
            if not is_in_scope(relative, config.include_globs, config.exclude_globs):
                continue
            resolved = resolve_inside_vault(config.vault_path, relative)
            if not resolved.is_file():
                continue
        except (OSError, ValueError):
            continue
        if relative not in sources:
            sources.append(relative)
    return sources


def _source_rows(
    connection: sqlite3.Connection, paths: list[str]
) -> dict[str, tuple[str, list[str], int]]:
    if not paths:
        return {}
    placeholders = ",".join("?" for _ in paths)
    rows = connection.execute(
        f"SELECT file_path, content, heading_path, start_line FROM chunks "
        f"WHERE file_path IN ({placeholders}) ORDER BY file_path, chunk_index",
        paths,
    ).fetchall()
    result: dict[str, tuple[str, list[str], int]] = {}
    for file_path, content, heading_path, start_line in rows:
        path = str(file_path)
        try:
            heading = json.loads(str(heading_path))
        except ValueError:
            heading = []
        result.setdefault(path, (str(content), heading, start_line))
    return result
