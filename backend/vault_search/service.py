from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .config import SearchConfig
from .database import index_counts
from .indexing import IndexManager
from .model_manager import ModelManager
from .search import IndexCompatibilityError, SearchEngine


class SearchService:
    def __init__(self, config: SearchConfig, event_sink: Callable[[str, dict[str, Any]], None]):
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
        self.index_rebuild_reason: str | None = None

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
            self.index = IndexManager(self.config, self.model, self.kiwi, self._index_event)
            lexical = self.index.ensure_lexical_index()
            self.index_rebuild_reason = str(lexical.get("reason")) \
                if lexical.get("rebuild_required") else None
            self.search_engine = SearchEngine(self.config, self.model, self.kiwi)
            self.state = "ready" if self.config.db_path.exists() else "ready_no_index"
            self.error = None
            self.last_heartbeat = time.monotonic()
            self.event_sink("ready", {
                **self.status(),
                "model_load_seconds": round(time.time() - started, 3),
            })
        except Exception as exc:
            self.state = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            self.event_sink("error", self.status())
        finally:
            self.ready_event.set()

    def status(self) -> dict[str, Any]:
        counts = index_counts(self.config.db_path)
        return {
            "state": self.state,
            "error": self.error,
            "model_id": self.config.model_id,
            "device": self.model.device,
            "dimension": self.model.dimension,
            "uptime_seconds": round(time.time() - self.started_at, 3),
            **counts,
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
        if self.state == "idle":
            if method == "search":
                if self.index_rebuild_reason:
                    raise ServiceError(
                        "INDEX_REBUILD_REQUIRED", self.index_rebuild_reason,
                        {"problems": [self.index_rebuild_reason]})
                self.start_initialization()
                raise ServiceError("MODEL_LOADING", "Embedding model is loading after the first search request")
            raise ServiceError("MODEL_NOT_LOADED", "Embedding model is not loaded")
        if self.state in {"starting", "loading_model"}:
            raise ServiceError("MODEL_LOADING", "Embedding model is still loading")
        if self.state == "error":
            raise ServiceError("BACKEND_ERROR", self.error or "Backend initialization failed")
        if self.index is None or self.search_engine is None:
            raise ServiceError("BACKEND_NOT_READY", "Search backend is not ready")

        with self.operation_lock:
            if method == "search":
                if self.index_rebuild_reason:
                    raise ServiceError(
                        "INDEX_REBUILD_REQUIRED", self.index_rebuild_reason,
                        {"problems": [self.index_rebuild_reason]})
                query = str(params.get("query", "")).strip()
                if not query:
                    raise ServiceError("INVALID_QUERY", "Query must not be empty")
                match_mode = str(params.get("match_mode", "any"))
                if match_mode not in {"any", "all", "phrase"}:
                    raise ServiceError(
                        "INVALID_PARAMS", "match_mode must be any, all, or phrase")
                try:
                    results = self.search_engine.search(
                        query,
                        top_k=int(params.get("top_k") or self.config.final_top_k),
                        verbose=bool(params.get("verbose", False)),
                        match_mode=match_mode,
                    )
                except FileNotFoundError as exc:
                    raise ServiceError("INDEX_MISSING", str(exc)) from exc
                except IndexCompatibilityError as exc:
                    raise ServiceError("INDEX_REBUILD_REQUIRED", str(exc), {"problems": exc.problems}) from exc
                return {
                    "mode": "hybrid",
                    "model": self.config.model_id,
                    "device": self.model.device,
                    "results": results,
                }
            if method == "preview_scope":
                return self.index.preview_scope()
            if method == "reconcile":
                return self._run_index_operation("reconciling", self.index.reconcile)
            if method == "sync_paths":
                return self._run_index_operation(
                    "syncing",
                    lambda: self.index.sync_paths(
                        [str(x) for x in params.get("changed", [])],
                        [str(x) for x in params.get("deleted", [])],
                    ),
                )
            if method == "rebuild_all":
                return self._run_index_operation("rebuilding", self._rebuild_all)
            if method == "rebuild_vectors":
                return self._run_index_operation("rebuilding_vectors", self.index.rebuild_vectors)
            if method == "apply_search_config":
                return self._apply_search_config(params)
        raise ServiceError("UNKNOWN_METHOD", f"Unknown method: {method}")

    def _apply_search_config(self, params: dict[str, Any]) -> dict[str, Any]:
        integer_fields = {
            "bm25_top_k": "bm25TopK", "vector_top_k": "vectorTopK",
            "final_top_k": "finalTopK", "rrf_k": "rrfK",
            "max_chunks_per_file": "maxChunksPerFile",
        }
        for attribute, key in integer_fields.items():
            if key in params:
                setattr(self.config, attribute, max(1, int(params[key])))
        if "titleRrfWeight" in params:
            self.config.title_rrf_weight = max(0.0, float(params["titleRrfWeight"]))
        if "prefixFallback" in params:
            self.config.prefix_fallback = bool(params["prefixFallback"])
        if "includeGlobs" in params:
            self.config.include_globs = [str(value) for value in params["includeGlobs"]]
        if "excludeGlobs" in params:
            self.config.exclude_globs = [str(value) for value in params["excludeGlobs"]]
        return {"applied": True, **self.status()}

    def _rebuild_all(self) -> dict[str, Any]:
        if self.index is None:
            raise RuntimeError("Search index is unavailable")
        result = self.index.rebuild_all()
        self.index_rebuild_reason = None
        return result

    def _run_index_operation(self, state: str, operation: Callable[[], Any]) -> Any:
        previous = self.state
        self.state = state
        self.event_sink("state", self.status())
        try:
            result = operation()
            self.state = "ready" if self.config.db_path.exists() else "ready_no_index"
            self.error = None
            return result
        except Exception as exc:
            self.state = previous if previous.startswith("ready") else "ready"
            self.error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self.event_sink("state", self.status())

    def _index_event(self, event: str, data: dict[str, Any]) -> None:
        self.event_sink(event, data)


class ServiceError(RuntimeError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)
