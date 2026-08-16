from __future__ import annotations

import contextlib
import sqlite3
import threading
import time
from collections.abc import Callable
from typing import Any

from .config import SearchConfig
from .database import index_counts
from .deep_answer import (  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
    DEEP_SYSTEM_PROMPT,
    DeepAnswerEngine,
    grep_vault,
)
from .errors import (
    ServiceError,  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
)
from .grounding import build_grounding_context, build_prompt, normalize_citations
from .index_metadata import classify_index_problems, validate_index_files
from .indexing import IndexManager
from .llm import ProviderError, create_provider
from .model_manager import ModelManager
from .protocol import ProtocolError, validate_answer_params
from .search import IndexCompatibilityError, SearchEngine


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
        self._count_available = False
        self._index_operation_active = False
        self._capabilities: dict[str, bool] | None = None
        self._idle_watchdog: threading.Thread | None = None
        if self.config.model_idle_timeout_seconds > 0:
            self._idle_watchdog = threading.Thread(target=self._watchdog, daemon=True)
            self._idle_watchdog.start()
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
            path = (root / rel_path.replace("\\", "/")).resolve()
            if not path.is_relative_to(root):
                raise ValueError(f"file path escapes the vault: {rel_path}")
            if not path.is_file():
                raise ValueError(f"file not found: {rel_path}")
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
            max_output_tokens=self.config.llm_max_output_tokens,
            timeout_seconds=self.config.llm_timeout_seconds,
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
