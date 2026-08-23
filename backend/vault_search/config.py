from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_INCLUDES = ["**/*.md"]
DEFAULT_EXCLUDES = [".obsidian/**", "**/node_modules/**"]
DEFAULT_WIKI_FOLDERS = ["5_Wiki/issues", "5_Wiki/entities", "5_Wiki/decisions"]

# Agent-extension bounds (plan §6.3). A malformed single entry must never
# prevent the search service from starting: invalid items are dropped and
# reported through SearchConfig.config_problems instead.
MAX_PROJECT_RULES_CHARS = 32_000
MAX_MCP_SERVERS = 20
MAX_MCP_ARGS = 64
MAX_MCP_ARG_CHARS = 2_048
MAX_MCP_URL_CHARS = 2_048
MAX_TOOL_POLICIES_PER_SERVER = 500
MAX_SKILL_ROOTS = 20
MAX_ENV_NAMES_PER_SERVER = 32
MAX_ENV_NAME_CHARS = 128
MCP_SERVER_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")
ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def has_control_chars(value: str) -> bool:
    return bool(_CONTROL_CHARS.search(value))


@dataclass(slots=True)
class McpServerConfig:
    id: str
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    cwd: str = "vault"  # "vault" | "plugin" | absolute directory
    env_names: list[str] = field(default_factory=list)
    tool_policies: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    transport: str = "stdio"  # "stdio" | "http"
    url: str = ""  # streamable-HTTP endpoint; stdio servers ignore this


@dataclass(slots=True)
class SkillRootConfig:
    id: str
    path: str  # vault-relative preferred; explicit absolute allowed
    enabled: bool = True


@dataclass(slots=True)
class SearchConfig:
    vault_path: Path
    data_dir: Path
    model_id: str = "intfloat/multilingual-e5-base"
    model_profile: str = "multilingual-e5-base"
    engine: str = "pytorch"
    device: str = "auto"
    provider: str = "auto"
    query_prefix: str = "query: "
    document_prefix: str = "passage: "
    normalize_embeddings: bool = True
    include_globs: list[str] = field(default_factory=lambda: list(DEFAULT_INCLUDES))
    exclude_globs: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    wiki_folders: list[str] = field(default_factory=lambda: list(DEFAULT_WIKI_FOLDERS))
    chunk_chars: int = 400
    chunk_overlap: int = 60
    chunking_strategy: str = "paragraph-v1"
    bm25_top_k: int = 80
    vector_top_k: int = 80
    final_top_k: int = 40
    rrf_k: int = 60
    max_chunks_per_file: int = 1
    title_rrf_weight: float = 1.0
    prefix_fallback: bool = True
    embedding_batch_size_cpu: int = 32
    embedding_batch_size_gpu: int = 64
    lazy_model: bool = False
    model_idle_timeout_seconds: float = 300.0
    heartbeat_timeout_seconds: float = 20.0
    llm_provider: str = "openai"
    llm_model: str = "gpt-5.6"
    reasoning_effort: str = ""
    llm_max_context_chars: int = 24000
    llm_max_output_tokens: int = 4000
    llm_timeout_seconds: float = 45.0
    # --- API agent extensions (MCP / skills / project rules) ---
    project_rules: str = ""
    mcp_enabled: bool = False
    mcp_servers: list[McpServerConfig] = field(default_factory=list)
    skills_enabled: bool = False
    skill_roots: list[SkillRootConfig] = field(default_factory=list)
    enabled_skills: set[str] = field(default_factory=set)
    plugin_path: Path | None = None
    # Human-readable problems for dropped/isolated config entries (never fatal).
    config_problems: list[str] = field(default_factory=list)

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def db_path(self) -> Path:
        return self.index_dir / "chunks.db"

    @property
    def vector_path(self) -> Path:
        return self.index_dir / "vectors.usearch"

    @property
    def metadata_path(self) -> Path:
        return self.index_dir / "metadata.json"

    @property
    def runtime_path(self) -> Path:
        return self.data_dir / "runtime.json"

    @property
    def log_path(self) -> Path:
        return self.data_dir / "backend.log"

    def scope_hash(self) -> str:
        raw = json.dumps(
            {"include": self.include_globs, "exclude": self.exclude_globs},
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _as_nonempty_lines(value: Any, default: list[str]) -> list[str]:
    if isinstance(value, list):
        result = [str(x).strip().replace("\\", "/") for x in value if str(x).strip()]
        return result or list(default)
    if isinstance(value, str):
        result = [x.strip().replace("\\", "/") for x in value.splitlines() if x.strip()]
        return result or list(default)
    return list(default)


def _as_wiki_folders(value: Any) -> list[str]:
    """Parse the wiki folder list; an explicit empty list disables expansion."""
    if value is None:
        return list(DEFAULT_WIKI_FOLDERS)
    raw = value if isinstance(value, list) else [value]
    result = [
        str(x).strip().rstrip("/").replace("\\", "/") for x in raw if str(x).strip()
    ]
    return result


def _as_int(value: Any, default: int) -> int:
    """Parse an int config value, falling back to the default on bad input so a
    corrupt config cannot prevent the service from starting."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


_REASONING_EFFORTS = {"auto", "none", "low", "medium", "high", "xhigh", "max"}


def _as_reasoning_effort(value: Any) -> str:
    """Normalize the answerReasoningEffort setting; unknown values disable
    the override (the provider picks its default)."""
    effort = str(value).strip().lower() if value is not None else ""
    return effort if effort in _REASONING_EFFORTS else ""


def _as_project_rules(value: Any, problems: list[str]) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        problems.append("project rules ignored: not a string")
        return ""
    if has_control_chars(value.replace("\t", "").replace("\n", "").replace("\r", "")):
        problems.append("project rules ignored: control characters")
        return ""
    if len(value) > MAX_PROJECT_RULES_CHARS:
        problems.append(
            f"project rules truncated to {MAX_PROJECT_RULES_CHARS} characters"
        )
        return value[:MAX_PROJECT_RULES_CHARS]
    return value


def _as_mcp_servers(
    raw: Any, plugin_path: Path | None, problems: list[str]
) -> list[McpServerConfig]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        problems.append("MCP servers ignored: expected a list")
        return []
    if len(raw) > MAX_MCP_SERVERS:
        problems.append(
            f"MCP servers beyond {MAX_MCP_SERVERS} entries are dropped"
        )
        raw = raw[:MAX_MCP_SERVERS]
    servers: list[McpServerConfig] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for index, entry in enumerate(raw):
        label = f"MCP server #{index + 1}"
        try:
            if not isinstance(entry, dict):
                raise ValueError("entry must be an object")
            server_id = str(entry.get("id", "")).strip()
            name = str(entry.get("name", "")).strip()
            command = str(entry.get("command", "")).strip()
            if not server_id or len(server_id) > 64:
                raise ValueError("id must be 1-64 characters")
            if has_control_chars(server_id):
                raise ValueError("id contains control characters")
            if not name or len(name) > 64 or not MCP_SERVER_NAME_PATTERN.match(name):
                raise ValueError(
                    "name must be 1-64 characters (letters, numbers, space, ., _, -)"
                )
            if has_control_chars(name):
                raise ValueError("name contains control characters")
            if server_id in seen_ids:
                raise ValueError(f"duplicate server id: {server_id}")
            if name.lower() in seen_names:
                raise ValueError(f"duplicate server name: {name}")
            raw_args = entry.get("args", [])
            if not isinstance(raw_args, list) or len(raw_args) > MAX_MCP_ARGS:
                raise ValueError(f"args must be a list of at most {MAX_MCP_ARGS} items")
            args = [str(a) for a in raw_args]
            if any(len(a) > MAX_MCP_ARG_CHARS for a in args):
                raise ValueError(f"each arg must be at most {MAX_MCP_ARG_CHARS} chars")
            if any(has_control_chars(a) for a in args):
                raise ValueError("args contain control characters")
            cwd_value = str(entry.get("cwd", "vault")).strip() or "vault"
            if cwd_value == "vault":
                cwd = "vault"
            elif cwd_value == "plugin":
                if plugin_path is None or not plugin_path.is_dir():
                    raise ValueError('cwd="plugin" requires a valid plugin path')
                cwd = "plugin"
            else:
                cwd_dir = Path(cwd_value)
                if not cwd_dir.is_absolute():
                    raise ValueError("custom cwd must be an absolute directory")
                if has_control_chars(cwd_value):
                    raise ValueError("cwd contains control characters")
                resolved = Path(str(cwd_value))
                if not (resolved.exists() and resolved.is_dir()):
                    raise ValueError(f"custom cwd does not exist: {cwd_value}")
                cwd = str(resolved)
            env_names_raw = entry.get("envNames", [])
            if not isinstance(env_names_raw, list):
                raise ValueError("envNames must be a list of names")
            if len(env_names_raw) > MAX_ENV_NAMES_PER_SERVER:
                raise ValueError(f"at most {MAX_ENV_NAMES_PER_SERVER} env names")
            env_names: list[str] = []
            for env_name in env_names_raw:
                cleaned = str(env_name).strip()
                if not ENV_NAME_PATTERN.match(cleaned):
                    raise ValueError(f"invalid env name: {cleaned!r}")
                if cleaned in env_names:
                    raise ValueError(f"duplicate env name: {cleaned}")
                env_names.append(cleaned)
            policies_raw = entry.get("toolPolicies", {})
            if not isinstance(policies_raw, dict):
                raise ValueError("toolPolicies must be an object")
            if len(policies_raw) > MAX_TOOL_POLICIES_PER_SERVER:
                raise ValueError(
                    f"at most {MAX_TOOL_POLICIES_PER_SERVER} tool policy entries"
                )
            tool_policies: dict[str, str] = {}
            for tool_name, policy in list(policies_raw.items())[
                :MAX_TOOL_POLICIES_PER_SERVER
            ]:
                tool_key = str(tool_name)[:256]
                if policy in {"deny", "ask", "allow"}:
                    tool_policies[tool_key] = str(policy)
            transport = str(entry.get("transport", "stdio")).lower()
            if transport not in {"stdio", "http"}:
                raise ValueError("transport must be 'stdio' or 'http'")
            url = ""
            if transport == "http":
                url = str(entry.get("url", "")).strip()
                if not url:
                    raise ValueError("url is required for http transport")
                if len(url) > MAX_MCP_URL_CHARS:
                    raise ValueError(
                        f"url must be at most {MAX_MCP_URL_CHARS} chars"
                    )
                if has_control_chars(url):
                    raise ValueError("url contains control characters")
                parsed = urlparse(url)
                if (
                    parsed.scheme not in {"http", "https"}
                    or not parsed.hostname
                    or any(ch.isspace() for ch in url)
                ):
                    raise ValueError(
                        "url must be an absolute http(s) endpoint"
                    )
            else:
                if not command:
                    raise ValueError("command is required")
                if has_control_chars(command):
                    raise ValueError("command contains control characters")
            # Canonicalize: an http server never carries a local command, so a
            # stale value cannot resurrect a child process after edits.
            if transport == "http":
                command = ""
                args = []
            servers.append(
                McpServerConfig(
                    id=server_id,
                    name=name,
                    command=command,
                    args=args,
                    cwd=cwd,
                    env_names=env_names,
                    tool_policies=tool_policies,
                    enabled=bool(entry.get("enabled", True)),
                    transport=transport,
                    url=url,
                )
            )
            seen_ids.add(server_id)
            seen_names.add(name.lower())
        except ValueError as exc:
            problems.append(f"{label} isolated: {exc}")
    return servers


def _as_skill_roots(raw: Any, problems: list[str]) -> list[SkillRootConfig]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        problems.append("skill roots ignored: expected a list")
        return []
    if len(raw) > MAX_SKILL_ROOTS:
        problems.append(f"skill roots beyond {MAX_SKILL_ROOTS} entries are dropped")
        raw = raw[:MAX_SKILL_ROOTS]
    roots: list[SkillRootConfig] = []
    seen_ids: set[str] = set()
    for index, entry in enumerate(raw):
        label = f"skill root #{index + 1}"
        try:
            if not isinstance(entry, dict):
                raise ValueError("entry must be an object")
            root_id = str(entry.get("id", "")).strip()
            path_value = str(entry.get("path", "")).strip().replace("\\", "/")
            if not root_id or len(root_id) > 64:
                raise ValueError("id must be 1-64 characters")
            if root_id in seen_ids:
                raise ValueError(f"duplicate root id: {root_id}")
            if not path_value:
                raise ValueError("path is required")
            if has_control_chars(path_value):
                raise ValueError("path contains control characters")
            roots.append(
                SkillRootConfig(
                    id=root_id,
                    path=path_value,
                    enabled=bool(entry.get("enabled", True)),
                )
            )
            seen_ids.add(root_id)
        except ValueError as exc:
            problems.append(f"{label} isolated: {exc}")
    return roots


def _as_enabled_skills(raw: Any, problems: list[str]) -> set[str]:
    if raw is None:
        return set()
    if not isinstance(raw, list):
        problems.append("enabledSkills ignored: expected a list")
        return set()
    skills: set[str] = set()
    for item in raw[:1000]:
        value = str(item).strip()
        if value:
            skills.add(value[:512])
    return skills


def load_config(
    path: str | Path,
    vault_override: str | None = None,
    data_dir_override: str | None = None,
) -> SearchConfig:
    config_path = Path(path).resolve()
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Cannot read search config {config_path}: {exc}") from exc
    vault_value = vault_override or raw.get("vaultPath") or raw.get("vault_path")
    data_dir_value = data_dir_override or raw.get("dataDir") or raw.get("data_dir")
    if not vault_value:
        raise ValueError("vaultPath is required")
    if not data_dir_value:
        raise ValueError("dataDir is required")
    vault = Path(vault_value).resolve()
    data_dir = Path(data_dir_value).resolve()
    if not vault.is_dir():
        raise ValueError(f"Vault path does not exist: {vault}")

    problems: list[str] = []
    plugin_path_value = raw.get("pluginPath")
    plugin_path: Path | None = None
    if isinstance(plugin_path_value, str) and plugin_path_value.strip():
        candidate = Path(plugin_path_value.strip())
        if candidate.is_dir():
            plugin_path = candidate
        else:
            problems.append("pluginPath ignored: directory does not exist")
    project_rules = _as_project_rules(raw.get("answerProjectRules"), problems)
    mcp_servers = _as_mcp_servers(
        raw.get("mcpServers"), plugin_path, problems
    )
    skill_roots = _as_skill_roots(raw.get("skillRoots"), problems)
    enabled_skills = _as_enabled_skills(raw.get("enabledSkills"), problems)

    profile = str(raw.get("modelProfile", "multilingual-e5-base"))
    model_id = str(raw.get("modelId", "intfloat/multilingual-e5-base"))
    engine = str(raw.get("engine", "pytorch")).lower()
    if engine not in {"pytorch", "onnx"}:
        engine = "pytorch"
    query_prefix = str(
        raw.get("queryPrefix", "query: " if profile == "multilingual-e5-base" else "")
    )
    document_prefix = str(
        raw.get(
            "documentPrefix", "passage: " if profile == "multilingual-e5-base" else ""
        )
    )
    device = str(raw.get("device", "auto")).lower()
    if device not in {"auto", "cpu", "cuda"}:
        device = "auto"
    provider = str(raw.get("provider", "auto")).lower()
    if provider not in {"auto", "cuda", "tensorrt"}:
        provider = "auto"

    cfg = SearchConfig(
        vault_path=vault,
        data_dir=data_dir,
        model_id=model_id,
        model_profile=profile,
        engine=engine,
        device=device,
        provider=provider,
        query_prefix=query_prefix,
        document_prefix=document_prefix,
        normalize_embeddings=bool(raw.get("normalizeEmbeddings", True)),
        include_globs=_as_nonempty_lines(raw.get("includeGlobs"), DEFAULT_INCLUDES),
        exclude_globs=_as_nonempty_lines(raw.get("excludeGlobs"), DEFAULT_EXCLUDES),
        wiki_folders=_as_wiki_folders(raw.get("wikiFolders")),
        chunk_chars=max(100, _as_int(raw.get("chunkChars"), 400)),
        chunk_overlap=max(0, _as_int(raw.get("chunkOverlap"), 60)),
        chunking_strategy=str(raw.get("chunkingStrategy", "paragraph-v1")),
        bm25_top_k=max(1, _as_int(raw.get("bm25TopK"), 80)),
        vector_top_k=max(1, _as_int(raw.get("vectorTopK"), 80)),
        final_top_k=max(1, _as_int(raw.get("finalTopK"), 40)),
        rrf_k=max(1, _as_int(raw.get("rrfK"), 60)),
        max_chunks_per_file=max(1, _as_int(raw.get("maxChunksPerFile"), 1)),
        title_rrf_weight=max(0.0, _as_float(raw.get("titleRrfWeight"), 1.0)),
        prefix_fallback=bool(raw.get("prefixFallback", True)),
        embedding_batch_size_cpu=max(1, _as_int(raw.get("embeddingBatchSizeCpu"), 32)),
        embedding_batch_size_gpu=max(1, _as_int(raw.get("embeddingBatchSizeGpu"), 64)),
        lazy_model=bool(raw.get("lazyModel", raw.get("loadPolicy") == "first-search")),
        model_idle_timeout_seconds=max(
            0.0, _as_float(raw.get("modelIdleTimeoutSeconds"), 300.0)
        ),
        heartbeat_timeout_seconds=max(
            5.0, _as_float(raw.get("heartbeatTimeoutSeconds"), 20.0)
        ),
        llm_provider=str(raw.get("answerProvider", raw.get("llmProvider", "openai")))
        .strip()
        .lower(),
        llm_model=str(raw.get("answerModel", raw.get("llmModel", "gpt-5.6"))).strip()[
            :256
        ],
        reasoning_effort=_as_reasoning_effort(raw.get("answerReasoningEffort")),
        llm_max_context_chars=max(
            8000,
            min(
                32000,
                _as_int(
                    raw.get("answerMaxContextChars", raw.get("llmMaxContextChars")),
                    24000,
                ),
            ),
        ),
        llm_max_output_tokens=max(
            128,
            min(
                8000,
                _as_int(
                    raw.get("answerMaxOutputTokens", raw.get("llmMaxOutputTokens")),
                    4000,
                ),
            ),
        ),
        llm_timeout_seconds=max(
            5.0,
            min(
                60.0,
                _as_float(
                    raw.get("answerTimeoutSeconds", raw.get("llmTimeoutSeconds")), 45.0
                ),
            ),
        ),
        project_rules=project_rules,
        mcp_enabled=bool(raw.get("mcpEnabled", False)),
        mcp_servers=mcp_servers,
        skills_enabled=bool(raw.get("skillsEnabled", False)),
        skill_roots=skill_roots,
        enabled_skills=enabled_skills,
        plugin_path=plugin_path,
        config_problems=problems,
    )
    if cfg.llm_provider not in {"openai", "opencode-go", "deepseek"}:
        cfg.llm_provider = "openai"
    if cfg.chunk_overlap >= cfg.chunk_chars:
        raise ValueError("chunkOverlap must be smaller than chunkChars")
    if cfg.chunking_strategy not in {"paragraph-v1", "markdown-v2"}:
        raise ValueError("chunkingStrategy must be paragraph-v1 or markdown-v2")
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    cfg.index_dir.mkdir(parents=True, exist_ok=True)
    return cfg
