from __future__ import annotations

import contextlib
import fnmatch
import json
import sqlite3
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from .agent_prompt import build_agent_system_prompt
from .agent_run import (
    AgentRunError,
    AgentRunRegistry,
    StructuredAgentRun,
    new_run_state,
)
from .agent_tools import (
    MAX_SCHEMA_BYTES,
    MAX_TOTAL_SCHEMA_BYTES,
    ToolAliasMap,
    ToolDefinition,
    builtin_tool_definitions,
)
from .config import SearchConfig
from .database import index_counts
from .deep_answer import (  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
    DEEP_SYSTEM_PROMPT,
    MIN_DEEP_OUTPUT_TOKENS,
    DeepAnswerEngine,
    grep_vault,
)
from .errors import (
    ServiceError,  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
)
from .grounding import (
    GroundingSource,
    build_grounding_context,
    build_prompt,
    normalize_citations,
)
from .index_metadata import classify_index_problems, load_metadata, validate_index_files
from .indexing import IndexManager
from .kiwi_user_dict import prepare_for_search
from .llm import ProviderError, create_provider
from .mcp_host import SERVER_STATE_CONNECTED, McpHost
from .model_manager import ModelManager
from .protocol import (
    ProtocolError,
    validate_answer_cancel_params,
    validate_answer_continue_params,
    validate_answer_start_params,
    validate_answer_status_params,
    validate_answer_params,
    validate_mcp_secrets_params,
)
from .search import IndexCompatibilityError, SearchEngine
from .skills import SkillRegistry


class SearchService:
    def __init__(
        self, config: SearchConfig, event_sink: Callable[[str, dict[str, Any]], None]
    ):
        self.config = config
        self.event_sink = event_sink
        self.model = ModelManager(config)
        self.kiwi: Any | None = None
        self.index: IndexManager | None = None
        self.search_engine: SearchEngine | None = None
        self.state = "idle" if config.lazy_model else "starting"
        self.error: str | None = None
        self.started_at = time.time()
        self.ready_event = threading.Event()
        self.operation_lock = threading.RLock()
        self.initialization_lock = threading.Lock()
        self.initialization_requested = threading.Event()
        self.last_heartbeat = time.monotonic()
        self.last_activity = time.monotonic()
        self.index_rebuild_reason: str | None = None
        self.pending_recovery_warning: str | None = None
        self.index_validation_state: str = "pending"
        self.index_problems: list[str] = []
        self.recommended_action: str | None = None
        self._cached_counts: dict[str, Any] = {
            "files": 0,
            "chunks": 0,
            "vector_chunks": 0,
        }
        self._last_updated_at: float | None = None
        self._count_available = False
        self._index_operation_active = False
        self._capabilities: dict[str, bool] | None = None
        self._idle_watchdog: threading.Thread | None = None
        if self.config.model_idle_timeout_seconds > 0:
            self._idle_watchdog = threading.Thread(target=self._watchdog, daemon=True)
            self._idle_watchdog.start()
        # --- API agent extensions (MCP / skills / project rules) ---
        # Objects are created lazily-cheap; the MCP event-loop thread only
        # starts when configure_extensions finds an enabled server.
        self.mcp_host = McpHost(config.vault_path, config.plugin_path)
        self.skills = SkillRegistry(config.vault_path)
        self.run_registry = AgentRunRegistry()
        # Last provider-facing tool surface measurement (fix §6 status).
        self._last_tool_surface: dict[str, Any] = {
            "discovered_tools": 0,
            "exposed_mcp_tools": 0,
            "tools_truncated": False,
            "schema_bytes": 0,
            "schema_truncated": False,
        }
        # Cancels that arrive before their run is registered (client-supplied
        # run ids racing answer_start) are parked here and consumed at
        # registration time. Bounded TTL + size.
        self._pending_cancels: dict[str, float] = {}
        self._pending_cancel_lock = threading.RLock()
        self._pending_cancel_ttl = 600.0
        self._pending_cancel_max = 100
        # Terminal results retained for idempotent recovery (C requirement):
        # run_id -> (payload, fingerprint, expiry_monotonic). Bounded TTL + size, LRU on get.
        # Contract: fixed TTL from creation (not sliding on every get for expiry),
        # but LRU recency is updated on get for eviction ordering. The TTL is
        # fixed; get does NOT extend expiry — it only moves recency for max-size
        # eviction. This is documented and tested explicitly.
        self._terminal_runs: dict[str, tuple[dict[str, Any], str, float]] = {}
        self._terminal_lock = threading.RLock()
        self._terminal_ttl_seconds = 600.0
        self._terminal_max_entries = 100
        # Tombstones after TTL/LRU drop: run_id only, no payload. Lets status
        # and start distinguish never-seen (RUN_NOT_FOUND) from expired
        # (RUN_EXPIRED) so a late retry cannot start a second LLM call.
        # Protection policy (issue: capacity must never forget a still-protected
        # id): a bounded ledger of _expired_max_entries run_id -> protected-until
        # (default 4096 — far above the realistic churn inside the 600s
        # protection window). Entries past protection are swept first; entries
        # still inside the window are NEVER evicted — when the ledger is full
        # of protected ids, callers keep the expired terminal entry resident
        # (protection retained) or fail closed. _remember_expired_locked
        # returns False for that case; tests pin the policy.
        self._expired_runs: dict[str, float] = {}
        self._expired_ttl_seconds = 600.0
        self._expired_max_entries = 4096
        # Backward-compat alias used by earlier code paths
        self._completed_runs = self._terminal_runs  # type: ignore
        self._completed_lock = self._terminal_lock  # type: ignore
        self._completed_ttl_seconds = self._terminal_ttl_seconds  # type: ignore
        if config.skills_enabled:
            try:
                self._refresh_skills()
            except Exception as exc:
                self.event_sink(
                    "warning",
                    {"code": "SKILLS_SCAN_FAILED", "message": str(exc)},
                )
        if config.mcp_enabled and any(s.enabled for s in config.mcp_servers):
            self._configure_mcp()
        # Warm the capability cache at startup: runtime_capabilities() imports
        # torch (~1.5 s cold), which would otherwise delay the first status()
        # response past request timeouts. The cost is paid once, before the
        # server accepts requests.
        _ = self.capabilities()

    def _watchdog(self) -> None:
        while True:
            time.sleep(1.0)
            try:
                self._maybe_unload_if_idle()
            except Exception as exc:
                with contextlib.suppress(Exception):
                    self.event_sink(
                        "warning",
                        {
                            "code": "IDLE_UNLOAD_FAILED",
                            "message": f"{type(exc).__name__}: {exc}",
                        },
                    )

    def _maybe_unload_if_idle(self) -> None:
        timeout = self.config.model_idle_timeout_seconds
        if timeout <= 0:
            return
        if self.state not in {"ready", "ready_no_index"}:
            return
        if self.model.model is None:
            return
        if time.monotonic() - self.last_activity <= timeout:
            return
        self._unload_model()

    def _unload_model(self) -> None:
        with self.operation_lock:
            # Re-check under the lock: a long-running search/index operation may
            # have refreshed last_activity or moved state since the watchdog's
            # pre-checks above.
            timeout = self.config.model_idle_timeout_seconds
            if timeout <= 0:
                return
            if self.state not in {"ready", "ready_no_index"}:
                return
            if self.model.model is None:
                return
            if self._index_operation_active:
                return
            if time.monotonic() - self.last_activity <= timeout:
                return
            self.event_sink("model_stage", {"stage": "unloading_model"})
            self.model.release()
            self.search_engine = None
            self.index = None
            self.state = "idle"
            self.last_activity = time.monotonic()
            self.event_sink("state", self.status())
            self.event_sink("model_stage", {"stage": "model_unloaded"})

    def start_initialization(self) -> None:
        with self.initialization_lock:
            if self.state not in {"idle", "starting"}:
                return
            self.state = "loading_model"
            self.initialization_requested.set()
            self.event_sink("state", self.status())

    def initialize(self) -> None:
        try:
            self.event_sink("model_stage", {"stage": "loading_kiwi"})
            from kiwipiepy import Kiwi

            self.kiwi = Kiwi()
            prepare_for_search(self.kiwi, self.config)
            self.event_sink("model_stage", {"stage": "loading_embedding_model"})
            started = time.time()
            self.model.load()
            self.event_sink("model_stage", {"stage": "model_loaded"})
            self.index = IndexManager(
                self.config, self.model, self.kiwi, self._index_event
            )
            self._index_operation_active = True
            try:
                state_schema = self.index.ensure_state_schema()
                lexical = (
                    self.index.ensure_lexical_index()
                    if not state_schema.get("rebuild_required")
                    else {}
                )
                migration = (
                    state_schema if state_schema.get("rebuild_required") else lexical
                )
                self.index_rebuild_reason = (
                    str(migration.get("reason"))
                    if migration.get("rebuild_required")
                    else None
                )
                if self.index_rebuild_reason is None:
                    recovery = self._recover_pending_paths()
                    if recovery.get("rebuild_required"):
                        self.index_rebuild_reason = str(recovery.get("reason"))
                self._refresh_cached_counts()
            finally:
                self._index_operation_active = False
            self.search_engine = SearchEngine(self.config, self.model, self.kiwi)
            self.last_activity = time.monotonic()
            self.state = "ready" if self.config.db_path.exists() else "ready_no_index"
            self.error = None
            self.last_heartbeat = time.monotonic()
            if self.index_rebuild_reason is None:
                self._refresh_index_compatibility()
            else:
                self.index_problems = [self.index_rebuild_reason]
                self.recommended_action = classify_index_problems(
                    [self.index_rebuild_reason]
                )
                self.index_validation_state = "incompatible"
            self.event_sink(
                "ready",
                {
                    **self.status(),
                    "model_load_seconds": round(time.time() - started, 3),
                },
            )
        except Exception as exc:
            self.state = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            self.event_sink("error", self.status())
        finally:
            self.ready_event.set()

    def capabilities(self) -> dict[str, bool]:
        """Execution capabilities of the current managed runtime, cached."""
        if self._capabilities is None:
            base = {
                "onnx_available": False,
                "cuda_available": False,
                "tensorrt_available": False,
                "model_available": False,
                "derived_model_available": False,
            }
            try:
                from .direct_onnx import runtime_capabilities

                base.update(runtime_capabilities())
            except Exception:
                pass
            try:
                from .model_manager import _resolve_model_dir

                model_dir = _resolve_model_dir(self.config.model_id)
            except Exception:
                model_dir = None
            if model_dir is not None:
                base["model_available"] = (model_dir / "tokenizer.json").is_file() and (
                    model_dir / "onnx" / "model.onnx"
                ).is_file()
                base["derived_model_available"] = (
                    model_dir / "onnx" / "model-pooled-normalized.onnx"
                ).is_file()
            self._capabilities = base
        return self._capabilities

    def provision_onnx(self) -> dict[str, Any]:
        """Generate the derived pooled ONNX graph when it is missing."""
        if self.config.engine != "onnx":
            raise ServiceError("INVALID_PARAMS", "provision_onnx requires engine=onnx")
        try:
            from .model_manager import _resolve_model_dir

            model_dir = _resolve_model_dir(self.config.model_id)
        except Exception:
            model_dir = None
        if model_dir is None:
            raise ServiceError(
                "MODEL_NOT_FOUND",
                "e5-base model snapshot is not in the local cache; "
                "download intfloat/multilingual-e5-base first",
            )
        try:
            from .onnx_provision import provision

            path = provision(model_dir)
        except ServiceError:
            raise
        except Exception as exc:
            raise ServiceError(
                "PROVISION_FAILED", f"{type(exc).__name__}: {exc}"
            ) from exc
        self._capabilities = None
        return {"provisioned": True, "path": str(path)}

    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "error": self.error,
            "model_id": self.config.model_id,
            "device": self.model.device,
            "provider": self.config.provider,
            "expected_provider": self.model.expected_provider(),
            "effective_provider": self.model.effective_provider(),
            "dimension": self.model.dimension,
            "uptime_seconds": round(time.time() - self.started_at, 3),
            "pending_recovery_warning": self.pending_recovery_warning,
            "pending_recovery_required": self.pending_recovery_warning is not None,
            "count_available": self._count_available,
            "capabilities": self.capabilities(),
            "index_validation_state": self.index_validation_state,
            "index_rebuild_required": self.index_rebuild_reason is not None,
            "index_problems": self.index_problems,
            "recommended_action": self.recommended_action,
            "agent_tool_surface": dict(self._last_tool_surface),
            "last_updated_at": self._last_updated_at,
            **self._cached_counts,
        }

    def call(self, method: str, params: dict[str, Any]) -> Any:
        if method in {"health", "status"}:
            return self.status()
        if method == "heartbeat":
            self.last_heartbeat = time.monotonic()
            return self.status()
        if method == "load_model":
            self.start_initialization()
            return self.status()
        if method == "provision_onnx":
            return self.provision_onnx()
        if method == "answer":
            try:
                params = validate_answer_params(params)
            except ProtocolError as exc:
                raise ServiceError("ANSWER_INVALID_PARAMS", str(exc)) from exc
        for method_name, validator in (
            ("answer_start", validate_answer_start_params),
            ("answer_continue", validate_answer_continue_params),
            ("answer_cancel", validate_answer_cancel_params),
            ("answer_status", validate_answer_status_params),
            ("set_mcp_secrets", validate_mcp_secrets_params),
        ):
            if method == method_name:
                try:
                    params = validator(params)
                except ProtocolError as exc:
                    raise ServiceError("ANSWER_INVALID_PARAMS", str(exc)) from exc
                break
        if method in {"mcp_status", "mcp_refresh", "skills_status", "skills_refresh"}:
            # Extension status/refresh work without the embedding model.
            return self._call_extension_method(method, params)
        # answer_status is read-only and must not queue behind answer_start
        if method == "answer_status":
            return self._answer_status(params)
        # answer_cancel is out-of-band as well (also handled in server.py)
        if method == "answer_cancel":
            return self._answer_cancel(params)

        # Everything below touches mutable ready-state references (index,
        # search_engine, state). Re-check under the operation lock so an
        # idle-unload that runs between this method's pre-checks and the lock
        # acquisition cannot leave us holding stale None references.
        with self.operation_lock:
            self.last_activity = time.monotonic()
            if method == "apply_search_config":
                # Config-only mutation: must work even before the model loads
                # (lazy sidecar), so hot setting changes reach a live service
                # regardless of state.
                return self._apply_search_config(params)
            if method == "set_mcp_secrets":
                return self._set_mcp_secrets(params)
            if method == "answer_continue":
                # Approvals must be answerable even while a parallel request
                # triggered the lazy model load.
                return self._answer_continue(params)
            if self.state == "idle":
                if method in {"search", "answer"}:
                    if self.index_rebuild_reason:
                        raise ServiceError(
                            "INDEX_REBUILD_REQUIRED",
                            self.index_rebuild_reason,
                            {
                                "problems": self.index_problems,
                                "recommended_action": self.recommended_action,
                            },
                        )
                    self.start_initialization()
                    raise ServiceError(
                        "MODEL_LOADING",
                        "Embedding model is loading after the first search request",
                    )
                raise ServiceError("MODEL_NOT_LOADED", "Embedding model is not loaded")
            if self.state in {"starting", "loading_model"}:
                raise ServiceError("MODEL_LOADING", "Embedding model is still loading")
            if self.state == "error":
                raise ServiceError(
                    "BACKEND_ERROR", self.error or "Backend initialization failed"
                )
            if self.index is None or self.search_engine is None:
                raise ServiceError("BACKEND_NOT_READY", "Search backend is not ready")

            if method == "search":
                if self.index_rebuild_reason:
                    raise ServiceError(
                        "INDEX_REBUILD_REQUIRED",
                        self.index_rebuild_reason,
                        {
                            "problems": self.index_problems,
                            "recommended_action": self.recommended_action,
                        },
                    )
                query = str(params.get("query", "")).strip()
                if not query:
                    raise ServiceError("INVALID_QUERY", "Query must not be empty")
                match_mode = str(params.get("match_mode", "any"))
                if match_mode not in {"any", "all", "phrase"}:
                    raise ServiceError(
                        "INVALID_PARAMS", "match_mode must be any, all, or phrase"
                    )
                raw_intent = params.get("intent")
                intent = str(raw_intent) if raw_intent is not None else None
                if intent not in {
                    None,
                    "exact",
                    "known-item",
                    "topic",
                    "timeline",
                    "value",
                    "korean-morphology",
                }:
                    raise ServiceError("INVALID_PARAMS", "intent is invalid")
                try:
                    outcome = self.search_engine.search_detailed(
                        query,
                        top_k=int(params.get("top_k") or self.config.final_top_k),
                        verbose=bool(params.get("verbose", False)),
                        match_mode=match_mode,
                        intent=intent,
                    )
                except FileNotFoundError as exc:
                    raise ServiceError("INDEX_MISSING", str(exc)) from exc
                except IndexCompatibilityError as exc:
                    self.index_problems = list(exc.problems)
                    self.recommended_action = classify_index_problems(exc.problems)
                    self.index_validation_state = "incompatible"
                    self.index_rebuild_reason = str(exc)
                    raise ServiceError(
                        "INDEX_REBUILD_REQUIRED",
                        str(exc),
                        {
                            "problems": exc.problems,
                            "recommended_action": self.recommended_action,
                        },
                    ) from exc
                return {
                    "mode": "hybrid",
                    "model": self.config.model_id,
                    "device": self.model.device,
                    **outcome.to_dict(),
                }
            if method == "answer":
                return self._answer(params)
            if method == "answer_start":
                return self._answer_start(params)
            if method == "preview_scope":
                return self.index.preview_scope()
            if method == "reconcile":
                mode = str(params.get("mode", "fast"))
                if mode not in {"fast", "strict"}:
                    raise ServiceError("INVALID_PARAMS", "mode must be fast or strict")
                return self._run_index_operation(
                    "reconciling", lambda: self._reconcile(mode)
                )
            if method == "sync_paths":
                return self._run_index_operation(
                    "syncing",
                    lambda: self._sync_paths(
                        [str(x) for x in params.get("changed", [])],
                        [str(x) for x in params.get("deleted", [])],
                    ),
                )
            if method == "rebuild_all":
                return self._run_index_operation("rebuilding", self._rebuild_all)
            if method == "rebuild_vectors":
                return self._run_index_operation(
                    "rebuilding_vectors", self._rebuild_vectors
                )
        raise ServiceError("UNKNOWN_METHOD", f"Unknown method: {method}")

    def _answer(self, params: dict[str, Any]) -> dict[str, Any]:
        if params.get("deep"):
            return self._deep_answer(params)
        if self.index_rebuild_reason:
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                self.index_rebuild_reason,
                {
                    "problems": self.index_problems,
                    "recommended_action": self.recommended_action,
                },
            )
        if self.search_engine is None:
            raise ServiceError("BACKEND_NOT_READY", "Search backend is not ready")
        try:
            outcome = self.search_engine.search_detailed(
                params["query"], top_k=params["top_k"], verbose=True
            )
        except FileNotFoundError as exc:
            raise ServiceError("INDEX_MISSING", str(exc)) from exc
        except IndexCompatibilityError as exc:
            raise ServiceError("INDEX_REBUILD_REQUIRED", str(exc)) from exc
        results = list(outcome.results)
        sources, context = build_grounding_context(results, params["max_context_chars"])
        if not sources or not context:
            raise ServiceError("GROUNDING_EMPTY", "No usable vault evidence was found")
        system, current_user = build_prompt(params["query"], sources)
        conversation = list(params["conversation"])
        messages = [*conversation, {"role": "user", "content": current_user}]
        provider_id = self.config.llm_provider
        try:
            provider = create_provider(provider_id, self.config.llm_model)
            response = provider.complete(
                system=system,
                messages=messages,
                max_output_tokens=self.config.llm_max_output_tokens,
                timeout_seconds=self.config.llm_timeout_seconds,
                reasoning_effort=self.config.reasoning_effort,
            )
        except ProviderError as exc:
            raise ServiceError(
                exc.code,
                exc.message,
                {"evidence": [source.evidence() for source in sources]},
            ) from exc
        if len(response.text) > 32000:
            raise ServiceError("ANSWER_TOO_LARGE", "Provider answer is too large")
        answer, citations, warning = normalize_citations(response.text, sources)
        if not answer:
            raise ServiceError("LLM_BAD_RESPONSE", "Provider returned an empty answer")
        return {
            "answer": answer,
            "citations": citations,
            "evidence": [source.evidence() for source in sources],
            "provider": response.provider,
            "model": response.model,
            "grounded": bool(citations),
            "diagnostics": {
                "retrieved_count": len(results),
                "context_chars": len(context),
                "answer_chars": len(answer),
                **({"citation_warning": warning} if warning else {}),
            },
        }

    def _deep_answer(self, params: dict[str, Any]) -> dict[str, Any]:
        """Agentic answer: the model iteratively searches / reads / greps the
        vault (CLI-agent quality) until it has enough evidence, then answers
        with [S#] citations. Works with any plain chat model — tool calls
        travel as ``TOOL: name(args)`` lines in the model text."""
        if self.index_rebuild_reason:
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                self.index_rebuild_reason,
                {
                    "problems": self.index_problems,
                    "recommended_action": self.recommended_action,
                },
            )
        if self.search_engine is None:
            raise ServiceError("BACKEND_NOT_READY", "Search backend is not ready")
        search_engine = self.search_engine

        provider_id = self.config.llm_provider
        try:
            provider = create_provider(provider_id, self.config.llm_model)
        except ProviderError as exc:
            raise ServiceError(exc.code, exc.message) from exc

        def complete(
            messages: list[dict[str, str]],
            max_output_tokens: int,
            timeout_seconds: float,
        ):
            return provider.complete(
                system=DEEP_SYSTEM_PROMPT,
                messages=messages,
                max_output_tokens=max_output_tokens,
                timeout_seconds=timeout_seconds,
                reasoning_effort=self.config.reasoning_effort,
            )

        def do_search(query: str) -> list[dict[str, Any]]:
            outcome = search_engine.search_detailed(
                query,
                top_k=max(1, self.config.final_top_k or 40),
                verbose=True,
            )
            return list(outcome.results)

        def do_read(rel_path: str) -> str:
            root = self.config.vault_path.resolve()
            rel = rel_path.replace("\\", "/")
            if not rel or rel.startswith("/") or ".." in rel.split("/"):
                raise ValueError(f"invalid file path: {rel_path}")
            path = (root / rel).resolve()
            if not path.is_relative_to(root):
                raise ValueError(f"file path escapes the vault: {rel_path}")
            if not path.is_file():
                raise ValueError(f"file not found: {rel_path}")
            # Respect the configured search scope: files the user excluded from
            # indexing (e.g. .obsidian/**, .env) must not be shipped to the
            # external provider.
            if any(fnmatch.fnmatch(rel, g) for g in self.config.exclude_globs):
                raise ValueError(f"file is excluded from the vault scope: {rel_path}")
            if self.config.include_globs and not any(
                fnmatch.fnmatch(rel, g) for g in self.config.include_globs
            ):
                raise ValueError(f"file is outside the vault scope: {rel_path}")
            return path.read_text(encoding="utf-8", errors="replace")[:40000]

        def do_grep(pattern: str, glob_pattern: str) -> list[dict[str, Any]]:
            return grep_vault(
                self.config.vault_path,
                pattern,
                glob_pattern,
                include_globs=self.config.include_globs,
                exclude_globs=self.config.exclude_globs,
            )

        engine = DeepAnswerEngine(
            complete=complete,
            search=do_search,
            read_file=do_read,
            grep=do_grep,
            max_output_tokens=max(
                self.config.llm_max_output_tokens,
                MIN_DEEP_OUTPUT_TOKENS,
            ),
            timeout_seconds=self.config.llm_timeout_seconds,
            max_context_chars=params.get("max_context_chars")
            or self.config.llm_max_context_chars,
        )
        try:
            outcome = engine.run(
                query=params["query"],
                conversation=list(params["conversation"]),
            )
        except ProviderError as exc:
            raise ServiceError(
                exc.code,
                exc.message,
                {"evidence": [source.evidence() for source in engine.sources]},
            ) from exc
        sources = outcome["sources"]
        answer, citations, warning = normalize_citations(outcome["text"], sources)
        if not answer:
            raise ServiceError("LLM_BAD_RESPONSE", "Provider returned an empty answer")
        # Without any gathered evidence the model must not fall back to general
        # knowledge: report the explicit insufficiency message (mirrors the
        # single-shot GROUNDING_EMPTY behavior).
        if not sources and "충분한 근거를 찾지 못" not in answer:
            answer = "볼트에서 충분한 근거를 찾지 못했습니다."
        if len(answer) > 32000:
            raise ServiceError("ANSWER_TOO_LARGE", "Provider answer is too large")
        return {
            "answer": answer,
            "citations": citations,
            "evidence": [source.evidence() for source in sources],
            "provider": provider.provider_id,
            "model": provider.model,
            "grounded": bool(citations),
            "diagnostics": {
                "deep": True,
                "turns": outcome["turns"],
                "tool_calls": outcome["tool_calls"],
                "retrieved_count": len(sources),
                "context_chars": sum(len(source.content) for source in sources),
                "answer_chars": len(answer),
                **({"citation_warning": warning} if warning else {}),
            },
        }

    # ------------------------------------------------------------------
    # API agent extensions (MCP / skills / project rules / structured runs)
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Release every extension resource; safe to call multiple times."""
        self.run_registry.close_all()
        self.mcp_host.close()

    def _call_extension_method(
        self, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        if method == "mcp_status":
            host_status = self.mcp_host.status()
            host_problems = host_status.pop("config_problems", [])
            merged_problems = sorted(
                set(list(self.config.config_problems) + host_problems)
            )
            return {
                **host_status,
                "config_problems": merged_problems,
                "tool_surface": dict(self._last_tool_surface),
            }
        if method == "mcp_refresh":
            self._configure_mcp()
            refreshed = self.mcp_host.refresh_tools()
            return {"ok": True, **refreshed}
        if method == "skills_status":
            return self.skills.status()
        if method == "skills_refresh":
            self._refresh_skills()
            return {"ok": True, **self.skills.status()}
        raise ServiceError("UNKNOWN_METHOD", f"Unknown method: {method}")

    def _refresh_skills(self) -> None:
        roots = [(root.id, root.path, root.enabled) for root in self.config.skill_roots]
        self.skills.refresh(
            user_roots=roots,
            enabled_skills=set(self.config.enabled_skills),
        )

    def _configure_mcp(self) -> dict[str, Any]:
        """Push current MCP settings into the host (connects asynchronously)."""
        return self.mcp_host.configure(
            enabled=self.config.mcp_enabled,
            servers=list(self.config.mcp_servers),
        )

    def _wait_for_connections(self) -> None:
        for server in self.config.mcp_servers:
            if server.enabled:
                self.mcp_host.wait_connected(server.id, timeout=12.0)

    def _set_mcp_secrets(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            payload = validate_mcp_secrets_params(params)
        except ProtocolError as exc:
            raise ServiceError("ANSWER_INVALID_PARAMS", str(exc)) from exc
        try:
            received = self.mcp_host.apply_secrets(payload)
        except ValueError as exc:
            # Unknown server ids are rejected outright: values for servers
            # outside the current config must never be staged in memory.
            raise ServiceError("MCP_UNKNOWN_SERVER", str(exc)) from exc
        # Names only — values are never echoed back nor logged (plan §6.2).
        names_by_server = {
            server_id: sorted(values.keys())
            for server_id, values in payload["servers"].items()
        }
        rejected = [
            {"server_id": entry["server_id"], "name": entry["name"]}
            for entry in received.get("rejected", [])
        ]
        return {
            "ok": True,
            "applied": received.get("applied", 0),
            "servers": names_by_server,
            **({"rejected_envs": rejected} if rejected else {}),
        }

    def _extensions_active(self) -> bool:
        # Project rules alone justify the structured path: they are injected
        # into the agent system prompt, which the legacy loop never sees.
        return bool(
            self.config.mcp_enabled
            or self.config.skills_enabled
            or self.config.project_rules.strip()
        )

    def _prepare_agent_context(
        self,
    ) -> tuple[
        Any, ToolAliasMap, list[ToolDefinition], SkillRegistry | None, bool, bool
    ]:
        """Wait briefly for MCP sessions then assemble the tool surface."""
        mcp_tools_available = False
        aliases: ToolAliasMap = ToolAliasMap()
        if self.config.mcp_enabled and any(
            server.enabled for server in self.config.mcp_servers
        ):
            self._configure_mcp()
            self._wait_for_connections()
            aliases = self.mcp_host.build_alias_map()
            connected = {
                summary["id"]
                for summary in self.mcp_host.status()["servers"]
                if summary["state"] == SERVER_STATE_CONNECTED
            }
            mcp_tools_available = bool(connected) and len(aliases) > 0
        skills_registry: SkillRegistry | None = None
        if self.config.skills_enabled:
            self._refresh_skills()
            if self.skills.catalog_entries():
                skills_registry = self.skills
        tools = builtin_tool_definitions(has_skills=skills_registry is not None)
        surface = {
            "discovered_tools": self.mcp_host.alias_surface_info.get("discovered", 0)
            if mcp_tools_available
            else 0,
            "exposed_mcp_tools": len(aliases.aliases()),
            "tools_truncated": (
                self.mcp_host.alias_surface_info.get("truncated", False)
                if mcp_tools_available
                else False
            ),
            "schema_bytes": 0,
            "schema_truncated": False,
        }
        if mcp_tools_available:
            total_schema_bytes = 0
            for alias, (server_id, original_name) in sorted(aliases.aliases().items()):
                schema = self.mcp_host.list_server_tools(server_id).get(
                    original_name
                ) or {"type": "object", "properties": {}}
                try:
                    schema_size = len(
                        json.dumps(schema, ensure_ascii=False).encode("utf-8")
                    )
                except (TypeError, ValueError):
                    schema_size = MAX_SCHEMA_BYTES
                if total_schema_bytes + schema_size > MAX_TOTAL_SCHEMA_BYTES:
                    # Deterministic prefix cut: the remaining definitions are
                    # not advertised (and reported via status), never silently
                    # mixed in.
                    surface["schema_truncated"] = True
                    break
                total_schema_bytes += schema_size
                server_summary = self.mcp_host.server_summary(server_id) or {}
                tools.append(
                    ToolDefinition(
                        name=alias,
                        description=(
                            f"MCP tool '{original_name}' from server "
                            f"'{server_summary.get('name', server_id)}'."
                        ),
                        input_schema=schema,
                    )
                )
            surface["schema_bytes"] = total_schema_bytes
        self._last_tool_surface = surface
        provider_stub = create_provider(self.config.llm_provider, self.config.llm_model)
        return (
            provider_stub,
            aliases,
            tools,
            skills_registry,
            mcp_tools_available,
            bool(skills_registry),
        )

    def _answer_start(self, params: dict[str, Any]) -> dict[str, Any]:
        # Idempotency: if client supplied run_id and it already exists (live or
        # terminal), return existing state instead of creating a new LLM call.
        client_run_id = params.get("run_id")
        fp = (
            self._fingerprint(params)
            if isinstance(client_run_id, str) and client_run_id
            else ""
        )
        if isinstance(client_run_id, str) and client_run_id:
            # Terminal cache first — no LLM cost, includes complete/failed/cancelled
            term = self._get_terminal(client_run_id)
            if term is not None:
                payload, stored_fp = term
                if stored_fp and stored_fp != fp:
                    raise ServiceError("RUN_CONFLICT", "run_id fingerprint mismatch")
                # Return stored terminal payload directly (already has status)
                return payload
            if self._is_expired_run(client_run_id):
                raise ServiceError("RUN_EXPIRED", f"run '{client_run_id}' has expired")
            # Live registry (approval_required / running) — fingerprint must match for all live states
            try:
                live = self.run_registry.get(client_run_id)
                live_fp = getattr(live.state, "fingerprint", "")
                if live_fp and live_fp != fp:
                    raise ServiceError("RUN_CONFLICT", "run_id fingerprint mismatch")
                if live.state.pending:
                    return {
                        "status": "approval_required",
                        "run_id": client_run_id,
                        "expires_at": (
                            datetime.now(timezone.utc) + timedelta(seconds=600)
                        ).isoformat(),
                        "calls": [
                            live._call_descriptor(p)
                            for p in live.state.pending.values()
                        ],  # type: ignore
                    }
                return {"status": "running", "run_id": client_run_id}
            except Exception as exc:
                code = getattr(exc, "code", "")
                if code == "RUN_EXPIRED":
                    # A run that reached expiry must never fall through to a
                    # new execution: keep the fact and surface RUN_EXPIRED.
                    self._remember_expired(client_run_id)
                    raise ServiceError(
                        "RUN_EXPIRED", f"run '{client_run_id}' has expired"
                    ) from exc
                if code not in {"RUN_NOT_FOUND", "RUN_CONFLICT"}:
                    raise ServiceError(code or "BACKEND_ERROR", str(exc)) from exc
                if self.run_registry.is_expired(client_run_id):
                    # The registry recorded the expiry (e.g. an unrelated add()
                    # swept it); mirror it into the service tombstone so status
                    # and start keep reporting RUN_EXPIRED.
                    self._remember_expired(client_run_id)
                    raise ServiceError(
                        "RUN_EXPIRED", f"run '{client_run_id}' has expired"
                    ) from exc
                if code == "RUN_CONFLICT":
                    raise ServiceError("RUN_CONFLICT", str(exc)) from exc
                # RUN_NOT_FOUND and genuinely unknown — fall through to new execution
        if not self._extensions_active():
            # Legacy text-tool loop — also idempotent via terminal cache.
            # Provide common live-run metadata so answer_status returns running
            # and cancel is atomic via the shared registry.
            if isinstance(client_run_id, str) and client_run_id:
                # Create live entry before _deep_answer so status is running
                legacy_state = new_run_state(params["query"])
                legacy_state.run_id = client_run_id
                legacy_state.fingerprint = fp
                legacy_run = type("LegacyRun", (), {"state": legacy_state})()
                try:
                    self.run_registry.add(legacy_run)  # type: ignore[arg-type]
                except AgentRunError as exc:
                    if exc.code == "RUN_CONFLICT":
                        term = self._get_terminal(client_run_id)
                        if term is not None:
                            payload_e, fp_e = term
                            if fp_e and fp_e != fp:
                                raise ServiceError(
                                    "RUN_CONFLICT", "run_id fingerprint mismatch"
                                ) from exc
                            return payload_e
                        try:
                            live = self.run_registry.get(client_run_id)
                            live_fp = getattr(live.state, "fingerprint", "")
                            if live_fp and live_fp != fp:
                                raise ServiceError(
                                    "RUN_CONFLICT", "run_id fingerprint mismatch"
                                ) from exc
                            if getattr(live.state, "pending", None):
                                # Legacy runs have no pending, but keep for consistency
                                return {"status": "running", "run_id": client_run_id}
                            return {"status": "running", "run_id": client_run_id}
                        except Exception as exc2:
                            term2 = self._get_terminal(client_run_id)
                            if term2 is not None:
                                payload2, fp2 = term2
                                if fp2 and fp2 != fp:
                                    raise ServiceError(
                                        "RUN_CONFLICT", "run_id fingerprint mismatch"
                                    ) from exc
                                return payload2
                            code2 = getattr(exc2, "code", "")
                            if code2 == "RUN_EXPIRED" or self.run_registry.is_expired(
                                client_run_id
                            ):
                                self._remember_expired(client_run_id)
                                raise ServiceError(
                                    "RUN_EXPIRED", f"run '{client_run_id}' has expired"
                                ) from exc
                            if code2 in {"RUN_NOT_FOUND", "RUN_CONFLICT"}:
                                raise ServiceError(exc.code, exc.message) from exc
                            raise ServiceError(
                                code2 or "BACKEND_ERROR", str(exc2)
                            ) from exc2
                    raise ServiceError(exc.code, exc.message) from exc
                # Consume pending cancel that raced registration
                if self._consume_pending_cancel(client_run_id):
                    payload = {"status": "cancelled", "run_id": client_run_id}
                    self._publish_terminal_outcome(client_run_id, payload, fp)
                    raise ServiceError("ANSWER_CANCELLED", "run was cancelled")
                try:
                    result = self._deep_answer(
                        {
                            **params,
                            "top_k": 12,
                            "deep": True,
                        }
                    )
                except ServiceError as exc:
                    if isinstance(client_run_id, str) and client_run_id:
                        payload_failed = {
                            "status": "failed",
                            "run_id": client_run_id,
                            "code": exc.code,
                            "message": exc.message,
                        }
                        winner = self._publish_terminal_outcome(
                            client_run_id, payload_failed, fp
                        )
                        if winner.get("status") == "cancelled":
                            raise ServiceError(
                                "ANSWER_CANCELLED", "run was cancelled"
                            ) from exc
                    else:
                        self.run_registry.remove(client_run_id)
                    raise
                except Exception as exc:
                    if isinstance(client_run_id, str) and client_run_id:
                        payload_failed = {
                            "status": "failed",
                            "run_id": client_run_id,
                            "code": "BACKEND_ERROR",
                            "message": f"{type(exc).__name__}: {exc}",
                        }
                        winner = self._publish_terminal_outcome(
                            client_run_id, payload_failed, fp
                        )
                        if winner.get("status") == "cancelled":
                            raise ServiceError(
                                "ANSWER_CANCELLED", "run was cancelled"
                            ) from exc
                        raise ServiceError(
                            "BACKEND_ERROR", f"{type(exc).__name__}: {exc}"
                        ) from exc
                    self.run_registry.remove(client_run_id)
                    raise ServiceError(
                        "BACKEND_ERROR", f"{type(exc).__name__}: {exc}"
                    ) from exc
                if isinstance(client_run_id, str) and client_run_id:
                    payload = {
                        "status": "complete",
                        "run_id": client_run_id,
                        "result": result,
                    }
                    winner = self._publish_terminal_outcome(client_run_id, payload, fp)
                    if winner.get("status") == "cancelled":
                        raise ServiceError("ANSWER_CANCELLED", "run was cancelled")
                    if winner.get("status") == "failed":
                        raise ServiceError(
                            winner.get("code", "BACKEND_ERROR"),
                            winner.get("message", "failed"),
                        )
                    return winner
                return {"status": "complete", "result": result}
            # No run_id — direct execution without live tracking
            try:
                result = self._deep_answer(
                    {
                        **params,
                        "top_k": 12,
                        "deep": True,
                    }
                )
            except ServiceError:
                raise
            except Exception as exc:
                raise ServiceError(
                    "BACKEND_ERROR", f"{type(exc).__name__}: {exc}"
                ) from exc
            return {"status": "complete", "result": result}
        if self.index_rebuild_reason:
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                self.index_rebuild_reason,
                {
                    "problems": self.index_problems,
                    "recommended_action": self.recommended_action,
                },
            )
        if self.search_engine is None:
            raise ServiceError("BACKEND_NOT_READY", "Search backend is not ready")
        search_engine = self.search_engine

        try:
            provider, aliases, tools, skills_registry, mcp_on, skills_on = (
                self._prepare_agent_context()
            )
        except ProviderError as exc:
            raise ServiceError(exc.code, exc.message) from exc

        system_prompt = build_agent_system_prompt(
            project_rules=self.config.project_rules,
            skill_catalog_lines=(
                skills_registry.catalog_lines() if skills_registry else []
            ),
            has_mcp_tools=mcp_on,
            has_skills=skills_on,
        )

        def do_search(query_text: str) -> list[dict[str, Any]]:
            outcome = search_engine.search_detailed(
                query_text,
                top_k=max(1, self.config.final_top_k or 40),
                verbose=True,
            )
            return list(outcome.results)

        vault_root = self.config.vault_path.resolve()

        def do_read(rel_path: str) -> str:
            rel = rel_path.replace("\\", "/")
            if not rel or rel.startswith("/") or ".." in rel.split("/"):
                raise ValueError(f"invalid file path: {rel_path}")
            path = (vault_root / rel).resolve()
            if not path.is_relative_to(vault_root):
                raise ValueError(f"file path escapes the vault: {rel_path}")
            if not path.is_file():
                raise ValueError(f"file not found: {rel_path}")
            if any(fnmatch.fnmatch(rel, g) for g in self.config.exclude_globs):
                raise ValueError(f"file is excluded from the vault scope: {rel_path}")
            if self.config.include_globs and not any(
                fnmatch.fnmatch(rel, g) for g in self.config.include_globs
            ):
                raise ValueError(f"file is outside the vault scope: {rel_path}")
            return path.read_text(encoding="utf-8", errors="replace")[:40000]

        def do_grep(pattern: str, glob_pattern: str) -> list[dict[str, Any]]:
            return grep_vault(
                self.config.vault_path,
                pattern,
                glob_pattern,
                include_globs=self.config.include_globs,
                exclude_globs=self.config.exclude_globs,
            )

        def complete_turn(**kwargs: Any):
            return provider.complete_with_tools(
                reasoning_effort=self.config.reasoning_effort, **kwargs
            )

        state = new_run_state(params["query"])
        # Additive protocol: the client may supply the run id so it can cancel
        # a first-turn run before answer_start has responded (fix §3).
        client_run_id = params.get("run_id")
        if isinstance(client_run_id, str) and client_run_id:
            state.run_id = client_run_id
        state.fingerprint = fp
        state.provider = provider
        run = StructuredAgentRun(
            state=state,
            system_prompt=system_prompt,
            tools=tools,
            aliases=aliases,
            complete_turn=complete_turn,
            search_fn=do_search,
            read_file_fn=do_read,
            grep_fn=do_grep,
            skills=skills_registry,
            mcp_host=self.mcp_host if mcp_on else None,
            max_context_chars=params["max_context_chars"],
            max_output_tokens=max(
                self.config.llm_max_output_tokens, MIN_DEEP_OUTPUT_TOKENS
            ),
            timeout_seconds=self.config.llm_timeout_seconds,
        )
        run.session_allowed = set(params.get("session_allowed_tools") or [])
        run.seed(list(params["conversation"]))
        try:
            self.run_registry.add(run)
        except AgentRunError as exc:
            if exc.code == "RUN_CONFLICT":
                # Atomic claim lost — another concurrent start claimed same run_id.
                # Return existing state idempotently; do not start a second LLM run.
                term = self._get_terminal(state.run_id)
                if term is not None:
                    payload_e, fp_e = term
                    if fp_e and fp_e != fp:
                        raise ServiceError(
                            "RUN_CONFLICT", "run_id fingerprint mismatch"
                        ) from exc
                    return payload_e
                try:
                    live = self.run_registry.get(state.run_id)
                    live_fp = getattr(live.state, "fingerprint", "")
                    if live_fp and live_fp != fp:
                        raise ServiceError(
                            "RUN_CONFLICT", "run_id fingerprint mismatch"
                        ) from exc
                    if live.state.pending:
                        return {
                            "status": "approval_required",
                            "run_id": state.run_id,
                            "expires_at": (
                                datetime.now(timezone.utc) + timedelta(seconds=600)
                            ).isoformat(),
                            "calls": [
                                live._call_descriptor(p)
                                for p in live.state.pending.values()
                            ],  # type: ignore
                        }
                    return {"status": "running", "run_id": state.run_id}
                except Exception as exc2:
                    term2 = self._get_terminal(state.run_id)
                    if term2 is not None:
                        payload2, fp2 = term2
                        if fp2 and fp2 != fp:
                            raise ServiceError(
                                "RUN_CONFLICT", "run_id fingerprint mismatch"
                            ) from exc
                        return payload2
                    code2 = getattr(exc2, "code", "")
                    if code2 == "RUN_EXPIRED" or self.run_registry.is_expired(
                        state.run_id
                    ):
                        self._remember_expired(state.run_id)
                        raise ServiceError(
                            "RUN_EXPIRED", f"run '{state.run_id}' has expired"
                        ) from exc
                    if code2 in {"RUN_NOT_FOUND", "RUN_CONFLICT"}:
                        # Lost race but no existing state — propagate original conflict
                        raise ServiceError(exc.code, exc.message) from exc
                    raise ServiceError(code2 or "BACKEND_ERROR", str(exc2)) from exc2
            raise ServiceError(exc.code, exc.message) from exc
        # A cancel that arrived between client dispatch and registration must
        # not be lost: consume the pending marker before advancing.
        # Terminal must be published before live removal to avoid gap.
        if self._consume_pending_cancel(state.run_id):
            state.cancelled = True
            payload = {"status": "cancelled", "run_id": state.run_id}
            self._publish_terminal_outcome(state.run_id, payload, fp)
            raise ServiceError("ANSWER_CANCELLED", "run was cancelled")
        try:
            outcome = run.advance()
        except AgentRunError as exc:
            # Terminal must be published before live removal to avoid gap
            if exc.code in {"ANSWER_CANCELLED", "RUN_CANCELLED"}:
                payload = {"status": "cancelled", "run_id": state.run_id}
                self._publish_terminal_outcome(state.run_id, payload, fp)
                raise ServiceError("ANSWER_CANCELLED", exc.message) from exc
            payload = {
                "status": "failed",
                "run_id": state.run_id,
                "code": exc.code,
                "message": exc.message,
            }
            winner = self._publish_terminal_outcome(state.run_id, payload, fp)
            if winner.get("status") == "cancelled":
                raise ServiceError("ANSWER_CANCELLED", "run was cancelled") from exc
            raise ServiceError(exc.code, exc.message) from exc
        except ProviderError as exc:
            payload = {
                "status": "failed",
                "run_id": state.run_id,
                "code": exc.code,
                "message": exc.message,
            }
            winner = self._publish_terminal_outcome(state.run_id, payload, fp)
            if winner.get("status") == "cancelled":
                raise ServiceError("ANSWER_CANCELLED", "run was cancelled") from exc
            raise ServiceError(exc.code, exc.message) from exc
        if outcome["status"] != "complete":
            expires = datetime.now(timezone.utc) + timedelta(seconds=600)
            return {
                "status": "approval_required",
                "run_id": state.run_id,
                "expires_at": expires.isoformat(),
                "calls": outcome["calls"],
            }
        result = self._assemble_agent_result(outcome, provider)
        payload = {"status": "complete", "run_id": state.run_id, "result": result}
        winner = self._publish_terminal_outcome(state.run_id, payload, fp)
        if winner.get("status") == "cancelled":
            raise ServiceError("ANSWER_CANCELLED", "run was cancelled")
        if winner.get("status") == "failed":
            raise ServiceError(
                winner.get("code", "BACKEND_ERROR"), winner.get("message", "failed")
            )
        return winner

    def _answer_continue(self, params: dict[str, Any]) -> dict[str, Any]:
        run_id = str(params.get("run_id", ""))
        try:
            run = self.run_registry.get(run_id)
        except AgentRunError as exc:
            if exc.code == "RUN_EXPIRED":
                self._remember_expired(run_id)
                raise ServiceError(
                    "RUN_EXPIRED", f"run '{run_id}' has expired"
                ) from exc
            if exc.code == "RUN_NOT_FOUND":
                raise self._missing_run_error(run_id) from exc
            raise ServiceError(exc.code, exc.message) from exc
        # Preserve original fingerprint for terminal storage (first-wins)
        orig_fp = getattr(run.state, "fingerprint", "")
        try:
            outcome = run.resume(list(params.get("decisions") or []))
        except AgentRunError as exc:
            if exc.code in {
                "RUN_NOT_WAITING",
                "DECISION_MISMATCH",
                "DUPLICATE_DECISION",
                "INVALID_DECISION",
            }:
                raise ServiceError("ANSWER_INVALID_PARAMS", exc.message) from exc
            if exc.code in {"ANSWER_CANCELLED", "RUN_CANCELLED"}:
                payload = {"status": "cancelled", "run_id": run_id}
                self._publish_terminal_outcome(run_id, payload, orig_fp)
                raise ServiceError("ANSWER_CANCELLED", exc.message) from exc
            payload = {
                "status": "failed",
                "run_id": run_id,
                "code": exc.code,
                "message": exc.message,
            }
            winner = self._publish_terminal_outcome(run_id, payload, orig_fp)
            if winner.get("status") == "cancelled":
                raise ServiceError("ANSWER_CANCELLED", "run was cancelled") from exc
            raise ServiceError(exc.code, exc.message) from exc
        except ProviderError as exc:
            payload = {
                "status": "failed",
                "run_id": run_id,
                "code": exc.code,
                "message": exc.message,
            }
            winner = self._publish_terminal_outcome(run_id, payload, orig_fp)
            if winner.get("status") == "cancelled":
                raise ServiceError("ANSWER_CANCELLED", "run was cancelled") from exc
            raise ServiceError(exc.code, exc.message) from exc
        if outcome["status"] != "complete":
            self.run_registry.touch(run_id)
            expires = datetime.now(timezone.utc) + timedelta(seconds=600)
            return {
                "status": "approval_required",
                "run_id": run_id,
                "expires_at": expires.isoformat(),
                "calls": outcome["calls"],
            }
        result = self._assemble_agent_result(outcome, run.state.provider)
        payload = {"status": "complete", "run_id": run_id, "result": result}
        winner = self._publish_terminal_outcome(run_id, payload, orig_fp)
        if winner.get("status") == "cancelled":
            raise ServiceError("ANSWER_CANCELLED", "run was cancelled")
        if winner.get("status") == "failed":
            raise ServiceError(
                winner.get("code", "BACKEND_ERROR"), winner.get("message", "failed")
            )
        return winner

    def _answer_status(self, params: dict[str, Any]) -> dict[str, Any]:
        run_id = str(params.get("run_id", "")).strip()
        if not run_id:
            raise ServiceError("ANSWER_INVALID_PARAMS", "run_id must be provided")
        # Terminal is authoritative — check first to close live→terminal gap
        term = self._get_terminal(run_id)
        if term is not None:
            payload, _fp = term
            return payload
        try:
            run = self.run_registry.get(run_id)
            if run.state.pending:
                return {
                    "status": "approval_required",
                    "run_id": run_id,
                    "expires_at": (
                        datetime.now(timezone.utc) + timedelta(seconds=600)
                    ).isoformat(),
                    "calls": [
                        run._call_descriptor(p) for p in run.state.pending.values()
                    ],  # type: ignore
                }
            return {"status": "running", "run_id": run_id}
        except Exception as exc:
            code = getattr(exc, "code", "")
            if code == "RUN_NOT_FOUND":
                term2 = self._get_terminal(run_id)
                if term2 is not None:
                    payload2, _fp2 = term2
                    return payload2
                raise self._missing_run_error(run_id) from exc
            if code == "RUN_EXPIRED":
                term2 = self._get_terminal(run_id)
                if term2 is not None:
                    payload2, _fp2 = term2
                    return payload2
                self._remember_expired(run_id)
                raise ServiceError(
                    "RUN_EXPIRED", f"run '{run_id}' has expired"
                ) from exc
            err_code = code if code else "BACKEND_ERROR"
            raise ServiceError(err_code, str(exc)) from exc

    def _answer_cancel(self, params: dict[str, Any]) -> dict[str, Any]:
        return self.cancel_answer(str(params.get("run_id", "")))

    def cancel_answer(self, run_id: str) -> dict[str, Any]:
        """Cancel a run from any thread (out-of-band fast path).

        ``answer_cancel`` must never queue behind a long-running
        ``answer_start``/``answer_continue`` on the serialized worker: this
        method touches only lock-guarded state — the run registry, the
        cancelled flag and the MCP host's cancel registry — so the request
        handler thread can execute it directly.
        Lock order: terminal -> pending -> registry. The cancelled terminal
        is published BEFORE the live entry is removed so a capacity rejection
        never drops the live entry without a protection marker.
        """
        if not run_id:
            return {"cancelled": False}
        run = None
        publish_rejected = False
        with self._terminal_lock:
            now = time.monotonic()
            expired_term = [
                k for k, (_, _, exp) in self._terminal_runs.items() if exp <= now
            ]
            for k in expired_term:
                if self._remember_expired_locked(k):
                    self._terminal_runs.pop(k, None)
            if run_id in self._terminal_runs:
                return {"cancelled": False}
            if self._is_expired_run_locked(run_id):
                return {"cancelled": False}
            with self._pending_cancel_lock:
                now2 = time.monotonic()
                expired_p = [
                    k for k, exp in self._pending_cancels.items() if exp <= now2
                ]
                for k in expired_p:
                    self._pending_cancels.pop(k, None)
                # Expired via registry (graveyard or TTL live) must not be
                # parked or resurrected as a cancelled terminal.
                if self.run_registry.is_expired(run_id):
                    return {"cancelled": False}
                # Peek live without removing yet (pending -> registry)
                run_ref = None
                fingerprint = ""
                expired_live = False
                with self.run_registry._lock:
                    entry = self.run_registry._runs.get(run_id)
                    if entry is not None:
                        if (
                            time.monotonic() - entry[1]
                            > self.run_registry._graveyard_ttl_seconds
                        ):
                            # TTL already elapsed — do not resurrect as cancelled
                            expired_live = True
                        else:
                            run_ref = entry[0]
                            fingerprint = getattr(run_ref.state, "fingerprint", "")
                    else:
                        if self.run_registry._is_graveyarded_locked(run_id):
                            expired_live = True
                if expired_live:
                    return {"cancelled": False}
                if run_ref is None:
                    # No live and not expired — park pending for racing start
                    if (
                        len(self._pending_cancels) >= self._pending_cancel_max
                        and run_id not in self._pending_cancels
                    ):
                        oldest = min(
                            self._pending_cancels.items(), key=lambda kv: kv[1]
                        )
                        self._pending_cancels.pop(oldest[0], None)
                    self._pending_cancels[run_id] = now2 + self._pending_cancel_ttl
                    return {"cancelled": False}
                # Live run present and not expired — publish cancelled terminal first
                payload = {"status": "cancelled", "run_id": run_id}
                _, _, outcome = self._store_terminal(run_id, payload, fingerprint)
                publish_rejected = outcome in {"expired", "capacity"}
                # Pending for this id must not remain
                self._pending_cancels.pop(run_id, None)
                if outcome == "capacity":
                    # Graveyard or retained expired resident protects the id
                    self.run_registry.retire_protected(run_id)
                    run = run_ref
                elif outcome in ("stored", "existing", "expired"):
                    removed = self.run_registry.remove(run_id)
                    run = removed if removed is not None else run_ref
                else:
                    removed = self.run_registry.remove(run_id)
                    run = removed if removed is not None else run_ref
        assert run is not None
        run.state.cancelled = True
        cancelled = self.mcp_host.cancel_pending(run.state.active_calls)
        if publish_rejected:
            return {"cancelled": False, "calls_cancelled": cancelled}
        return {"cancelled": True, "calls_cancelled": cancelled}

    def _consume_pending_cancel(self, run_id: str) -> bool:
        with self._pending_cancel_lock:
            exp = self._pending_cancels.get(run_id)
            if exp is not None:
                if time.monotonic() > exp:
                    self._pending_cancels.pop(run_id, None)
                    return False
                self._pending_cancels.pop(run_id, None)
                return True
            return False

    def _sweep_expired_tombstones_locked(self, now: float) -> None:
        stale = [k for k, exp in self._expired_runs.items() if exp <= now]
        for key in stale:
            self._expired_runs.pop(key, None)

    def _remember_expired_locked(self, run_id: str) -> bool:
        """Add run_id to the expired-run protection ledger.

        Returns False only when the ledger is at capacity and every entry is
        still inside its protection window. Protected entries are NEVER
        evicted: dropping one would turn RUN_EXPIRED back into RUN_NOT_FOUND
        and allow a duplicate LLM execution for the same run_id (idempotency
        violation). Capacity policy: bounded ledger of
        ``_expired_max_entries`` (default 4096 — far above realistic churn
        inside the 600s protection window); entries past protection are swept
        first; when the ledger is full of protected entries the caller keeps
        its own record (the expired terminal entry) so protection never
        degrades.
        """
        now = time.monotonic()
        self._sweep_expired_tombstones_locked(now)
        if run_id in self._expired_runs:
            return True
        if len(self._expired_runs) >= self._expired_max_entries:
            return False
        self._expired_runs[run_id] = now + self._expired_ttl_seconds
        return True

    def _remember_expired(self, run_id: str) -> bool:
        """Best-effort mirror of an expiry into the service tombstone.

        Returns False when the ledger is full of still-protected entries; the
        registry's own protection ledger still reports RUN_EXPIRED, so the id
        is not forgotten even then.
        """
        with self._terminal_lock:
            return self._remember_expired_locked(run_id)

    def _is_expired_run_locked(self, run_id: str) -> bool:
        now = time.monotonic()
        exp = self._expired_runs.get(run_id)
        if exp is not None:
            if exp <= now:
                self._expired_runs.pop(run_id, None)
                return False
            return True
        # An expired terminal that could not be moved to the ledger (ledger
        # full of protected ids) still protects the id: the terminal entry
        # itself marks it expired.
        entry = self._terminal_runs.get(run_id)
        if entry is not None and entry[2] <= now:
            return True
        return False

    def _is_expired_run(self, run_id: str) -> bool:
        with self._terminal_lock:
            return self._is_expired_run_locked(run_id)

    def _missing_run_error(self, run_id: str) -> ServiceError:
        # The registry's own protection ledger may know the id expired even
        # before the service tombstone does (e.g. an unrelated add() swept it).
        # Mirror that fact into the service tombstone so the expiry survives
        # the registry ledger's turnover, then report RUN_EXPIRED.
        if self.run_registry.is_expired(run_id):
            self._remember_expired(run_id)
            return ServiceError("RUN_EXPIRED", f"run '{run_id}' has expired")
        if self._is_expired_run(run_id):
            return ServiceError("RUN_EXPIRED", f"run '{run_id}' has expired")
        return ServiceError("RUN_NOT_FOUND", f"unknown run '{run_id}'")

    def _fingerprint(self, params: dict[str, Any]) -> str:
        import hashlib
        import json as _json

        # Stable fingerprint without prompt body: query + conversation + max_context + session_allowed
        # Full SHA-256 hexdigest (64 chars) — not truncated.
        data = {
            "q": params.get("query", ""),
            "c": params.get("conversation", []),
            "m": params.get("max_context_chars", 0),
            "s": sorted(params.get("session_allowed_tools", []) or []),
        }
        raw = _json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def _store_terminal(
        self, run_id: str, payload: dict[str, Any], fingerprint: str = ""
    ) -> tuple[dict[str, Any] | None, str, str]:
        """Atomically publish a terminal payload with first-terminal-wins.

        Returns ``(winner, winner_fingerprint, outcome)`` where outcome is one
        of:
          "stored"   — ``payload`` became the terminal (first publish);
          "existing" — a still-valid terminal already exists and wins; the
                       returned winner is that existing terminal and the caller
                       must use it for the RPC response;
          "expired"  — the run_id is tombstoned (or its only terminal already
                       expired) and is still inside the protection window: the
                       publish is REJECTED because accepting it would resurrect
                       an expired run. winner is None; the caller must treat
                       the id as RUN_EXPIRED and never surface the rejected
                       payload as a normal protocol response;
          "capacity" — the expired-run protection ledger is full of
                       still-protected ids and the LRU terminal that would have
                       been evicted cannot be forgotten: the publish fails
                       closed. winner is None; the caller must surface an
                       explicit fail-closed error (idempotency is worth more
                       than this slot).

        Invariant: a run_id may be live, terminal, or tombstoned — never two
        of them at once. Live and terminal may temporarily coexist only during
        the publish-before-remove handoff inside answer_start/continue.
        Sweep expired entries before the LRU eviction; TTL is fixed (no
        sliding on get).
        """
        with self._terminal_lock:
            now = time.monotonic()
            # Sweep expired before LRU calculation. Move each expired terminal
            # to the protection ledger; only when the ledger accepts it is the
            # terminal entry dropped. If the ledger is full of protected ids we
            # KEEP the expired terminal entry — it still marks the id expired,
            # so a late writer cannot resurrect it.
            expired = [
                k for k, (_, _, exp) in self._terminal_runs.items() if exp <= now
            ]
            for k in expired:
                if self._remember_expired_locked(k):
                    self._terminal_runs.pop(k, None)
            existing = self._terminal_runs.get(run_id)
            if existing is not None:
                e_payload, e_fp, e_exp = existing
                if now <= e_exp:
                    # First-terminal-wins: return existing winner without moving
                    # recency (get moves recency, but a store attempt does not).
                    return e_payload, e_fp, "existing"
                # The id's only terminal already expired (it stayed resident
                # because the ledger is full): the id is protected.
                if self._remember_expired_locked(run_id):
                    self._terminal_runs.pop(run_id, None)
                return None, "", "expired"
            if self._is_expired_run_locked(run_id):
                return None, "", "expired"
            # Enforce max size using true LRU (least recently used = first key).
            if len(self._terminal_runs) >= self._terminal_max_entries:
                lru_key = next(iter(self._terminal_runs))
                if self._remember_expired_locked(lru_key):
                    self._terminal_runs.pop(lru_key, None)
                else:
                    # Cannot evict without losing protection: fail closed.
                    return None, "", "capacity"
            expiry = now + self._terminal_ttl_seconds
            self._terminal_runs[run_id] = (payload, fingerprint, expiry)
            return payload, fingerprint, "stored"

    def _publish_terminal(
        self, run_id: str, payload: dict[str, Any], fingerprint: str = ""
    ) -> tuple[dict[str, Any] | None, str, str]:
        """Alias for _store_terminal — both return the final winner + outcome."""
        return self._store_terminal(run_id, payload, fingerprint)

    def _publish_terminal_outcome(
        self, run_id: str, payload: dict[str, Any], fingerprint: str = ""
    ) -> dict[str, Any]:
        """Publish a terminal and normalize the outcome for RPC callers.

        Lock order: terminal (inside _store_terminal) -> pending -> registry.
        ``stored``/``existing``: terminal protects, live can be removed.
        ``expired``: existing tombstone or expired terminal protects, live
        removal is safe and the caller sees RUN_EXPIRED.
        ``capacity``: no terminal slot and tombstone ledger is full of
        still-protected ids — the live entry must be atomically moved to a
        protected state before it is removed. ``retire_protected`` records
        the id in the registry graveyard if there is space and removes the
        live entry, otherwise it keeps the live entry as a cancelled,
        back-dated expired resident so ``get``/``is_expired`` keep reporting
        RUN_EXPIRED. In neither sub-case is the live entry dropped without
        a protection marker, and the pending cancel is always cleared.
        """
        winner, _, outcome = self._store_terminal(run_id, payload, fingerprint)
        # Pending is cleared first (terminal -> pending -> registry)
        with self._pending_cancel_lock:
            self._pending_cancels.pop(run_id, None)
        if outcome == "capacity":
            # Atomically protect current run_id before dropping live
            self.run_registry.retire_protected(run_id)
            raise ServiceError(
                "BACKEND_CAPACITY",
                "expired-run protection ledger is full; refusing new work "
                "to preserve idempotency",
            )
        if outcome == "expired":
            # Tombstone or expired terminal already protects the id
            self.run_registry.remove(run_id)
            raise ServiceError("RUN_EXPIRED", f"run '{run_id}' has expired")
        # stored / existing: terminal protects
        self.run_registry.remove(run_id)
        assert winner is not None
        return winner

    def _get_terminal(self, run_id: str) -> tuple[dict[str, Any], str] | None:
        with self._terminal_lock:
            entry = self._terminal_runs.get(run_id)
            if entry is None:
                return None
            payload, fp, exp = entry
            if time.monotonic() > exp:
                # Move to the protection ledger; if the ledger is full the
                # expired entry itself keeps marking the id expired (protection
                # is retained and the terminal body is no longer returned).
                if self._remember_expired_locked(run_id):
                    self._terminal_runs.pop(run_id, None)
                return None
            # LRU recency for eviction order, but TTL is fixed (do not extend expiry)
            # Move to end for LRU without changing expiry
            self._terminal_runs.pop(run_id, None)
            self._terminal_runs[run_id] = (payload, fp, exp)
            return payload, fp

    def _store_completed(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        # Backward-compat wrapper — fingerprint empty means any fingerprint matches
        winner, _, _outcome = self._store_terminal(run_id, payload, "")
        assert winner is not None
        return winner

    def _get_completed(self, run_id: str) -> dict[str, Any] | None:
        ent = self._get_terminal(run_id)
        if ent is None:
            return None
        payload, _fp = ent
        return payload

    def _assemble_agent_result(
        self, outcome: dict[str, Any], provider: Any | None
    ) -> dict[str, Any]:
        def _as_int(value: Any, default: int) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        def _as_float(value: Any, default: float) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return default

        sources_raw = list(outcome.get("sources") or [])
        sources = [
            GroundingSource(
                id=str(item["id"]),
                file_path=str(item["file_path"]),
                start_line=_as_int(item.get("start_line"), 1),
                heading_path=[str(h) for h in item.get("heading_path") or []],
                content=str(item.get("content") or ""),
                rank=_as_int(item.get("rank"), 0),
                score=_as_float(item.get("score"), 0.0),
            )
            for item in sources_raw
        ]
        text = str(outcome.get("text") or "")
        answer, citations, warning = normalize_citations(text, sources)
        if not answer:
            raise ServiceError("LLM_BAD_RESPONSE", "Provider returned an empty answer")
        activity = list(outcome.get("activity") or [])
        successful_tools = any(entry.get("status") == "success" for entry in activity)
        # Mirror DeepAnswerEngine's insufficiency guard: without gathered
        # evidence the model must not fall back to general knowledge. A
        # successful external (MCP) tool is legitimate grounding too — the
        # answer stands when the vault had nothing but a tool delivered.
        if (
            not sources
            and not successful_tools
            and "충분한 근거를 찾지 못" not in answer
        ):
            answer = "볼트에서 충분한 근거를 찾지 못했습니다."
        if len(answer) > 32000:
            raise ServiceError("ANSWER_TOO_LARGE", "Provider answer is too large")
        if citations and successful_tools:
            grounding_kind = "mixed"
        elif citations:
            grounding_kind = "vault"
        elif successful_tools:
            grounding_kind = "tool"
        else:
            grounding_kind = "none"
        provider_id = str(
            outcome.get("provider") or getattr(provider, "provider_id", "") or ""
        )
        model_name = str(outcome.get("model") or getattr(provider, "model", "") or "")
        return {
            "answer": answer,
            "citations": citations,
            "evidence": [source.evidence() for source in sources],
            "provider": provider_id,
            "model": model_name,
            "grounded": bool(citations),
            "groundingKind": grounding_kind,
            "toolActivity": activity,
            "diagnostics": {
                "deep": True,
                "structured": True,
                "turns": _as_int(outcome.get("turns"), 0),
                "tool_calls": _as_int(outcome.get("tool_calls"), 0),
                "retrieved_count": len(sources),
                "context_chars": sum(
                    len(str(s.get("content") or "")) for s in sources_raw
                ),
                "answer_chars": len(answer),
                **({"citation_warning": warning} if warning else {}),
            },
        }

    def _apply_search_config(self, params: dict[str, Any]) -> dict[str, Any]:
        integer_fields = {
            "bm25_top_k": "bm25TopK",
            "vector_top_k": "vectorTopK",
            "final_top_k": "finalTopK",
            "rrf_k": "rrfK",
            "max_chunks_per_file": "maxChunksPerFile",
        }
        for attribute, key in integer_fields.items():
            if key in params:
                try:  # noqa: SIM105 — ast-grep guard recognition prefers try/except
                    setattr(self.config, attribute, max(1, int(params[key])))
                except (TypeError, ValueError):
                    pass
        if "titleRrfWeight" in params:
            try:  # noqa: SIM105 — ast-grep guard recognition prefers try/except
                self.config.title_rrf_weight = max(0.0, float(params["titleRrfWeight"]))
            except (TypeError, ValueError):
                pass
        if "prefixFallback" in params:
            self.config.prefix_fallback = bool(params["prefixFallback"])
        if "includeGlobs" in params:
            self.config.include_globs = [str(value) for value in params["includeGlobs"]]
        if "excludeGlobs" in params:
            self.config.exclude_globs = [str(value) for value in params["excludeGlobs"]]
        if "wikiFolders" in params:
            self.config.wiki_folders = [
                str(value).strip().rstrip("/").replace("\\", "/")
                for value in params["wikiFolders"]
                if str(value).strip()
            ]
        if "answerProvider" in params and str(params["answerProvider"]) in {
            "openai",
            "opencode-go",
            "deepseek",
        }:
            self.config.llm_provider = str(params["answerProvider"])
        if "answerModel" in params and str(params["answerModel"]).strip():
            self.config.llm_model = str(params["answerModel"]).strip()[:256]
        if "answerReasoningEffort" in params:
            effort = str(params["answerReasoningEffort"]).strip().lower()
            self.config.reasoning_effort = (
                effort
                if effort in {"auto", "none", "low", "medium", "high", "xhigh", "max"}
                else ""
            )
        for key, attribute, minimum, maximum in (
            ("answerMaxContextChars", "llm_max_context_chars", 8000, 32000),
            ("answerMaxOutputTokens", "llm_max_output_tokens", 128, 8000),
        ):
            if key in params:
                try:  # noqa: SIM105 — ast-grep guard recognition prefers try/except
                    setattr(
                        self.config,
                        attribute,
                        max(minimum, min(maximum, int(params[key]))),
                    )
                except (TypeError, ValueError):
                    pass
        if "answerTimeoutSeconds" in params:
            try:  # noqa: SIM105 — ast-grep guard recognition prefers try/except
                self.config.llm_timeout_seconds = max(
                    5.0, min(60.0, float(params["answerTimeoutSeconds"]))
                )
            except (TypeError, ValueError):
                pass
        if "answerProjectRules" in params or "projectRules" in params:
            # Hot-updatable system-instruction section; bounded on both sides
            # (plugin clamps to 32000 as well). ``answerProjectRules`` is the
            # canonical key matching settings.answerProjectRules;
            # ``projectRules`` stays as a one-release compatibility alias.
            value = params.get("answerProjectRules", params.get("projectRules"))
            if isinstance(value, str):
                cleaned = "".join(
                    ch
                    for ch in value.replace("\r\n", "\n")
                    if ch >= " " or ch in "\t\n"
                )
                self.config.project_rules = cleaned[:32000]
        return {"applied": True, **self.status()}

    def _rebuild_all(self) -> dict[str, Any]:
        if self.index is None:
            raise RuntimeError("Search index is unavailable")
        result = self.index.rebuild_all()
        self.index_rebuild_reason = None
        self._refresh_index_compatibility()
        return result

    def _rebuild_vectors(self) -> dict[str, Any]:
        if self.index is None:
            raise RuntimeError("Search index is unavailable")
        result = self.index.rebuild_vectors()
        self.index_rebuild_reason = None
        self._refresh_index_compatibility()
        return result

    def _reconcile(self, mode: str) -> dict[str, Any]:
        if self.index is None:
            raise RuntimeError("Search index is unavailable")
        result = self.index.reconcile(mode=mode)
        if result.get("rebuild_required"):
            reason = str(result.get("reason") or "index rebuild required")
            self.index_rebuild_reason = reason
            self.index_problems = [reason]
            self.recommended_action = classify_index_problems([reason])
            self.index_validation_state = "incompatible"
        else:
            self.pending_recovery_warning = None
            self._refresh_index_compatibility()
        return result

    def _sync_paths(self, changed: list[str], deleted: list[str]) -> dict[str, Any]:
        if self.index is None:
            raise RuntimeError("Search index is unavailable")
        result = self.index.sync_paths(changed, deleted)
        if result.get("rebuild_required"):
            reason = str(result.get("reason") or "index rebuild required")
            self.index_rebuild_reason = reason
            self.index_problems = [reason]
            self.recommended_action = classify_index_problems([reason])
            self.index_validation_state = "incompatible"
        else:
            self.pending_recovery_warning = None
            self._refresh_index_compatibility()
        return result

    def _run_index_operation(self, state: str, operation: Callable[[], Any]) -> Any:
        previous = self.state
        self._index_operation_active = True
        self.state = state
        self.event_sink("state", self.status())
        try:
            result = operation()
            if isinstance(result, dict):
                for key in ("files", "chunks", "vector_chunks"):
                    if key in result:
                        self._cached_counts[key] = result[key]
            self.state = "ready" if self.config.db_path.exists() else "ready_no_index"
            self.error = None
            return result
        except Exception as exc:
            self.state = previous if previous.startswith("ready") else "ready"
            self.error = f"{type(exc).__name__}: {exc}"
            # Do not blindly clear the incompatibility cache: a rejected
            # rebuild (e.g. tokenizer/scope mismatch) leaves the on-disk index
            # unchanged, so re-validate against the actual disk state instead
            # of reporting a false "compatible" immediately after.
            with contextlib.suppress(Exception):
                self._refresh_index_compatibility()
            raise
        finally:
            # A completed index operation counts as activity: without this, the
            # standalone idle-exit watcher measures only from the operation's
            # start and can shut the process down right after a long rebuild.
            self.last_activity = time.monotonic()
            self._refresh_cached_counts()
            self._index_operation_active = False
            self.event_sink("state", self.status())

    def _refresh_cached_counts(self) -> None:
        try:
            self._cached_counts = index_counts(self.config.db_path)
            self._count_available = True
        except (sqlite3.Error, OSError):
            self._cached_counts = {"files": 0, "chunks": 0, "vector_chunks": 0}
            self._count_available = False
        meta = load_metadata(self.config.metadata_path)
        updated = meta.get("updated_at") if meta else None
        self._last_updated_at = updated if isinstance(updated, (int, float)) else None

    def _refresh_index_compatibility(self) -> None:
        """Validate the on-disk index and cache the result.

        Full validation restores the USEARCH vector index, which is expensive,
        so it must only run at initialization/reconcile/rebuild boundaries and
        never on every status call. When the model is not loaded (fresh lazy
        start) the dimension is unknown and the state stays ``pending``.
        """
        if (
            self.search_engine is None
            or self.index is None
            or self.model.dimension is None
        ):
            if self.index_rebuild_reason is None:
                self.index_validation_state = "pending"
            return
        try:
            problems = validate_index_files(
                self.config,
                self.model.dimension,
                check_scope=False,
                effective_provider=self.model.effective_provider(),
            )
        except Exception as exc:
            problems = [f"index validation failed: {type(exc).__name__}: {exc}"]
        if problems:
            self.index_problems = list(problems)
            self.recommended_action = classify_index_problems(problems)
            self.index_validation_state = "incompatible"
            self.index_rebuild_reason = "; ".join(problems)
        else:
            self.index_problems = []
            self.recommended_action = None
            self.index_validation_state = "compatible"
            self.index_rebuild_reason = None

    def _recover_pending_paths(self) -> dict[str, Any]:
        if self.index is None:
            return {"recovered": 0}
        try:
            result = self.index.recover_pending_paths()
            self.pending_recovery_warning = None
            return result
        except Exception as exc:
            self.pending_recovery_warning = f"{type(exc).__name__}: {exc}"
            self.event_sink(
                "warning",
                {
                    "code": "PENDING_RECOVERY_RETRY_REQUIRED",
                    "message": self.pending_recovery_warning,
                },
            )
            return {
                "recovered": 0,
                "retry_required": True,
                "warning": self.pending_recovery_warning,
            }

    def _index_event(self, event: str, data: dict[str, Any]) -> None:
        self.event_sink(event, data)
