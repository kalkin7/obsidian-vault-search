from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .chunking import chunk_text
from .config import SearchConfig
from .database import (
    clear_title_index, compute_hash, delete_files, index_counts, init_db, insert_chunk,
    mark_title_index_current, title_index_needs_rebuild, upsert_file_state,
    upsert_file_title, write_index_metadata,
)
from .document_fields import title_tokens
from .index_metadata import (
    build_metadata, load_metadata, validate_index_files, write_metadata,
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

    def ensure_title_index(self) -> dict[str, Any]:
        if not self.config.db_path.exists():
            return {"rebuilt": False, "files": 0}
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            if not title_index_needs_rebuild(connection):
                count = int(connection.execute(
                    "SELECT COUNT(*) FROM file_titles").fetchone()[0])
                return {"rebuilt": False, "files": count}
            rows = [str(row[0]) for row in connection.execute(
                "SELECT file_path FROM file_state ORDER BY file_path").fetchall()]
            self.progress("title_index_started", {"files": len(rows)})
            clear_title_index(connection)
            for number, relative in enumerate(rows, 1):
                target = resolve_inside_vault(self.config.vault_path, relative)
                text = target.read_text(encoding="utf-8", errors="replace") \
                    if target.exists() else ""
                basename, directory, headings = title_tokens(relative, text, self.kiwi)
                upsert_file_title(connection, relative, basename, directory, headings)
                if number % 500 == 0:
                    self.progress("title_index_progress", {
                        "processed_files": number, "total_files": len(rows),
                    })
            mark_title_index_current(connection)
            connection.commit()
            result = {"rebuilt": True, "files": len(rows)}
            self.progress("title_index_finished", result)
            return result
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

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
                chunks = chunk_text(text, self.config.chunk_chars, self.config.chunk_overlap)
                for chunk_index, content in enumerate(chunks):
                    row_id = insert_chunk(
                        connection, relative, chunk_index, content, tokenize(content, self.kiwi))
                    chunk_ids.append(row_id)
                    chunk_contents.append(content)
                upsert_file_state(connection, relative, compute_hash(text), len(chunks))
                basename, directory, headings = title_tokens(relative, text, self.kiwi)
                upsert_file_title(connection, relative, basename, directory, headings)
                if number % 100 == 0:
                    connection.commit()
                    self.progress("rebuild_progress", {
                        "processed_files": number, "total_files": len(files),
                        "chunks": len(chunk_ids),
                    })
            mark_title_index_current(connection)
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
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            rows = connection.execute("SELECT id, content FROM chunks ORDER BY id").fetchall()
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
                chunks = chunk_text(text, self.config.chunk_chars, self.config.chunk_overlap)
                for chunk_index, content in enumerate(chunks):
                    row_id = insert_chunk(
                        connection, relative, chunk_index, content, tokenize(content, self.kiwi))
                    new_ids.append(row_id)
                    new_contents.append(content)
                upsert_file_state(connection, relative, compute_hash(text), len(chunks))
                basename, directory, headings = title_tokens(relative, text, self.kiwi)
                upsert_file_title(connection, relative, basename, directory, headings)
            mark_title_index_current(connection)
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
            expected_count = index_counts(db_temp)["chunks"]
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
