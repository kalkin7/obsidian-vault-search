from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from . import __version__
from .config import SearchConfig
from .database import index_counts, lexical_index_problems, read_index_metadata

SCHEMA_VERSION = 2
LEXICAL_SCHEMA_VERSION = 2


def expected_metadata(config: SearchConfig, dimension: int) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "lexical_schema_version": LEXICAL_SCHEMA_VERSION,
        "backend_version": __version__,
        "model_id": config.model_id,
        "engine": config.engine,
        "provider": config.provider,
        "embedding_dimension": int(dimension),
        "normalize_embeddings": config.normalize_embeddings,
        "query_prefix": config.query_prefix,
        "document_prefix": config.document_prefix,
        "chunk_chars": config.chunk_chars,
        "chunk_overlap": config.chunk_overlap,
        "chunking_strategy": config.chunking_strategy,
        "chunker_version": 1 if config.chunking_strategy == "paragraph-v1" else 2,
        "tokenizer_version": "kiwi-pos-v1",
        "scope_config_hash": config.scope_hash(),
    }


def build_metadata(config: SearchConfig, dimension: int, vector_path: Path,
                   vector_count: int, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = expected_metadata(config, dimension)
    now = time.time()
    payload.update({
        "index_generation": uuid.uuid4().hex,
        "vector_count": int(vector_count),
        "vector_file_size": vector_path.stat().st_size,
        "created_at": (previous or {}).get("created_at", now),
        "updated_at": now,
    })
    return payload


def load_metadata(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return None


def validate_metadata(actual: dict[str, Any] | None, expected: dict[str, Any],
                      check_scope: bool = False) -> list[str]:
    if actual is None:
        return ["metadata missing"]
    keys = [
        "schema_version", "model_id", "embedding_dimension",
        "lexical_schema_version",
        "engine", "provider",
        "normalize_embeddings", "query_prefix", "document_prefix",
        "chunk_chars", "chunk_overlap", "chunking_strategy", "chunker_version",
        "tokenizer_version",
    ]
    if check_scope:
        keys.append("scope_config_hash")
    return [f"{key}: expected {expected.get(key)!r}, found {actual.get(key)!r}"
            for key in keys if actual.get(key) != expected.get(key)]


def validate_index_files(config: SearchConfig, dimension: int,
                         check_scope: bool = False) -> list[str]:
    actual = load_metadata(config.metadata_path)
    problems = validate_metadata(actual, expected_metadata(config, dimension), check_scope)
    if actual is None:
        return problems
    db_metadata = read_index_metadata(config.db_path)
    if db_metadata is None:
        problems.append("SQLite index_metadata missing")
    elif db_metadata.get("index_generation") != actual.get("index_generation"):
        problems.append("SQLite/metadata generation mismatch")
    if config.db_path.exists():
        import sqlite3
        connection = sqlite3.connect(str(config.db_path))
        try:
            problems.extend(lexical_index_problems(connection))
        except sqlite3.Error as exc:
            problems.append(f"lexical index invalid: {type(exc).__name__}: {exc}")
        finally:
            connection.close()
    if not config.vector_path.exists():
        problems.append("vector index missing")
        return problems
    try:
        from usearch.index import Index
        vector_index = Index.restore(str(config.vector_path))
        actual_dimension = int(vector_index.ndim)
        actual_count = len(vector_index)
        if actual_dimension != int(dimension):
            problems.append(f"vector dimension: expected {dimension}, found {actual_dimension}")
        db_count = index_counts(config.db_path)["vector_chunks"]
        if actual_count != db_count:
            problems.append(f"vector count: expected {db_count}, found {actual_count}")
        if actual.get("vector_count") != actual_count:
            problems.append("metadata/vector count mismatch")
        if actual.get("vector_file_size") != config.vector_path.stat().st_size:
            problems.append("metadata/vector file size mismatch")
    except Exception as exc:
        problems.append(f"vector index invalid: {type(exc).__name__}: {exc}")
    return problems


def write_metadata(path: Path, metadata: dict[str, Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)
