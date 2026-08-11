from __future__ import annotations

import sqlite3
from typing import Any

from .config import SearchConfig
from .index_metadata import validate_index_files
from .model_manager import ModelManager
from .tokenizer import tokenize


def rrf_fusion(bm25_ids: list[int], vector_ids: list[int], k: int = 60) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for rank, chunk_id in enumerate(bm25_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    for rank, chunk_id in enumerate(vector_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)


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
            selected = ranked[:max(1, int(top_k or self.config.final_top_k))]
            if not selected:
                return []

            ids = [chunk_id for chunk_id, _ in selected]
            placeholders = ",".join("?" for _ in ids)
            rows = {
                int(row[0]): (str(row[1]), str(row[2]))
                for row in connection.execute(
                    f"SELECT id, file_path, content FROM chunks WHERE id IN ({placeholders})", ids
                ).fetchall()
            }
            results: list[dict[str, Any]] = []
            for chunk_id, score in selected:
                if chunk_id not in rows:
                    continue
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
                results.append(entry)
            return results
        finally:
            connection.close()

    def _bm25(self, connection: sqlite3.Connection,
              query_tokens: list[str]) -> list[tuple[int, float]]:
        if not query_tokens:
            return []
        expression = " OR ".join(query_tokens)
        try:
            rows = connection.execute(
                "SELECT rowid, -bm25(chunks_fts) AS score FROM chunks_fts "
                "WHERE tokens MATCH ? ORDER BY score DESC LIMIT ?",
                (expression, self.config.bm25_top_k),
            ).fetchall()
            return [(int(row[0]), float(row[1])) for row in rows]
        except sqlite3.Error:
            return []


class IndexCompatibilityError(RuntimeError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Index rebuild required: " + "; ".join(problems))
