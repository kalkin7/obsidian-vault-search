from __future__ import annotations

import sqlite3
from collections import defaultdict
from typing import Any

from .config import SearchConfig
from .index_metadata import validate_index_files
from .model_manager import ModelManager
from .tokenizer import tokenize

FILE_FIELD_WEIGHTS = (10.0, 7.0, 8.0, 3.0, 2.0)


def weighted_rrf(
    channels: list[tuple[str, list[int], float]],
    k: int,
) -> tuple[list[tuple[int, float]], dict[int, set[str]]]:
    """Merge independent candidate channels with weighted reciprocal rank fusion.

    Each channel is ``(name, ranked_ids, weight)``. Within a channel only the
    first occurrence of a chunk ID contributes. Contribution is
    ``weight / (k + rank)`` with rank starting at 1. The result is sorted by
    score descending, then chunk ID ascending. Sources records which channels
    contributed to each chunk.
    """
    scores: dict[int, float] = {}
    sources: dict[int, set[str]] = defaultdict(set)
    for name, ranked_ids, weight in channels:
        seen: set[int] = set()
        rank = 0
        for chunk_id in ranked_ids:
            chunk_id = int(chunk_id)
            if chunk_id in seen:
                continue
            seen.add(chunk_id)
            rank += 1
            scores[chunk_id] = scores.get(chunk_id, 0.0) + weight / (k + rank)
            sources[chunk_id].add(name)
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return ranked, dict(sources)


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


def _fts_expression(
    tokens: list[str],
    match_mode: str,
    prefix_last: bool = False,
) -> str:
    if not tokens:
        return ""
    if match_mode not in {"any", "all", "phrase"}:
        raise ValueError(f"Invalid match mode: {match_mode}")
    escaped = [token.replace('"', '""') for token in tokens]
    if match_mode == "phrase":
        return f'"{" ".join(escaped)}"'
    terms = [f'"{token}"' for token in escaped]
    if prefix_last:
        terms[-1] += "*"
    return (" OR " if match_mode == "any" else " AND ").join(terms)


class SearchEngine:
    def __init__(self, config: SearchConfig, model: ModelManager, kiwi: Any):
        self.config = config
        self.model = model
        self.kiwi = kiwi

    def search(self, query: str, top_k: int | None = None,
               verbose: bool = False, match_mode: str = "any") -> list[dict[str, Any]]:
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
            bm25_results = self._bm25(connection, query_tokens, match_mode)
            bm25_ids = [row[0] for row in bm25_results]
            bm25_rank = {chunk_id: rank for rank, chunk_id in enumerate(bm25_ids, 1)}

            heading_results = self._heading_rows(connection, query_tokens, match_mode)
            heading_ids = [row[0] for row in heading_results]
            heading_rank = {chunk_id: rank for rank, chunk_id in enumerate(heading_ids, 1)}

            file_rows = self._file_rows(connection, query_tokens, match_mode)
            file_ids = _file_candidate_ids(
                connection, file_rows, [*bm25_ids, *heading_ids])
            file_rank = {chunk_id: rank for rank, chunk_id in enumerate(file_ids, 1)}

            from usearch.index import Index
            vector = self.model.encode_query(query)
            vector_index = Index.restore(str(self.config.vector_path))
            matches = vector_index.search(vector, count=self.config.vector_top_k)
            keys = matches.keys
            if getattr(keys, "ndim", 1) > 1:
                keys = keys[0]
            vector_ids = [int(key) for key in keys]

            channels: list[tuple[str, list[int], float]] = [
                ("body", bm25_ids, 1.0),
                ("heading", heading_ids, 1.0),
            ]
            if self.config.title_rrf_weight > 0:
                vector_ids = _coalesce_file_candidates(connection, file_ids, vector_ids)
                channels.append(("file", file_ids, self.config.title_rrf_weight))
            vector_rank = {
                chunk_id: rank
                for rank, chunk_id in enumerate(dict.fromkeys(vector_ids), 1)
            }
            channels.append(("vector", vector_ids, 1.0))
            ranked, sources = weighted_rrf(channels, self.config.rrf_k)
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

            requested = max(1, int(top_k or self.config.final_top_k))
            selected = select_diverse(
                ranked, rows, requested, self.config.max_chunks_per_file)
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
                    result_channels = set(sources.get(chunk_id, set()))
                    if "file" in result_channels:
                        result_channels.add("title")
                    entry["channels"] = sorted(result_channels)
                    entry["query_tokens"] = query_tokens
                    entry["match_mode"] = match_mode
                    entry["bm25_rank"] = bm25_rank.get(chunk_id, -1)
                    entry["body_rank"] = bm25_rank.get(chunk_id, -1)
                    entry["heading_rank"] = heading_rank.get(chunk_id, -1)
                    entry["file_rank"] = file_rank.get(chunk_id, -1)
                    entry["vector_rank"] = vector_rank.get(chunk_id, -1)
                    entry["title_rank"] = file_rank.get(chunk_id, -1)
                    contributions: dict[str, float] = {}
                    if chunk_id in bm25_rank:
                        contributions["body"] = round(
                            1.0 / (self.config.rrf_k + bm25_rank[chunk_id]), 6)
                    if chunk_id in heading_rank:
                        contributions["heading"] = round(
                            1.0 / (self.config.rrf_k + heading_rank[chunk_id]), 6)
                    if chunk_id in file_rank and self.config.title_rrf_weight > 0:
                        file_contribution = round(
                            self.config.title_rrf_weight
                            / (self.config.rrf_k + file_rank[chunk_id]), 6)
                        contributions["file"] = file_contribution
                        contributions["title"] = file_contribution
                    if chunk_id in vector_rank:
                        contributions["vector"] = round(
                            1.0 / (self.config.rrf_k + vector_rank[chunk_id]), 6)
                    entry["rrf_contributions"] = contributions
                results.append(entry)
            return results
        finally:
            connection.close()

    def _bm25(self, connection: sqlite3.Connection,
              query_tokens: list[str], match_mode: str = "any") -> list[tuple[int, float]]:
        if not query_tokens:
            return []
        rows = self._query_chunk_fts(
            connection, _fts_expression(query_tokens, match_mode), self.config.bm25_top_k)
        if not rows and self.config.prefix_fallback and match_mode != "phrase":
            rows = self._query_chunk_fts(
                connection, _fts_expression(query_tokens, match_mode, prefix_last=True),
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

    def _heading_rows(self, connection: sqlite3.Connection,
                      query_tokens: list[str], match_mode: str = "any") -> list[tuple[int, float]]:
        if not query_tokens:
            return []
        rows = self._query_heading_fts(
            connection, _fts_expression(query_tokens, match_mode), self.config.bm25_top_k)
        if not rows and self.config.prefix_fallback and match_mode != "phrase":
            rows = self._query_heading_fts(
                connection, _fts_expression(query_tokens, match_mode, prefix_last=True),
                self.config.bm25_top_k)
        return rows

    @staticmethod
    def _query_heading_fts(connection: sqlite3.Connection, expression: str,
                           limit: int) -> list[tuple[int, float]]:
        try:
            rows = connection.execute(
                "SELECT rowid, -bm25(chunk_headings_fts) AS score "
                "FROM chunk_headings_fts WHERE heading_tokens MATCH ? "
                "ORDER BY score DESC LIMIT ?", (expression, limit),
            ).fetchall()
            return [(int(row[0]), float(row[1])) for row in rows]
        except sqlite3.Error:
            return []

    def _file_rows(self, connection: sqlite3.Connection,
                   query_tokens: list[str], match_mode: str = "any") -> list[tuple[str, float]]:
        if not query_tokens:
            return []
        rows = self._query_file_fts(
            connection, _fts_expression(query_tokens, match_mode), self.config.bm25_top_k)
        if not rows and self.config.prefix_fallback and match_mode != "phrase":
            rows = self._query_file_fts(
                connection, _fts_expression(query_tokens, match_mode, prefix_last=True),
                self.config.bm25_top_k)
        return rows

    @staticmethod
    def _query_file_fts(connection: sqlite3.Connection, expression: str,
                        limit: int) -> list[tuple[str, float]]:
        try:
            rows = connection.execute(
                "SELECT file_fields.file_path, -bm25(file_fields_fts, ?, ?, ?, ?, ?) AS score "
                "FROM file_fields_fts JOIN file_fields ON file_fields.rowid=file_fields_fts.rowid "
                "WHERE file_fields_fts MATCH ? ORDER BY score DESC LIMIT ?",
                (*FILE_FIELD_WEIGHTS, expression, limit),
            ).fetchall()
            return [(str(row[0]), float(row[1])) for row in rows]
        except sqlite3.Error:
            return []


def _file_candidate_ids(
    connection: sqlite3.Connection,
    file_rows: list[tuple[str, float]],
    lexical_ids: list[int],
) -> list[int]:
    """Map file-ranked paths to representative chunk IDs.

    For each file row (in order):
    - if the file already has body or heading candidates, pick the chunk with
      the best lexical rank (body IDs are supplied before heading IDs);
    - otherwise pick the chunk with the smallest ``chunk_index``;
    - files with no chunks are skipped.
    Chunk IDs are never returned twice.
    """
    if not file_rows:
        return []
    paths = [file_path for file_path, _score in file_rows]

    lexical_file: dict[str, list[int]] = {}
    if lexical_ids:
        placeholders = ",".join("?" for _ in lexical_ids)
        rows = connection.execute(
            f"SELECT id, file_path FROM chunks WHERE id IN ({placeholders})",
            lexical_ids,
        ).fetchall()
        for chunk_id, file_path in rows:
            lexical_file.setdefault(str(file_path), []).append(int(chunk_id))

    placeholders = ",".join("?" for _ in paths)
    chunks = connection.execute(
        f"SELECT id, file_path, chunk_index FROM chunks "
        f"WHERE file_path IN ({placeholders}) "
        f"ORDER BY file_path, chunk_index",
        paths,
    ).fetchall()
    by_file: dict[str, list[tuple[int, int]]] = {}
    for chunk_id, file_path, chunk_index in chunks:
        by_file.setdefault(str(file_path), []).append((int(chunk_id), int(chunk_index)))

    result: list[int] = []
    seen: set[int] = set()
    lexical_order: dict[int, int] = {}
    for rank, chunk_id in enumerate(lexical_ids):
        lexical_order.setdefault(chunk_id, rank)
    for file_path, _score in file_rows:
        if file_path not in by_file:
            continue
        lexical_chunks = lexical_file.get(file_path, [])
        if lexical_chunks:
            chosen = min(
                lexical_chunks, key=lambda chunk_id: lexical_order.get(chunk_id, 10**9))
        else:
            chosen = min(by_file[file_path], key=lambda item: item[1])[0]
        if chosen in seen:
            continue
        seen.add(chosen)
        result.append(chosen)
    return result


def _coalesce_file_candidates(
    connection: sqlite3.Connection,
    representative_ids: list[int],
    ranked_ids: list[int],
) -> list[int]:
    """Move same-file channel contributions onto the file representative chunk."""
    ids = list(dict.fromkeys([*representative_ids, *ranked_ids]))
    if not representative_ids or not ranked_ids or not ids:
        return ranked_ids
    placeholders = ",".join("?" for _ in ids)
    file_by_id = {
        int(row[0]): str(row[1])
        for row in connection.execute(
            f"SELECT id, file_path FROM chunks WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    }
    representative_by_file = {
        file_by_id[chunk_id]: chunk_id
        for chunk_id in representative_ids
        if chunk_id in file_by_id
    }
    return [
        representative_by_file.get(file_by_id.get(chunk_id, ""), chunk_id)
        for chunk_id in ranked_ids
    ]


class IndexCompatibilityError(RuntimeError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Index rebuild required: " + "; ".join(problems))
