from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import yaml

from .tokenizer import tokenize

LOGGER = logging.getLogger(__name__)
INLINE_TAG_RE = re.compile(r"(?<![\w/])#([^\s#]+)", re.UNICODE)
MACHINERY_KEYS = {"cssclass", "cssclasses", "icon", "banner", "banner_y", "position"}
PROPERTY_FILE_LIMIT = 12_000
PROPERTY_VALUE_LIMIT = 2_000
PROPERTY_MAX_DEPTH = 5
METADATA_FIELD_LIMIT = 12_000
METADATA_ITEM_LIMIT = 256


@dataclass(frozen=True, slots=True)
class FileFields:
    basename: list[str]
    directory: list[str]
    aliases: list[str]
    tags: list[str]
    properties: list[str]


def extract_file_fields(file_path: str, text: str, kiwi: Any) -> FileFields:
    path = PurePosixPath(file_path)
    basename = path.stem.replace("_", " ").replace("-", " ")
    directory = " ".join(
        part.replace("_", " ").replace("-", " ") for part in path.parent.parts)
    metadata, body = _frontmatter(file_path, text)
    aliases: list[str] = []
    tags: list[str] = []
    for key, value in metadata.items():
        lowered = str(key).casefold()
        if lowered in {"alias", "aliases"}:
            aliases.extend(_scalar_values(value))
        if lowered in {"tag", "tags"}:
            tags.extend(_scalar_values(value))
    tags.extend(match.group(1) for match in INLINE_TAG_RE.finditer(body))
    aliases = _bounded_dedupe(aliases)
    tags = _bounded_dedupe(value.lstrip("#") for value in tags if value.lstrip("#"))
    properties = _property_text(metadata)
    return FileFields(
        tokenize(basename, kiwi),
        tokenize(directory, kiwi),
        tokenize(" ".join(aliases), kiwi),
        tokenize(" ".join(tags), kiwi),
        tokenize(properties, kiwi),
    )


def heading_tokens(heading_path: tuple[str, ...], kiwi: Any) -> list[str]:
    return tokenize(" ".join(heading_path), kiwi)


def _frontmatter(file_path: str, text: str) -> tuple[dict[Any, Any], str]:
    lines = text.removeprefix("\ufeff").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, text
    end = next((index for index, line in enumerate(lines[1:], 1)
                if line.strip() in {"---", "..."}), None)
    if end is None:
        return {}, text
    try:
        loaded = yaml.safe_load("".join(lines[1:end]))
    except yaml.YAMLError:
        LOGGER.warning("Could not parse YAML frontmatter: %s", file_path)
        return {}, "".join(lines[end + 1:])
    return (loaded if isinstance(loaded, dict) else {}), "".join(lines[end + 1:])


def _scalar_values(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [str(item)[:PROPERTY_VALUE_LIMIT] for item in values
            if isinstance(item, (str, int, float, bool))]


def _bounded_dedupe(values: Any) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    total = 0
    for value in values:
        text = str(value).strip()[:PROPERTY_VALUE_LIMIT]
        folded = text.casefold()
        if text and folded not in seen:
            added = len(text) + int(bool(result))
            if len(result) >= METADATA_ITEM_LIMIT or total + added > METADATA_FIELD_LIMIT:
                break
            seen.add(folded)
            result.append(text)
            total += added
    return result


def _property_text(metadata: dict[Any, Any]) -> str:
    parts: list[str] = []
    seen: set[int] = set()

    def visit(key: str, value: Any, depth: int) -> None:
        if depth > PROPERTY_MAX_DEPTH or sum(len(part) + 1 for part in parts) >= PROPERTY_FILE_LIMIT:
            return
        if key.casefold() in MACHINERY_KEYS:
            return
        if isinstance(value, (dict, list)):
            identity = id(value)
            if identity in seen:
                return
            seen.add(identity)
            if depth >= PROPERTY_MAX_DEPTH:
                return
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                child = str(child_key)
                if child.casefold() in MACHINERY_KEYS:
                    continue
                parts.append(child[:PROPERTY_VALUE_LIMIT])
                visit(child, child_value, depth + 1)
        elif isinstance(value, list):
            for item in value:
                visit(key, item, depth + 1)
        elif isinstance(value, (str, int, float, bool)):
            parts.append(str(value)[:PROPERTY_VALUE_LIMIT])

    for raw_key, raw_value in metadata.items():
        key = str(raw_key)
        if key.casefold() in MACHINERY_KEYS:
            continue
        parts.append(key[:PROPERTY_VALUE_LIMIT])
        visit(key, raw_value, 1)
    return " ".join(parts)[:PROPERTY_FILE_LIMIT]
