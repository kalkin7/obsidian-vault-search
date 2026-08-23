"""Tool registry for the structured agent run (plan §9.2, §9.3).

Owns three concerns:
- built-in tool definitions (vault search/read/grep + skill loading),
- the ``mcp__<server>__<tool>`` alias namespace and its immutable mapping,
- defensive validation of provider tool schemas / model arguments and
  normalization of MCP results into bounded text.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from .llm import ToolDefinition

MAX_TOOL_NAME_CHARS = 64
MAX_SCHEMA_BYTES = 64 * 1024
MAX_SCHEMA_DEPTH = 20
MAX_ARGUMENT_BYTES = 64 * 1024
MAX_RESULT_CHARS = 32_000
# Provider-facing tool surface bounds (fix §6): a hostile or misconfigured
# server advertising thousands of tools must not blow up the request payload.
# The cap is applied deterministically (sorted alias order) and the excess is
# reported, never silently dropped.
MAX_PROVIDER_TOOLS = 100
MAX_TOTAL_SCHEMA_BYTES = 256 * 1024
# Per-run context budget shared by vault sources, MCP results, and loaded
# skill bodies/resources (fix §6). Exceeding it yields coded tool errors.
MAX_RUN_CONTEXT_BUDGET_BYTES = 512 * 1024

SAFE_NAME_PATTERN = re.compile(r"[^A-Za-z0-9_]")
TRUNCATION_MARKER = "\n…[truncated]"

BUILTIN_SEARCH_NAME = "vault_search"
BUILTIN_READ_NAME = "vault_read"
BUILTIN_GREP_NAME = "vault_grep"
BUILTIN_SKILL_LOAD_NAME = "skill_load"
BUILTIN_SKILL_RESOURCE_NAME = "skill_read_resource"

BUILTIN_TOOL_NAMES = (
    BUILTIN_SEARCH_NAME,
    BUILTIN_READ_NAME,
    BUILTIN_GREP_NAME,
    BUILTIN_SKILL_LOAD_NAME,
    BUILTIN_SKILL_RESOURCE_NAME,
)

BUILTIN_TOOL_NAMES_SET = frozenset(BUILTIN_TOOL_NAMES)


def builtin_tool_definitions(*, has_skills: bool) -> list[ToolDefinition]:
    """Definitions for the built-in vault/skill tools."""
    tools = [
        ToolDefinition(
            name=BUILTIN_SEARCH_NAME,
            description=(
                "Hybrid (keyword+semantic) search over the Obsidian vault. "
                "Returns ranked snippets with [S#] source ids."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"],
            },
        ),
        ToolDefinition(
            name=BUILTIN_READ_NAME,
            description=(
                "Read a full file from the vault by its relative path."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "file": {
                        "type": "string",
                        "description": "Vault-relative file path",
                    }
                },
                "required": ["file"],
            },
        ),
        ToolDefinition(
            name=BUILTIN_GREP_NAME,
            description=(
                "Regex scan across vault files. Use only to verify an exact "
                "known string or find scattered occurrences."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regex pattern"},
                    "glob": {
                        "type": "string",
                        "description": 'File glob, e.g. "**/*.md"',
                    },
                },
                "required": ["pattern"],
            },
        ),
    ]
    if has_skills:
        tools.extend(
            [
                ToolDefinition(
                    name=BUILTIN_SKILL_LOAD_NAME,
                    description=(
                        "Load a skill's full instructions by its catalog id "
                        "(e.g. 'project:.claude/my-skill')."
                    ),
                    input_schema={
                        "type": "object",
                        "properties": {
                            "skill_id": {"type": "string"},
                        },
                        "required": ["skill_id"],
                    },
                ),
                ToolDefinition(
                    name=BUILTIN_SKILL_RESOURCE_NAME,
                    description=(
                        "Read a text reference file inside a loaded skill's "
                        "folder (relative path only)."
                    ),
                    input_schema={
                        "type": "object",
                        "properties": {
                            "skill_id": {"type": "string"},
                            "relative_path": {"type": "string"},
                        },
                        "required": ["skill_id", "relative_path"],
                    },
                ),
            ]
        )
    return tools


# ---------------------------------------------------------------------------
# MCP aliasing
# ---------------------------------------------------------------------------


def safe_name_part(value: str) -> str:
    cleaned = SAFE_NAME_PATTERN.sub("_", value.strip())
    return cleaned.strip("_")[:32] or "x"


class ToolAliasMap:
    """Immutable per-run mapping between provider-facing tool names and
    ``(server_id, original_tool_name)`` pairs."""

    def __init__(self) -> None:
        self._by_alias: dict[str, tuple[str, str]] = {}
        self._by_key: dict[tuple[str, str], str] = {}

    @staticmethod
    def _base_alias(server_name: str, tool_name: str) -> str:
        base = f"mcp__{safe_name_part(server_name)}__{safe_name_part(tool_name)}"
        return base[: MAX_TOOL_NAME_CHARS - 9]

    @staticmethod
    def _collision_suffix(server_id: str, tool_name: str) -> str:
        raw = f"{server_id}\x00{tool_name}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:8]

    def register(self, server_id: str, server_name: str, tool_name: str) -> str:
        alias = self._base_alias(server_name, tool_name)
        if alias in self._by_alias:
            alias = (
                f"{alias}_{self._collision_suffix(server_id, tool_name)}"
            )[:MAX_TOOL_NAME_CHARS]
        # Guarantee global uniqueness even after truncation.
        unique = alias
        counter = 1
        while unique in self._by_alias or unique in BUILTIN_TOOL_NAMES:
            suffix = f"_{self._collision_suffix(server_id, tool_name)[:4]}{counter}"
            unique = f"{alias[: MAX_TOOL_NAME_CHARS - len(suffix)]}{suffix}"
            counter += 1
        self._by_alias[unique] = (server_id, tool_name)
        self._by_key[(server_id, tool_name)] = unique
        return unique

    def resolve(self, alias: str) -> tuple[str, str] | None:
        return self._by_alias.get(alias)

    def alias_for(self, server_id: str, tool_name: str) -> str | None:
        return self._by_key.get((server_id, tool_name))

    def aliases(self) -> dict[str, tuple[str, str]]:
        return dict(self._by_alias)

    def __len__(self) -> int:
        return len(self._by_alias)


# ---------------------------------------------------------------------------
# Schema / argument validation
# ---------------------------------------------------------------------------


def _json_depth(value: Any, depth: int = 0) -> int:
    if depth > MAX_SCHEMA_DEPTH:
        return depth
    if isinstance(value, dict):
        return max([depth] + [_json_depth(v, depth + 1) for v in value.values()])
    if isinstance(value, list):
        return max([depth] + [_json_depth(v, depth + 1) for v in value])
    return depth


def validate_input_schema(schema: Any) -> dict[str, Any]:
    """Validate an MCP ``inputSchema`` before exposing it to the provider.

    Returns the normalized schema. Raises ValueError when unusable so the
    offending tool is isolated instead of breaking the request.
    """
    if not isinstance(schema, dict):
        raise ValueError("input schema must be an object")
    try:
        size = len(json.dumps(schema, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"input schema is not JSON-serializable: {exc}") from exc
    if size > MAX_SCHEMA_BYTES:
        raise ValueError("input schema exceeds 64 KiB")
    if _json_depth(schema) > MAX_SCHEMA_DEPTH:
        raise ValueError("input schema nesting exceeds 20 levels")
    normalized = dict(schema)
    if normalized.get("type") != "object":
        normalized["type"] = "object"
    properties = normalized.get("properties")
    if not isinstance(properties, dict):
        normalized["properties"] = {}
    return normalized


_TYPE_CHECKS: dict[str, Any] = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "null": lambda v: v is None,
}


def _validate_value(value: Any, schema: dict[str, Any], depth: int) -> str | None:
    if depth > MAX_SCHEMA_DEPTH:
        return "value nesting too deep"
    expected_type = schema.get("type")
    if isinstance(expected_type, str):
        check = _TYPE_CHECKS.get(expected_type)
        if check is not None and not check(value):
            return f"expected {expected_type}"
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        return "value not in enum"
    if isinstance(value, dict):
        properties = schema.get("properties")
        required = schema.get("required")
        if isinstance(required, list):
            for key in required:
                if key not in value:
                    return f"missing required property '{key}'"
        if isinstance(properties, dict):
            for key, subschema in properties.items():
                if key in value and isinstance(subschema, dict):
                    problem = _validate_value(value[key], subschema, depth + 1)
                    if problem:
                        return f"'{key}': {problem}"
    if isinstance(value, list):
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(value):
                problem = _validate_value(item, items, depth + 1)
                if problem:
                    return f"[{index}]: {problem}"
    return None


def validate_tool_arguments(alias: str, arguments: Any) -> dict[str, Any]:
    """Validate model-supplied arguments against basic contract bounds."""
    if arguments is None:
        return {}
    if not isinstance(arguments, dict):
        raise ToolArgumentError(f"{alias}: arguments must be a JSON object")
    try:
        size = len(json.dumps(arguments, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ToolArgumentError(f"{alias}: arguments are not serializable: {exc}")
    if size > MAX_ARGUMENT_BYTES:
        raise ToolArgumentError(f"{alias}: arguments exceed 64 KiB")
    return arguments


def validate_arguments_against_schema(
    arguments: dict[str, Any], schema: dict[str, Any]
) -> str | None:
    """Return a problem string when arguments violate the top-level schema,
    or None when they satisfy it."""
    return _validate_value(arguments, schema, 0)


class ToolArgumentError(Exception):
    pass


# ---------------------------------------------------------------------------
# Result normalization
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class NormalizedToolResult:
    ok: bool
    text: str
    structured: dict[str, Any] | list[Any] | None = None
    truncated: bool = False
    error_code: str | None = None

    def to_model_text(self) -> str:
        parts = [self.text]
        if self.structured is not None:
            try:
                parts.append(
                    "structured content:\n"
                    + json.dumps(self.structured, ensure_ascii=False)[:8000]
                )
            except (TypeError, ValueError):
                pass
        joined = "\n".join(parts)
        if self.truncated and TRUNCATION_MARKER not in joined:
            joined = joined[:MAX_RESULT_CHARS] + TRUNCATION_MARKER
        return joined


def normalize_mcp_result(
    content_blocks: Any,
    *,
    is_error: bool,
    structured_content: dict[str, Any] | list[Any] | None = None,
) -> NormalizedToolResult:
    """Flatten an MCP CallToolResult into bounded text.

    Text blocks concatenate in order; structured content rides along as
    bounded JSON. Image/audio/resource-only results are explicit unsupported
    errors — never silently dropped.
    """
    texts: list[str] = []
    structured: dict[str, Any] | list[Any] | None = (
        structured_content
        if isinstance(structured_content, (dict, list))
        else None
    )
    saw_supported = False
    total = 0
    truncated = False
    if isinstance(content_blocks, list):
        for block in content_blocks:
            kind = getattr(block, "type", None)
            if kind == "text":
                saw_supported = True
                value = getattr(block, "text", "")
                if not isinstance(value, str):
                    continue
                remaining = MAX_RESULT_CHARS - total
                if remaining <= 0:
                    truncated = True
                    break
                if len(value) > remaining:
                    value = value[:remaining]
                    truncated = True
                texts.append(value)
                total += len(value)
    if not saw_supported and structured is None and not texts:
        return NormalizedToolResult(
            ok=False,
            text="",
            error_code="MCP_RESULT_TYPE_UNSUPPORTED",
        )
    text = "\n".join(texts)
    if structured is not None:
        try:
            encoded = json.dumps(structured, ensure_ascii=False)
        except (TypeError, ValueError):
            encoded = ""
        if len(encoded) + len(text) > MAX_RESULT_CHARS:
            keep = max(0, MAX_RESULT_CHARS - len(text))
            try:
                structured = json.loads(encoded[:keep]) if keep else None
            except ValueError:
                structured = None
            truncated = True
    if truncated:
        text = text[: MAX_RESULT_CHARS - len(TRUNCATION_MARKER)]
    if is_error:
        return NormalizedToolResult(
            ok=False,
            text=text,
            structured=structured,
            truncated=truncated,
            error_code="MCP_TOOL_ERROR",
        )
    return NormalizedToolResult(
        ok=True, text=text, structured=structured, truncated=truncated
    )


def tool_error_result(error_code: str, message: str) -> NormalizedToolResult:
    return NormalizedToolResult(ok=False, text=message, error_code=error_code)
