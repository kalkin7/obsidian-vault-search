from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sqlite3
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from .chunking import DocumentChunk, chunk_document
from .config import SearchConfig
from .database import (
    STATE_SCHEMA_VERSION,
    compute_hash,
    delete_files,
    ensure_lexical_schema,
    ensure_state_schema,
    index_counts,
    init_db,
    insert_chunk,
    lexical_index_problems,
    read_index_metadata,
    state_schema_problems,
    upsert_file_fields,
    upsert_file_state,
    write_index_metadata,
)
from .document_fields import extract_file_fields, heading_tokens
from .errors import (
    ServiceError,  # pyright: ignore[reportMissingImports] — resolves fine (verified via basedpyright CLI); stale LSP module map
)
from .index_metadata import (
    LEXICAL_SCHEMA_VERSION,
    build_metadata,
    expected_metadata,
    load_metadata,
    validate_index_files,
    validate_metadata,
    write_metadata,
)
from .model_manager import ModelManager
from .scope import (
    is_in_scope,
    iter_vault_files,
    normalize_relative,
    resolve_inside_vault,
)
from .tokenizer import tokenize

Progress = Callable[[str, dict[str, Any]], None]
LOGGER = logging.getLogger(__name__)
PENDING_RECONCILE_LIMIT = 1000
PENDING_BATCH_SIZE = 400
REPLACE_MANIFEST = "replace-operation.json"
STABLE_READ_ATTEMPTS = 3
OPERATION_ARTIFACT = re.compile(
    r"(?:\.[0-9a-f]{32}\.tmp(?:\.tmp)?(?:-journal|-wal|-shm)?$|"
    r"\.backup\.[0-9a-f]{32}$)"
)


class IndexManager:
    def __init__(
        self,
        config: SearchConfig,
        model: ModelManager,
        kiwi: Any,
        progress: Progress | None = None,
    ):
        self.config = config
        self.model = model
        self.kiwi = kiwi
        self.progress = progress or (lambda _event, _data: None)

    def status(self) -> dict[str, Any]:
        counts = index_counts(self.config.db_path)
        counts.update(
            {
                "db_exists": self.config.db_path.exists(),
                "vector_exists": self.config.vector_path.exists(),
                "metadata": load_metadata(self.config.metadata_path),
                "db_bytes": self.config.db_path.stat().st_size
                if self.config.db_path.exists()
                else 0,
                "vector_bytes": self.config.vector_path.stat().st_size
                if self.config.vector_path.exists()
                else 0,
            }
        )
        return counts

    def ensure_state_schema(self) -> dict[str, Any]:
        if not self.config.db_path.exists():
            return {"migrated": False}
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version > STATE_SCHEMA_VERSION:
                return {
                    "migrated": False,
                    "rebuild_required": True,
                    "reason": f"Unsupported future state schema version {version}",
                }
            if not state_schema_problems(connection):
                return {"migrated": False}
        except sqlite3.Error:
            pass
        finally:
            connection.close()

        db_temp = self._operation_temp("chunks.db.state-building")
        try:
            self._remove_paths(db_temp)
            _ = shutil.copy2(self.config.db_path, db_temp)
            connection = sqlite3.connect(str(db_temp))
            try:
                ensure_state_schema(connection)
                connection.commit()
                problems = self._state_db_problems(db_temp)
                if problems:
                    raise RuntimeError(
                        "State migration validation failed: " + "; ".join(problems)
                    )
            finally:
                connection.close()
            self._atomic_replace(
                [(db_temp, self.config.db_path)],
                lambda: self._state_db_problems(self.config.db_path),
            )
        except Exception as exc:
            self._remove_paths(db_temp)
            return {
                "migrated": False,
                "rebuild_required": True,
                "reason": f"State migration failed: {type(exc).__name__}: {exc}",
            }
        return {"migrated": True}

    def ensure_lexical_index(self) -> dict[str, Any]:
        if not self.config.db_path.exists():
            return {"migrated": False, "files": 0}
        file_metadata = load_metadata(self.config.metadata_path)
        db_metadata = read_index_metadata(self.config.db_path)
        actual = file_metadata or db_metadata
        if (
            file_metadata
            and db_metadata
            and file_metadata.get("lexical_schema_version") == LEXICAL_SCHEMA_VERSION
            and db_metadata.get("lexical_schema_version") == LEXICAL_SCHEMA_VERSION
        ):
            connection = sqlite3.connect(str(self.config.db_path))
            try:
                fast_path_problems = lexical_index_problems(connection)
                if not fast_path_problems:
                    return {
                        "migrated": False,
                        "files": index_counts(self.config.db_path)["files"],
                    }
            except sqlite3.Error:
                pass
            finally:
                connection.close()
        db_temp = self._operation_temp("chunks.db.lexical-building")
        metadata_temp = self._operation_temp("metadata.json.lexical-building")
        try:
            self._remove_paths(db_temp, metadata_temp)
            _ = shutil.copy2(self.config.db_path, db_temp)
            connection = sqlite3.connect(str(db_temp))
        except Exception as exc:
            self._remove_paths(db_temp, metadata_temp)
            return {
                "migrated": False,
                "rebuild_required": True,
                "reason": f"Lexical migration setup failed: {type(exc).__name__}: {exc}",
            }
        try:
            rows = [
                str(row[0])
                for row in connection.execute(
                    "SELECT file_path FROM file_state ORDER BY file_path"
                ).fetchall()
            ]
            self.progress("lexical_migration_started", {"files": len(rows)})
            ensure_lexical_schema(connection)
            _ = connection.execute("DELETE FROM file_fields_fts")
            _ = connection.execute("DELETE FROM file_fields")
            _ = connection.execute("DELETE FROM chunk_headings_fts")
            for relative in rows:
                target = resolve_inside_vault(self.config.vault_path, relative)
                text = (
                    target.read_text(encoding="utf-8", errors="replace")
                    if target.exists()
                    else ""
                )
                fields = extract_file_fields(relative, text, self.kiwi)
                upsert_file_fields(
                    connection,
                    relative,
                    fields.basename,
                    fields.directory,
                    fields.aliases,
                    fields.tags,
                    fields.properties,
                )
            chunk_rows = connection.execute(
                "SELECT id, content, heading_path FROM chunks ORDER BY id"
            ).fetchall()
            _ = connection.execute("DELETE FROM chunks_fts")
            for chunk_id, content, raw_heading_path in chunk_rows:
                parsed = json.loads(str(raw_heading_path))
                headings = (
                    tuple(str(value) for value in parsed)
                    if isinstance(parsed, list)
                    else ()
                )
                _ = connection.execute(
                    "INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)",
                    (int(chunk_id), " ".join(tokenize(str(content), self.kiwi))),
                )
                _ = connection.execute(
                    "INSERT INTO chunk_headings_fts(rowid, heading_tokens) VALUES (?, ?)",
                    (int(chunk_id), " ".join(heading_tokens(headings, self.kiwi))),
                )
            _ = connection.execute("DROP TABLE IF EXISTS titles_fts")
            _ = connection.execute("DROP TABLE IF EXISTS file_titles")
            metadata = dict(actual or {})
            metadata.update(
                {
                    "lexical_schema_version": LEXICAL_SCHEMA_VERSION,
                    "index_generation": uuid.uuid4().hex,
                    "updated_at": time.time(),
                }
            )
            write_index_metadata(connection, metadata)
            connection.commit()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            validation = lexical_index_problems(connection)
            if integrity is None or integrity[0] != "ok" or validation:
                raise RuntimeError(
                    "Lexical migration validation failed: " + "; ".join(validation)
                )
            write_metadata(metadata_temp, metadata)
        except Exception as exc:
            connection.rollback()
            connection.close()
            self._remove_paths(db_temp, metadata_temp)
            return {
                "migrated": False,
                "rebuild_required": True,
                "reason": f"Lexical migration failed: {type(exc).__name__}: {exc}",
            }
        finally:
            connection.close()
        try:
            self._atomic_replace(
                [
                    (db_temp, self.config.db_path),
                    (metadata_temp, self.config.metadata_path),
                ],
                self._lexical_install_problems,
            )
        except Exception as exc:
            self._remove_paths(db_temp, metadata_temp)
            return {
                "migrated": False,
                "rebuild_required": True,
                "reason": f"Lexical migration install failed: {type(exc).__name__}: {exc}",
            }
        result = {"migrated": True, "files": len(rows)}
        self.progress("lexical_migration_finished", result)
        return result

    def preview_scope(self) -> dict[str, Any]:
        files = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs
        )
        return {"count": len(files), "sample": files[:30]}

    def rebuild_all(self) -> dict[str, Any]:
        if self.config.db_path.exists():
            state = self.ensure_state_schema()
            if state.get("rebuild_required"):
                # A future (or structurally broken) state schema cannot be
                # migrated in place. rebuild_all builds a fresh DB from the
                # vault anyway, so back up the unreadable DB and continue
                # instead of blocking the recovery the UI recommends.
                reason = str(state.get("reason") or "State schema migration failed")
                self._archive_unreadable_db(reason)
        dimension = self._dimension()
        files = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs
        )
        self.progress("rebuild_started", {"files": len(files)})
        db_temp = self._operation_temp("chunks.db.building")
        vector_temp = self._operation_temp("vectors.usearch.building")
        metadata_temp = self._operation_temp("metadata.json.building")
        self._remove_paths(db_temp, vector_temp, metadata_temp)

        try:
            connection = init_db(db_temp)
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        chunk_ids: list[int] = []
        chunk_contents: list[str] = []
        try:
            for number, relative in enumerate(files, 1):
                target = resolve_inside_vault(self.config.vault_path, relative)
                text, stat = self._read_stable(target)
                chunks = self._chunks(text, relative)
                for chunk_index, chunk in enumerate(chunks):
                    lexical_only = chunk.lexical_only
                    row_id = insert_chunk(
                        connection,
                        relative,
                        chunk_index,
                        chunk.content,
                        tokenize(chunk.content, self.kiwi),
                        chunk.heading_path,
                        chunk.start_line,
                        chunk.end_line,
                        chunk.embedding_text,
                        lexical_only,
                        heading_tokens(chunk.heading_path, self.kiwi),
                    )
                    if not lexical_only:
                        chunk_ids.append(row_id)
                        chunk_contents.append(chunk.embedding_text)
                upsert_file_state(
                    connection,
                    relative,
                    compute_hash(text),
                    len(chunks),
                    stat.st_size,
                    stat.st_mtime_ns,
                )
                fields = extract_file_fields(relative, text, self.kiwi)
                upsert_file_fields(
                    connection,
                    relative,
                    fields.basename,
                    fields.directory,
                    fields.aliases,
                    fields.tags,
                    fields.properties,
                )
                if number % 100 == 0:
                    connection.commit()
                    self.progress(
                        "rebuild_progress",
                        {
                            "processed_files": number,
                            "total_files": len(files),
                            "chunks": len(chunk_ids),
                        },
                    )
            connection.commit()
        except Exception:
            connection.close()
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        finally:
            connection.close()

        try:
            self.progress("embedding_started", {"chunks": len(chunk_contents)})
            vectors = self._encode_documents(chunk_contents, dimension)
            self.progress("embedding_finished", {"chunks": len(chunk_contents)})
            vector_index = self._build_vector_index(chunk_ids, vectors, vector_temp)
            previous = load_metadata(self.config.metadata_path)
            metadata = build_metadata(
                self.config,
                dimension,
                vector_temp,
                len(vector_index),
                previous,
                effective_provider=self.model.effective_provider(),
            )
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace(
                [
                    (db_temp, self.config.db_path),
                    (vector_temp, self.config.vector_path),
                    (metadata_temp, self.config.metadata_path),
                ],
                lambda: validate_index_files(
                    self.config,
                    dimension,
                    effective_provider=self.model.effective_provider(),
                ),
            )
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise

        result = self.status()
        self.progress("rebuild_finished", result)
        return result

    def rebuild_vectors(self) -> dict[str, Any]:
        dimension = self._dimension()
        if not self.config.db_path.exists():
            # A vectors-only rebuild cannot create the lexical base index;
            # surface the coded error so the CLI and settings tab recommend
            # rebuild_all instead of looping on rebuild_vectors.
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                "chunks.db is missing; run rebuild_all",
                {"problems": ["index missing"], "recommended_action": "rebuild_all"},
            )
        lexical = self.ensure_lexical_index()
        if lexical.get("rebuild_required"):
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                str(lexical.get("reason") or "Lexical migration required"),
                {
                    "problems": ["lexical migration required"],
                    "recommended_action": "rebuild_all",
                },
            )
        expected = expected_metadata(
            self.config, dimension, effective_provider=self.model.effective_provider()
        )
        structural_keys = {
            "schema_version",
            "lexical_schema_version",
            "chunking_strategy",
            "chunker_version",
            "chunk_chars",
            "chunk_overlap",
            "tokenizer_version",
            "scope_config_hash",
        }
        structural_problems: list[str] = []
        for source, metadata in (
            ("metadata.json", load_metadata(self.config.metadata_path)),
            ("SQLite", read_index_metadata(self.config.db_path)),
        ):
            if metadata is None:
                structural_problems.append(f"{source} metadata missing")
                continue
            structural_problems.extend(
                f"{source} {problem}"
                for problem in validate_metadata(metadata, expected, check_scope=True)
                if problem.split(":", 1)[0] in structural_keys
            )
        if structural_problems:
            raise ServiceError(
                "INDEX_REBUILD_REQUIRED",
                "Index structure mismatch; run rebuild_all: "
                + "; ".join(structural_problems),
                {"problems": structural_problems, "recommended_action": "rebuild_all"},
            )
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            rows = connection.execute(
                "SELECT id, embedding_text FROM chunks WHERE lexical_only = 0 ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        ids = [row[0] for row in rows]  # SQLite INTEGER chunk ids
        contents = [str(row[1]) for row in rows]
        self.progress("embedding_started", {"chunks": len(contents)})
        vectors = self._encode_documents(contents, dimension)
        self.progress("embedding_finished", {"chunks": len(contents)})
        db_temp = self._operation_temp("chunks.db.vector-building")
        vector_temp = self._operation_temp("vectors.usearch.building")
        metadata_temp = self._operation_temp("metadata.json.building")
        self._remove_paths(db_temp, vector_temp, metadata_temp)
        try:
            _ = shutil.copy2(self.config.db_path, db_temp)
            vector_index = self._build_vector_index(ids, vectors, vector_temp)
            metadata = build_metadata(
                self.config,
                dimension,
                vector_temp,
                len(vector_index),
                load_metadata(self.config.metadata_path),
                effective_provider=self.model.effective_provider(),
            )
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace(
                [
                    (db_temp, self.config.db_path),
                    (vector_temp, self.config.vector_path),
                    (metadata_temp, self.config.metadata_path),
                ],
                lambda: validate_index_files(
                    self.config,
                    dimension,
                    effective_provider=self.model.effective_provider(),
                ),
            )
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        return self.status()

    def reconcile(self, mode: str = "fast") -> dict[str, Any]:
        if mode not in {"fast", "strict"}:
            raise ValueError("mode must be fast or strict")
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            return {
                "rebuild_required": True,
                "reason": "index missing",
                **self.status(),
            }
        state = self.ensure_state_schema()
        if state.get("rebuild_required"):
            return {**state, **self.status()}
        problems = validate_index_files(
            self.config,
            self._dimension(),
            check_scope=False,
            effective_provider=self.model.effective_provider(),
        )
        if problems:
            return {
                "rebuild_required": True,
                "reason": "; ".join(problems),
                **self.status(),
            }

        connection = sqlite3.connect(str(self.config.db_path))
        try:
            existing = {
                str(row[0]): (str(row[1]), int(row[2]), int(row[3]))
                for row in connection.execute(
                    "SELECT file_path, file_hash, file_size, modified_ns FROM file_state"
                ).fetchall()
            }
        finally:
            connection.close()
        current = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs
        )
        current_set = set(current)
        changed: list[str] = []
        stat_updates: list[tuple[str, int, int]] = []
        for relative in current:
            target = resolve_inside_vault(self.config.vault_path, relative)
            stat = target.stat()
            previous = existing.get(relative)
            if (
                mode == "fast"
                and previous is not None
                and previous[1:] == (stat.st_size, stat.st_mtime_ns)
            ):
                continue
            text, stable_stat = self._read_stable(target)
            if previous is None or previous[0] != compute_hash(text):
                changed.append(relative)
            else:
                stat_updates.append(
                    (relative, stable_stat.st_size, stable_stat.st_mtime_ns)
                )
        deleted = [relative for relative in existing if relative not in current_set]
        result = self._drain_pending_paths(changed, deleted)
        if not result.get("rebuild_required") and stat_updates:
            self._apply_stat_updates(stat_updates)
            result.update(self.status())
        result["scanned"] = len(current)
        result["mode"] = mode
        return result

    def recover_pending_paths(self) -> dict[str, Any]:
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            return {"recovered": 0}
        pending_count = self._pending_count()
        if not pending_count:
            return {"recovered": 0}
        if pending_count > PENDING_RECONCILE_LIMIT:
            totals = self.reconcile(mode="strict")
            if totals.get("rebuild_required"):
                return totals
            totals["recovered"] = pending_count
            totals["pending_escalated"] = pending_count
            return totals
        totals = self._drain_pending_paths([], [])
        if totals.get("rebuild_required"):
            return totals
        totals["recovered"] = pending_count
        return totals

    def sync_paths(
        self, changed_paths: list[str], deleted_paths: list[str]
    ) -> dict[str, Any]:
        changed: list[str] = []
        deleted: set[str] = set()
        for raw in deleted_paths:
            try:
                deleted.add(normalize_relative(raw))
            except ValueError:
                continue
        for raw in changed_paths:
            try:
                relative = normalize_relative(raw)
                target = resolve_inside_vault(self.config.vault_path, relative)
            except ValueError:
                continue
            if target.exists() and is_in_scope(
                relative, self.config.include_globs, self.config.exclude_globs
            ):
                changed.append(relative)
            else:
                deleted.add(relative)
        return self._drain_pending_paths(sorted(set(changed)), sorted(deleted))

    def _drain_pending_paths(
        self, changed: list[str], deleted: list[str]
    ) -> dict[str, Any]:
        totals = {"changed": 0, "deleted": 0, "removed_chunks": 0, "added_chunks": 0}
        first = True
        while first or self._read_pending_paths(limit=1):
            result = self._apply_changes(
                changed if first else [], deleted if first else []
            )
            first = False
            if result.get("rebuild_required"):
                return result
            for key in totals:
                totals[key] += result.get(key, 0)
        totals.update(self.status())
        return totals

    def _apply_changes(self, changed: list[str], deleted: list[str]) -> dict[str, Any]:
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            return {
                "rebuild_required": True,
                "reason": "index missing",
                **self.status(),
            }
        state = self.ensure_state_schema()
        if state.get("rebuild_required"):
            return {**state, **self.status()}
        incoming = dict.fromkeys(changed, "changed")
        incoming.update(dict.fromkeys(deleted, "deleted"))
        self._journal_paths(changed, deleted)
        effective: dict[str, str] = {}
        for relative in self._read_pending_paths(limit=PENDING_BATCH_SIZE):
            if relative in incoming:
                effective[relative] = incoming[relative]
                continue
            target = resolve_inside_vault(self.config.vault_path, relative)
            effective[relative] = (
                "changed"
                if target.exists()
                and is_in_scope(
                    relative, self.config.include_globs, self.config.exclude_globs
                )
                else "deleted"
            )
        self._journal_paths(
            [path for path, operation in effective.items() if operation == "changed"],
            [path for path, operation in effective.items() if operation == "deleted"],
        )
        pending = effective
        if not pending:
            return {"changed": 0, "deleted": 0, **self.status()}

        changed_set: list[str] = []
        deleted_paths: list[str] = []
        for relative, operation in sorted(pending.items()):
            if operation == "changed":
                changed_set.append(relative)
            else:
                deleted_paths.append(relative)
        deleted_set = sorted(set(deleted_paths) | set(changed_set))

        dimension = self._dimension()
        problems = validate_index_files(
            self.config,
            dimension,
            check_scope=False,
            effective_provider=self.model.effective_provider(),
        )
        if problems:
            return {
                "rebuild_required": True,
                "reason": "; ".join(problems),
                **self.status(),
            }

        db_temp = self._operation_temp("chunks.db.syncing")
        vector_temp = self._operation_temp("vectors.usearch.syncing")
        metadata_temp = self._operation_temp("metadata.json.syncing")
        self._remove_paths(db_temp, vector_temp, metadata_temp)
        removed_ids: list[int] = []
        new_ids: list[int] = []
        new_contents: list[str] = []
        try:
            _ = shutil.copy2(self.config.db_path, db_temp)
            connection = sqlite3.connect(str(db_temp))
            try:
                removed_ids = delete_files(connection, deleted_set)
                for relative in changed_set:
                    target = resolve_inside_vault(self.config.vault_path, relative)
                    if not target.exists():
                        continue
                    text, stat = self._read_stable(target)
                    chunks = self._chunks(text, relative)
                    for chunk_index, chunk in enumerate(chunks):
                        lexical_only = chunk.lexical_only
                        row_id = insert_chunk(
                            connection,
                            relative,
                            chunk_index,
                            chunk.content,
                            tokenize(chunk.content, self.kiwi),
                            chunk.heading_path,
                            chunk.start_line,
                            chunk.end_line,
                            chunk.embedding_text,
                            lexical_only,
                            heading_tokens(chunk.heading_path, self.kiwi),
                        )
                        if not lexical_only:
                            new_ids.append(row_id)
                            new_contents.append(chunk.embedding_text)
                    upsert_file_state(
                        connection,
                        relative,
                        compute_hash(text),
                        len(chunks),
                        stat.st_size,
                        stat.st_mtime_ns,
                    )
                    fields = extract_file_fields(relative, text, self.kiwi)
                    upsert_file_fields(
                        connection,
                        relative,
                        fields.basename,
                        fields.directory,
                        fields.aliases,
                        fields.tags,
                        fields.properties,
                    )
                connection.commit()
            finally:
                connection.close()
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise

        try:
            from usearch.index import Index

            vector_index = Index.restore(str(self.config.vector_path))
            assert vector_index is not None  # restore failed -> roll back below
            if removed_ids:
                _ = vector_index.remove(np.asarray(removed_ids, dtype=np.int64))
            if new_ids:
                vectors = self._encode_documents(new_contents, dimension)
                _ = vector_index.add(np.asarray(new_ids, dtype=np.int64), vectors)
            _ = vector_index.save(str(vector_temp))
            expected_count = index_counts(db_temp)["vector_chunks"]
            if (
                len(vector_index) != expected_count
                or int(vector_index.ndim) != dimension
            ):
                raise RuntimeError("Incremental vector validation failed")
            metadata = build_metadata(
                self.config,
                dimension,
                vector_temp,
                len(vector_index),
                load_metadata(self.config.metadata_path),
                effective_provider=self.model.effective_provider(),
            )
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace(
                [
                    (db_temp, self.config.db_path),
                    (vector_temp, self.config.vector_path),
                    (metadata_temp, self.config.metadata_path),
                ],
                lambda: validate_index_files(
                    self.config,
                    dimension,
                    effective_provider=self.model.effective_provider(),
                ),
            )
            self._clear_pending_paths(list(pending))
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        return {
            "changed": len(changed_set),
            "deleted": len(deleted_paths),
            "removed_chunks": len(removed_ids),
            "added_chunks": len(new_ids),
            **self.status(),
        }

    def _dimension(self) -> int:
        if self.model.dimension is None:
            raise RuntimeError("Model must be loaded before indexing")
        return self.model.dimension

    def _archive_unreadable_db(self, reason: str) -> None:
        """Move an unreadable/future-schema DB aside so rebuild_all can start fresh.

        The replacement below writes a brand-new generation; the archived file
        keeps forensic evidence without blocking recovery. The archive name is
        deterministic per reason so repeated rebuilds do not accumulate files.
        """
        target = self.config.db_path
        if not target.exists():
            return
        archive = target.with_name(f"chunks.db.unreadable-{uuid.uuid4().hex[:12]}.bak")
        _ = shutil.copy2(target, archive)
        LOGGER.warning("Archived unreadable state DB (%s) to %s", reason, archive.name)

    def _chunks(self, text: str, relative: str) -> list[DocumentChunk]:
        return chunk_document(
            text,
            relative,
            self.config.chunk_chars,
            self.config.chunk_overlap,
            self.config.chunking_strategy,
        )

    def _encode_documents(self, contents: list[str], dimension: int) -> np.ndarray:
        if not contents:
            return np.empty((0, dimension), dtype=np.float32)
        return self.model.encode_documents(contents, show_progress=len(contents) > 100)

    @staticmethod
    def _build_vector_index(ids: list[int], vectors: np.ndarray, path: Path) -> Any:
        from usearch.index import Index

        vector_index = Index(ndim=vectors.shape[1], metric="cos", dtype="f32")
        if ids:
            _ = vector_index.add(np.asarray(ids, dtype=np.int64), vectors)
        _ = vector_index.save(str(path))
        if len(ids) != len(vector_index):
            raise RuntimeError("Vector count validation failed")
        return vector_index

    @staticmethod
    def _store_db_metadata(path: Path, metadata: dict[str, Any]) -> None:
        connection = sqlite3.connect(str(path))
        try:
            write_index_metadata(connection, metadata)
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _remove_paths(*paths: Path) -> None:
        for path in paths:
            for candidate in (
                path,
                Path(str(path) + ".tmp"),
                Path(str(path) + "-journal"),
                Path(str(path) + "-wal"),
                Path(str(path) + "-shm"),
            ):
                if candidate.exists():
                    candidate.unlink()

    def _apply_stat_updates(self, updates: list[tuple[str, int, int]]) -> None:
        db_temp = self._operation_temp("chunks.db.stat-syncing")
        self._remove_paths(db_temp)
        try:
            _ = shutil.copy2(self.config.db_path, db_temp)
            connection = sqlite3.connect(str(db_temp))
            try:
                _ = connection.executemany(
                    "UPDATE file_state SET file_size=?, modified_ns=? WHERE file_path=?",
                    [
                        (size, modified_ns, relative)
                        for relative, size, modified_ns in updates
                    ],
                )
                connection.commit()
            finally:
                connection.close()
        except Exception:
            self._remove_paths(db_temp)
            raise
        try:
            self._atomic_replace(
                [(db_temp, self.config.db_path)],
                lambda: self._state_db_problems(self.config.db_path),
            )
        except Exception:
            self._remove_paths(db_temp)
            raise

    def _journal_paths(self, changed: list[str], deleted: list[str]) -> None:
        rows = [(relative, "changed", time.time()) for relative in sorted(set(changed))]
        rows.extend(
            (relative, "deleted", time.time()) for relative in sorted(set(deleted))
        )
        if not rows:
            return
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            _ = connection.executemany(
                "INSERT OR REPLACE INTO pending_paths (file_path, operation, queued_at)"
                " VALUES (?, ?, ?)",
                rows,
            )
            connection.commit()
        finally:
            connection.close()

    def _read_pending_paths(self, limit: int | None = None) -> dict[str, str]:
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            sql = "SELECT file_path, operation FROM pending_paths ORDER BY queued_at, file_path"
            parameters: tuple[int, ...] = ()
            if limit is not None:
                sql += " LIMIT ?"
                parameters = (limit,)
            return {
                str(row[0]): str(row[1])
                for row in connection.execute(sql, parameters).fetchall()
            }
        finally:
            connection.close()

    def _pending_count(self) -> int:
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            return int(
                connection.execute("SELECT COUNT(*) FROM pending_paths").fetchone()[0]
            )
        finally:
            connection.close()

    def _operation_temp(self, stem: str) -> Path:
        return self.config.index_dir / f"{stem}.{uuid.uuid4().hex}.tmp"

    @staticmethod
    def _read_stable(target: Path) -> tuple[str, os.stat_result]:
        for _attempt in range(STABLE_READ_ATTEMPTS):
            before = target.stat()
            text = target.read_text(encoding="utf-8", errors="replace")
            after = target.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ):
                return text, after
        raise RuntimeError(f"File changed while being read: {target}")

    def _clear_pending_paths(self, paths: list[str]) -> None:
        if not paths:
            return
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            _ = connection.executemany(
                "DELETE FROM pending_paths WHERE file_path=?",
                [(path,) for path in paths],
            )
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _state_db_problems(path: Path) -> list[str]:
        connection = sqlite3.connect(str(path))
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            problems = state_schema_problems(connection)
            if integrity is None or integrity[0] != "ok":
                problems.append("SQLite integrity check failed")
            return problems
        except sqlite3.Error as exc:
            return [f"state database invalid: {type(exc).__name__}: {exc}"]
        finally:
            connection.close()

    def _lexical_install_problems(self) -> list[str]:
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            problems = lexical_index_problems(connection)
            if integrity is None or integrity[0] != "ok":
                problems.append("SQLite integrity check failed")
            db_generation = read_index_metadata(self.config.db_path) or {}
            file_generation = load_metadata(self.config.metadata_path) or {}
            if db_generation.get("index_generation") != file_generation.get(
                "index_generation"
            ):
                problems.append("SQLite/metadata generation mismatch")
            return problems
        finally:
            connection.close()

    @staticmethod
    def _atomic_replace(
        pairs: list[tuple[Path, Path]], validate: Callable[[], list[str] | None]
    ) -> None:
        if not pairs:
            raise ValueError("At least one replacement pair is required")
        parents = {target.parent.resolve() for _source, target in pairs}
        if len(parents) != 1:
            raise ValueError("All replacement targets must share one directory")
        operation_id = uuid.uuid4().hex
        index_dir = next(iter(parents))
        if any(source.parent.resolve() != index_dir for source, _target in pairs):
            raise ValueError("All replacement sources must share the target directory")
        manifest_path = index_dir / REPLACE_MANIFEST
        if manifest_path.exists():
            raise RuntimeError("Interrupted index replacement must be recovered first")
        entries = []
        backups: list[tuple[Path, Path]] = []
        for source, target in pairs:
            backup = target.with_name(f"{target.name}.backup.{operation_id}")
            entries.append(
                {
                    "source": source.name,
                    "target": target.name,
                    "backup": backup.name,
                    "had_target": target.exists(),
                }
            )
        IndexManager._write_replace_manifest(
            manifest_path,
            {
                "operation_id": operation_id,
                "entries": entries,
            },
        )
        try:
            for entry, (_source, target) in zip(entries, pairs, strict=True):
                backup = index_dir / str(entry["backup"])
                if target.exists():
                    os.replace(target, backup)
                    backups.append((backup, target))
            for source, target in pairs:
                os.replace(source, target)
            validation_errors = validate() or []
            if validation_errors:
                raise RuntimeError(
                    "Post-install validation failed: " + "; ".join(validation_errors)
                )
            manifest_path.unlink()
        except Exception as original:
            try:
                _ = IndexManager.recover_interrupted_replace(index_dir)
            except Exception as restore_error:
                LOGGER.exception(
                    "Failed to restore interrupted index replacement in %s", index_dir
                )
                raise RuntimeError(
                    f"{original}; rollback also failed: "
                    f"{type(restore_error).__name__}: {restore_error}"
                ) from original
            raise
        else:
            for backup, _target in backups:
                try:
                    if backup.exists():
                        backup.unlink()
                except OSError:
                    LOGGER.warning(
                        "Could not remove validated index backup %s",
                        backup,
                        exc_info=True,
                    )

    @staticmethod
    def _write_replace_manifest(path: Path, payload: dict[str, Any]) -> None:
        temp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temp.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
        except BaseException:
            if temp.exists():
                temp.unlink()
            raise

    @staticmethod
    def recover_interrupted_replace(index_dir: Path) -> bool:
        manifest_path = index_dir / REPLACE_MANIFEST
        if not manifest_path.exists():
            return False
        # pi-lens-ignore: unchecked-throwing-call-python
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = payload.get("entries")
        if not isinstance(entries, list) or not entries:
            raise RuntimeError("Invalid index replacement manifest")
        for raw in entries:
            if not isinstance(raw, dict):
                raise RuntimeError("Invalid index replacement manifest entry")
            names = [raw.get(key) for key in ("source", "target", "backup")]
            if any(
                not isinstance(name, str) or Path(name).name != name for name in names
            ):
                raise RuntimeError("Unsafe index replacement manifest path")

        for raw in entries:
            target = index_dir / str(raw["target"])
            backup = index_dir / str(raw["backup"])
            had_target = bool(raw.get("had_target"))
            if backup.exists():
                if target.exists():
                    target.unlink()
                os.replace(backup, target)
            elif not had_target:
                if target.exists():
                    target.unlink()
            elif not target.exists():
                raise RuntimeError(f"Cannot recover prior index target: {target.name}")
        for raw in entries:
            source = index_dir / str(raw["source"])
            if source.exists():
                source.unlink()
        manifest_path.unlink()
        LOGGER.warning("Recovered interrupted index replacement from %s", manifest_path)
        return True

    @staticmethod
    def cleanup_stale_operation_artifacts(index_dir: Path) -> list[str]:
        manifest_path = index_dir / REPLACE_MANIFEST
        referenced: set[str] = set()
        if manifest_path.exists():
            # pi-lens-ignore: unchecked-throwing-call-python
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            entries = payload.get("entries")
            if not isinstance(entries, list):
                raise RuntimeError("Invalid index replacement manifest")
            for raw in entries:
                if not isinstance(raw, dict):
                    raise RuntimeError("Invalid index replacement manifest entry")
                for key in ("source", "target", "backup"):
                    value = raw.get(key)
                    if isinstance(value, str):
                        referenced.add(value)
        removed: list[str] = []
        for path in index_dir.iterdir():
            if not path.is_file() or path.name in referenced:
                continue
            if OPERATION_ARTIFACT.search(path.name):
                path.unlink()
                removed.append(path.name)
        if removed:
            LOGGER.warning("Removed %d stale index operation artifacts", len(removed))
        return sorted(removed)
