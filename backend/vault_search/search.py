from __future__ import annotations

import sqlite3
from collections import defaultdict
from typing import Any

from .config import SearchConfig
from .index_metadata import validate_index_files
from .model_manager import ModelManager
from .tokenizer import tokenize

TITLE_FIELD_WEIGHTS = (10.0, 7.0, 5.0)


def rrf_fusion(bm25_ids: list[int], vector_ids: list[int], k: int = 60) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for rank, chunk_id in enumerate(bm25_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    for rank, chunk_id in enumerate(vector_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)


def select_diverse(ranked: list[tuple[int, float]],
                   rows: dict[int, tuple[str, str]], top_k: int,
                   max_chunks_per_file: int) -> list[tuple[int, float]]:
    """Select top chunks while capping how many results one file can occupy."""
    selected: list[tuple[int, float]] = []
    file_counts: dict[str, int] = defaultdict(int)
    for chunk_id, score in ranked:
        row = rows.get(chunk_id)
        if row is None:
            continue
        file_path = row[0]
        if file_counts[file_path] >= max_chunks_per_file:
            continue
        selected.append((chunk_id, score))
        file_counts[file_path] += 1
        if len(selected) >= top_k:
            break
    return selected


def _fts_expression(tokens: list[str], prefix: bool = False) -> str:
    terms: list[str] = []
    for token in tokens:
        escaped = token.replace('"', '""')
        terms.append(f'"{escaped}"*' if prefix else f'"{escaped}"')
    return " OR ".join(terms)


class SearchEngine:
    def __init__(self, config: SearchConfig, model: ModelManager, kiwi: Any):
        self.config = config
        self.model = model
        self.kiwi = kiwi

    def search(self, query: str, top_k: int | None = None,
               verbose: bool = False) -> list[dict[str, Any]]:
        if not self.config.db_path.exists() or not self.config.vector_path.exists():
            raise FileNotFoundError("Search index is missing; run rebuild_all")
        if self.model.dimension is None:
            raise RuntimeError("Embedding model dimension is unavailable")
        problems = validate_index_files(self.config, self.model.dimension, check_scope=False)
        if problems:
            raise IndexCompatibilityError(problems)

        query_tokens = tokenize(query, self.kiwi) or query.lower().split()
        connection = sqlite3.connect(str(self.config.db_path))
        try:
            bm25_results = self._bm25(connection, query_tokens)
            bm25_ids = [row[0] for row in bm25_results]
            bm25_rank = {chunk_id: rank for rank, chunk_id in enumerate(bm25_ids, 1)}

            from usearch.index import Index
            vector = self.model.encode_query(query)
            vector_index = Index.restore(str(self.config.vector_path))
            matches = vector_index.search(vector, count=self.config.vector_top_k)
            keys = matches.keys
            if getattr(keys, "ndim", 1) > 1:
                keys = keys[0]
            vector_ids = [int(key) for key in keys]
            vector_rank = {chunk_id: rank for rank, chunk_id in enumerate(vector_ids, 1)}
            ranked = rrf_fusion(bm25_ids, vector_ids, self.config.rrf_k)
            if not ranked:
                return []

            candidate_ids = [chunk_id for chunk_id, _score in ranked]
            placeholders = ",".join("?" for _ in candidate_ids)
            rows = {
                int(row[0]): (str(row[1]), str(row[2]))
                for row in connection.execute(
                    f"SELECT id, file_path, content FROM chunks WHERE id IN ({placeholders})",
                    candidate_ids,
                ).fetchall()
            }

            title_rank = self._title_ranks(connection, query_tokens)
            boosted: list[tuple[int, float]] = []
            for chunk_id, score in ranked:
                row = rows.get(chunk_id)
                if row is None:
                    continue
                rank = title_rank.get(row[0])
                if rank is not None and self.config.title_rrf_weight > 0:
                    score += self.config.title_rrf_weight / (self.config.rrf_k + rank)
                boosted.append((chunk_id, score))
            boosted.sort(key=lambda item: item[1], reverse=True)

            requested = max(1, int(top_k or self.config.final_top_k))
            selected = select_diverse(
                boosted, rows, requested, self.config.max_chunks_per_file)
            results: list[dict[str, Any]] = []
            for chunk_id, score in selected:
                file_path, content = rows[chunk_id]
                entry: dict[str, Any] = {
                    "rank": len(results) + 1,
                    "file_path": file_path,
                    "score": round(float(score), 6),
                    "content": content,
                }
                if verbose:
                    entry["bm25_rank"] = bm25_rank.get(chunk_id, -1)
                    entry["vector_rank"] = vector_rank.get(chunk_id, -1)
                    entry["title_rank"] = title_rank.get(file_path, -1)
                results.append(entry)
            return results
        finally:
            connection.close()

    def _bm25(self, connection: sqlite3.Connection,
              query_tokens: list[str]) -> list[tuple[int, float]]:
        if not query_tokens:
            return []
        rows = self._query_chunk_fts(
            connection, _fts_expression(query_tokens), self.config.bm25_top_k)
        if not rows and self.config.prefix_fallback:
            rows = self._query_chunk_fts(
                connection, _fts_expression(query_tokens, prefix=True),
                self.config.bm25_top_k)
        return rows

    @staticmethod
    def _query_chunk_fts(connection: sqlite3.Connection, expression: str,
                         limit: int) -> list[tuple[int, float]]:
        try:
            rows = connection.execute(
                "SELECT rowid, -bm25(chunks_fts) AS score FROM chunks_fts "
                "WHERE tokens MATCH ? ORDER BY score DESC LIMIT ?",
                (expression, limit),
            ).fetchall()
            return [(int(row[0]), float(row[1])) for row in rows]
        except sqlite3.Error:
            return []

    def _title_ranks(self, connection: sqlite3.Connection,
                     query_tokens: list[str]) -> dict[str, int]:
        if not query_tokens:
            return {}
        rows = self._query_title_fts(
            connection, _fts_expression(query_tokens), self.config.bm25_top_k)
        if not rows and self.config.prefix_fallback:
            rows = self._query_title_fts(
                connection, _fts_expression(query_tokens, prefix=True),
                self.config.bm25_top_k)
        return {file_path: rank for rank, (file_path, _score) in enumerate(rows, 1)}

    @staticmethod
    def _query_title_fts(connection: sqlite3.Connection, expression: str,
                         limit: int) -> list[tuple[str, float]]:
        try:
            rows = connection.execute(
                "SELECT file_titles.file_path, "
                "-bm25(titles_fts, ?, ?, ?) AS score "
                "FROM titles_fts JOIN file_titles "
                "ON file_titles.rowid = titles_fts.rowid "
                "WHERE titles_fts MATCH ? ORDER BY score DESC LIMIT ?",
                (*TITLE_FIELD_WEIGHTS, expression, limit),
            ).fetchall()
            return [(str(row[0]), float(row[1])) for row in rows]
        except sqlite3.Error:
            return []


class IndexCompatibilityError(RuntimeError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Index rebuild required: " + "; ".join(problems))
