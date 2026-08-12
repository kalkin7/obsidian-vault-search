from __future__ import annotations

import json
import os
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .chunking import DocumentChunk, chunk_document
from .config import SearchConfig
from .database import (
    compute_hash, delete_files, ensure_lexical_schema, index_counts, init_db, insert_chunk,
    lexical_index_problems, read_index_metadata, upsert_file_fields, upsert_file_state,
    write_index_metadata,
)
from .document_fields import extract_file_fields, heading_tokens
from .index_metadata import (
    LEXICAL_SCHEMA_VERSION, build_metadata, expected_metadata, load_metadata, validate_index_files,
    validate_metadata, write_metadata,
)
from .model_manager import ModelManager
from .scope import is_in_scope, iter_vault_files, normalize_relative, resolve_inside_vault
from .tokenizer import tokenize

Progress = Callable[[str, dict[str, Any]], None]


class IndexManager:
    def __init__(self, config: SearchConfig, model: ModelManager, kiwi: Any,
                 progress: Progress | None = None):
        self.config = config
        self.model = model
        self.kiwi = kiwi
        self.progress = progress or (lambda _event, _data: None)

    def status(self) -> dict[str, Any]:
        counts = index_counts(self.config.db_path)
        counts.update({
            "db_exists": self.config.db_path.exists(),
            "vector_exists": self.config.vector_path.exists(),
            "metadata": load_metadata(self.config.metadata_path),
            "db_bytes": self.config.db_path.stat().st_size if self.config.db_path.exists() else 0,
            "vector_bytes": self.config.vector_path.stat().st_size if self.config.vector_path.exists() else 0,
        })
        return counts

    def ensure_lexical_index(self) -> dict[str, Any]:
        if not self.config.db_path.exists():
            return {"migrated": False, "files": 0}
        file_metadata = load_metadata(self.config.metadata_path)
        db_metadata = read_index_metadata(self.config.db_path)
        actual = file_metadata or db_metadata
        if file_metadata and db_metadata \
                and file_metadata.get("lexical_schema_version") == LEXICAL_SCHEMA_VERSION \
                and db_metadata.get("lexical_schema_version") == LEXICAL_SCHEMA_VERSION:
            connection = sqlite3.connect(str(self.config.db_path))
            try:
                fast_path_problems = lexical_index_problems(connection)
                if not fast_path_problems:
                    return {"migrated": False, "files": index_counts(self.config.db_path)["files"]}
            except sqlite3.Error:
                pass
            finally:
                connection.close()
        db_temp = self.config.index_dir / "chunks.db.lexical-building"
        metadata_temp = self.config.index_dir / "metadata.json.lexical-building"
        try:
            self._remove_paths(db_temp, metadata_temp)
            shutil.copy2(self.config.db_path, db_temp)
            connection = sqlite3.connect(str(db_temp))
        except Exception as exc:
            return {"migrated": False, "rebuild_required": True,
                    "reason": f"Lexical migration setup failed: {type(exc).__name__}: {exc}"}
        try:
            rows = [str(row[0]) for row in connection.execute(
                "SELECT file_path FROM file_state ORDER BY file_path").fetchall()]
            self.progress("lexical_migration_started", {"files": len(rows)})
            ensure_lexical_schema(connection)
            connection.execute("DELETE FROM file_fields_fts")
            connection.execute("DELETE FROM file_fields")
            connection.execute("DELETE FROM chunk_headings_fts")
            for relative in rows:
                target = resolve_inside_vault(self.config.vault_path, relative)
                text = target.read_text(encoding="utf-8", errors="replace") \
                    if target.exists() else ""
                fields = extract_file_fields(relative, text, self.kiwi)
                upsert_file_fields(connection, relative, fields.basename, fields.directory,
                                   fields.aliases, fields.tags, fields.properties)
            chunk_rows = connection.execute(
                "SELECT id, content, heading_path FROM chunks ORDER BY id").fetchall()
            connection.execute("DELETE FROM chunks_fts")
            for chunk_id, content, raw_heading_path in chunk_rows:
                parsed = json.loads(str(raw_heading_path))
                headings = tuple(str(value) for value in parsed) if isinstance(parsed, list) else ()
                connection.execute(
                    "INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)",
                    (int(chunk_id), " ".join(tokenize(str(content), self.kiwi))))
                connection.execute(
                    "INSERT INTO chunk_headings_fts(rowid, heading_tokens) VALUES (?, ?)",
                    (int(chunk_id), " ".join(heading_tokens(headings, self.kiwi))))
            connection.execute("DROP TABLE IF EXISTS titles_fts")
            connection.execute("DROP TABLE IF EXISTS file_titles")
            metadata = dict(actual or {})
            metadata.update({
                "lexical_schema_version": LEXICAL_SCHEMA_VERSION,
                "index_generation": uuid.uuid4().hex,
                "updated_at": time.time(),
            })
            write_index_metadata(connection, metadata)
            connection.commit()
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            validation = lexical_index_problems(connection)
            if integrity is None or integrity[0] != "ok" or validation:
                raise RuntimeError(
                    "Lexical migration validation failed: " + "; ".join(validation))
            write_metadata(metadata_temp, metadata)
        except Exception as exc:
            connection.rollback()
            connection.close()
            self._remove_paths(db_temp, metadata_temp)
            return {"migrated": False, "rebuild_required": True,
                    "reason": f"Lexical migration failed: {type(exc).__name__}: {exc}"}
        finally:
            connection.close()
        try:
            self._atomic_replace([
                (db_temp, self.config.db_path),
                (metadata_temp, self.config.metadata_path),
            ])
        except Exception as exc:
            self._remove_paths(db_temp, metadata_temp)
            return {"migrated": False, "rebuild_required": True,
                    "reason": f"Lexical migration install failed: {type(exc).__name__}: {exc}"}
        result = {"migrated": True, "files": len(rows)}
        self.progress("lexical_migration_finished", result)
        return result

    def preview_scope(self) -> dict[str, Any]:
        files = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs)
        return {"count": len(files), "sample": files[:30]}

    def rebuild_all(self) -> dict[str, Any]:
        dimension = self._dimension()
        files = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs)
        self.progress("rebuild_started", {"files": len(files)})
        db_temp = self.config.index_dir / "chunks.db.building"
        vector_temp = self.config.index_dir / "vectors.usearch.building"
        metadata_temp = self.config.index_dir / "metadata.json.building"
        self._remove_paths(db_temp, vector_temp, metadata_temp)

        connection = init_db(db_temp)
        chunk_ids: list[int] = []
        chunk_contents: list[str] = []
        try:
            for number, relative in enumerate(files, 1):
                text = resolve_inside_vault(self.config.vault_path, relative).read_text(
                    encoding="utf-8", errors="replace")
                chunks = self._chunks(text, relative)
                for chunk_index, chunk in enumerate(chunks):
                    lexical_only = chunk.lexical_only
                    row_id = insert_chunk(
                        connection, relative, chunk_index, chunk.content,
                        tokenize(chunk.content, self.kiwi), chunk.heading_path,
                        chunk.start_line, chunk.end_line, chunk.embedding_text, lexical_only,
                        heading_tokens(chunk.heading_path, self.kiwi))
                    if not lexical_only:
                        chunk_ids.append(row_id)
                        chunk_contents.append(chunk.embedding_text)
                upsert_file_state(connection, relative, compute_hash(text), len(chunks))
                fields = extract_file_fields(relative, text, self.kiwi)
                upsert_file_fields(connection, relative, fields.basename, fields.directory,
                                   fields.aliases, fields.tags, fields.properties)
                if number % 100 == 0:
                    connection.commit()
                    self.progress("rebuild_progress", {
                        "processed_files": number, "total_files": len(files),
                        "chunks": len(chunk_ids),
                    })
            connection.commit()
        finally:
            connection.close()

        try:
            self.progress("embedding_started", {"chunks": len(chunk_contents)})
            vectors = self._encode_documents(chunk_contents, dimension)
            self.progress("embedding_finished", {"chunks": len(chunk_contents)})
            vector_index = self._build_vector_index(chunk_ids, vectors, vector_temp)
            previous = load_metadata(self.config.metadata_path)
            metadata = build_metadata(
                self.config, dimension, vector_temp, len(vector_index), previous)
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace([
                (db_temp, self.config.db_path),
                (vector_temp, self.config.vector_path),
                (metadata_temp, self.config.metadata_path),
            ])
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise

        problems = validate_index_files(self.config, dimension)
        if problems:
            raise RuntimeError("Post-build validation failed: " + "; ".join(problems))
        result = self.status()
        self.progress("rebuild_finished", result)
        return result

    def rebuild_vectors(self) -> dict[str, Any]:
        dimension = self._dimension()
        if not self.config.db_path.exists():
            raise FileNotFoundError("chunks.db is missing; run rebuild_all")
        lexical = self.ensure_lexical_index()
        if lexical.get("rebuild_required"):
            raise RuntimeError(str(lexical.get("reason") or "Lexical migration required"))
        expected = expected_metadata(self.config, dimension)
        structural_keys = {
            "schema_version", "lexical_schema_version", "chunking_strategy", "chunker_version",
            "chunk_chars", "chunk_overlap",
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
                for problem in validate_metadata(metadata, expected)
                if problem.split(":", 1)[0] in structural_keys
            )
        if structural_problems:
            raise RuntimeError(
                "Index structure mismatch; run rebuild_all: " + "; ".join(structural_problems))
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            rows = connection.execute(
                "SELECT id, embedding_text FROM chunks WHERE lexical_only = 0 ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        ids = [int(row[0]) for row in rows]
        contents = [str(row[1]) for row in rows]
        self.progress("embedding_started", {"chunks": len(contents)})
        vectors = self._encode_documents(contents, dimension)
        self.progress("embedding_finished", {"chunks": len(contents)})
        db_temp = self.config.index_dir / "chunks.db.vector-building"
        vector_temp = self.config.index_dir / "vectors.usearch.building"
        metadata_temp = self.config.index_dir / "metadata.json.building"
        self._remove_paths(db_temp, vector_temp, metadata_temp)
        shutil.copy2(self.config.db_path, db_temp)
        try:
            vector_index = self._build_vector_index(ids, vectors, vector_temp)
            metadata = build_metadata(
                self.config, dimension, vector_temp, len(vector_index),
                load_metadata(self.config.metadata_path))
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace([
                (db_temp, self.config.db_path),
                (vector_temp, self.config.vector_path),
                (metadata_temp, self.config.metadata_path),
            ])
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        problems = validate_index_files(self.config, dimension)
        if problems:
            raise RuntimeError("Post-build validation failed: " + "; ".join(problems))
        return self.status()

    def reconcile(self) -> dict[str, Any]:
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            return {"rebuild_required": True, "reason": "index missing", **self.status()}
        problems = validate_index_files(self.config, self._dimension(), check_scope=False)
        if problems:
            return {"rebuild_required": True, "reason": "; ".join(problems), **self.status()}

        connection = sqlite3.connect(str(self.config.db_path))
        try:
            existing = {str(row[0]): str(row[1]) for row in connection.execute(
                "SELECT file_path, file_hash FROM file_state").fetchall()}
        finally:
            connection.close()
        current = iter_vault_files(
            self.config.vault_path, self.config.include_globs, self.config.exclude_globs)
        current_set = set(current)
        changed: list[str] = []
        for relative in current:
            text = resolve_inside_vault(self.config.vault_path, relative).read_text(
                encoding="utf-8", errors="replace")
            if existing.get(relative) != compute_hash(text):
                changed.append(relative)
        deleted = [relative for relative in existing if relative not in current_set]
        result = self._apply_changes(changed, deleted)
        result["scanned"] = len(current)
        return result

    def sync_paths(self, changed_paths: list[str], deleted_paths: list[str]) -> dict[str, Any]:
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
                    relative, self.config.include_globs, self.config.exclude_globs):
                changed.append(relative)
            else:
                deleted.add(relative)
        return self._apply_changes(sorted(set(changed)), sorted(deleted))

    def _apply_changes(self, changed: list[str], deleted: list[str]) -> dict[str, Any]:
        changed_set = sorted(set(changed))
        deleted_set = sorted(set(deleted) | set(changed_set))
        if not changed_set and not deleted_set:
            return {"changed": 0, "deleted": 0, **self.status()}
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            return {"rebuild_required": True, "reason": "index missing", **self.status()}

        dimension = self._dimension()
        problems = validate_index_files(self.config, dimension, check_scope=False)
        if problems:
            return {"rebuild_required": True, "reason": "; ".join(problems), **self.status()}

        db_temp = self.config.index_dir / "chunks.db.syncing"
        vector_temp = self.config.index_dir / "vectors.usearch.syncing"
        metadata_temp = self.config.index_dir / "metadata.json.syncing"
        self._remove_paths(db_temp, vector_temp, metadata_temp)
        shutil.copy2(self.config.db_path, db_temp)
        connection = sqlite3.connect(str(db_temp))
        removed_ids: list[int] = []
        new_ids: list[int] = []
        new_contents: list[str] = []
        try:
            removed_ids = delete_files(connection, deleted_set)
            for relative in changed_set:
                target = resolve_inside_vault(self.config.vault_path, relative)
                if not target.exists():
                    continue
                text = target.read_text(encoding="utf-8", errors="replace")
                chunks = self._chunks(text, relative)
                for chunk_index, chunk in enumerate(chunks):
                    lexical_only = chunk.lexical_only
                    row_id = insert_chunk(
                        connection, relative, chunk_index, chunk.content,
                        tokenize(chunk.content, self.kiwi), chunk.heading_path,
                        chunk.start_line, chunk.end_line, chunk.embedding_text, lexical_only,
                        heading_tokens(chunk.heading_path, self.kiwi))
                    if not lexical_only:
                        new_ids.append(row_id)
                        new_contents.append(chunk.embedding_text)
                upsert_file_state(connection, relative, compute_hash(text), len(chunks))
                fields = extract_file_fields(relative, text, self.kiwi)
                upsert_file_fields(connection, relative, fields.basename, fields.directory,
                                   fields.aliases, fields.tags, fields.properties)
            connection.commit()
        finally:
            connection.close()

        try:
            from usearch.index import Index
            vector_index = Index.restore(str(self.config.vector_path))
            if removed_ids:
                vector_index.remove(np.asarray(removed_ids, dtype=np.int64))
            if new_ids:
                vectors = self._encode_documents(new_contents, dimension)
                vector_index.add(np.asarray(new_ids, dtype=np.int64), vectors)
            vector_index.save(str(vector_temp))
            expected_count = index_counts(db_temp)["vector_chunks"]
            if len(vector_index) != expected_count or int(vector_index.ndim) != dimension:
                raise RuntimeError("Incremental vector validation failed")
            metadata = build_metadata(
                self.config, dimension, vector_temp, len(vector_index),
                load_metadata(self.config.metadata_path))
            self._store_db_metadata(db_temp, metadata)
            write_metadata(metadata_temp, metadata)
            self._atomic_replace([
                (db_temp, self.config.db_path),
                (vector_temp, self.config.vector_path),
                (metadata_temp, self.config.metadata_path),
            ])
        except Exception:
            self._remove_paths(db_temp, vector_temp, metadata_temp)
            raise
        return {
            "changed": len(changed_set),
            "deleted": len(set(deleted) - set(changed_set)),
            "removed_chunks": len(removed_ids),
            "added_chunks": len(new_ids),
            **self.status(),
        }

    def _dimension(self) -> int:
        if self.model.dimension is None:
            raise RuntimeError("Model must be loaded before indexing")
        return int(self.model.dimension)

    def _chunks(self, text: str, relative: str) -> list[DocumentChunk]:
        return chunk_document(
            text, relative, self.config.chunk_chars, self.config.chunk_overlap,
            self.config.chunking_strategy)

    def _encode_documents(self, contents: list[str], dimension: int) -> np.ndarray:
        if not contents:
            return np.empty((0, dimension), dtype=np.float32)
        return self.model.encode_documents(contents, show_progress=len(contents) > 100)

    @staticmethod
    def _build_vector_index(ids: list[int], vectors: np.ndarray, path: Path) -> Any:
        from usearch.index import Index
        vector_index = Index(ndim=int(vectors.shape[1]), metric="cos", dtype="f32")
        if ids:
            vector_index.add(np.asarray(ids, dtype=np.int64), vectors)
        vector_index.save(str(path))
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
            if path.exists():
                path.unlink()

    @staticmethod
    def _atomic_replace(pairs: list[tuple[Path, Path]]) -> None:
        backups: list[tuple[Path, Path]] = []
        installed: list[Path] = []
        try:
            for _source, target in pairs:
                backup = target.with_suffix(target.suffix + ".backup")
                if backup.exists():
                    backup.unlink()
                if target.exists():
                    os.replace(target, backup)
                    backups.append((backup, target))
            for source, target in pairs:
                os.replace(source, target)
                installed.append(target)
        except Exception:
            for target in installed:
                if target.exists():
                    target.unlink()
            for backup, target in backups:
                if backup.exists():
                    os.replace(backup, target)
            raise
        else:
            for backup, _target in backups:
                if backup.exists():
                    backup.unlink()
