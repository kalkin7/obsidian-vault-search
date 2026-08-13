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


def expected_metadata(config: SearchConfig, dimension: int,
                      effective_provider: str | None = None) -> dict[str, Any]:
    payload = {
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
    if config.engine == "onnx":
        if effective_provider is None:
            if config.device == "cpu":
                effective_provider = "CPUExecutionProvider"
            else:
                import onnxruntime as ort
                available = ort.get_available_providers()
                if ("CUDAExecutionProvider" not in available
                        and "TensorrtExecutionProvider" not in available):
                    effective_provider = "CPUExecutionProvider"
                else:
                    from .direct_onnx import _resolve_provider
                    effective_provider = _resolve_provider(config.provider)
        payload["effective_provider"] = effective_provider
    return payload


def build_metadata(config: SearchConfig, dimension: int, vector_path: Path,
                   vector_count: int, previous: dict[str, Any] | None = None,
                   effective_provider: str | None = None) -> dict[str, Any]:
    payload = expected_metadata(config, dimension, effective_provider)
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
    if "effective_provider" in expected:
        keys.append("effective_provider")
    if check_scope:
        keys.append("scope_config_hash")
    return [f"{key}: expected {expected.get(key)!r}, found {actual.get(key)!r}"
            for key in keys if actual.get(key) != expected.get(key)]


def validate_index_files(config: SearchConfig, dimension: int,
                         check_scope: bool = False,
                         effective_provider: str | None = None) -> list[str]:
    actual = load_metadata(config.metadata_path)
    expected = expected_metadata(config, dimension, effective_provider)
    problems = validate_metadata(actual, expected, check_scope)
    if actual is None:
        return problems
    db_metadata = read_index_metadata(config.db_path)
    if db_metadata is None:
        problems.append("SQLite index_metadata missing")
    else:
        if db_metadata.get("index_generation") != actual.get("index_generation"):
            problems.append("SQLite/metadata generation mismatch")
        # Cross-check the SQLite metadata against the expected engine/model
        # contract too. A generation match alone is insufficient: the SQLite
        # copy could have been written by a different engine or tokenizer.
        sqlite_problems = validate_metadata(db_metadata, expected, check_scope)
        problems.extend(sqlite_problems)
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


REBUILD_VECTORS_PREFIXES = (
    "engine:", "provider:", "effective_provider:", "model_id:",
    "embedding_dimension:", "normalize_embeddings:", "query_prefix:", "document_prefix:",
    "vector ", "metadata/vector",
)
REBUILD_ALL_PREFIXES = (
    "schema_version:", "lexical_schema_version:", "chunking_strategy:", "chunker_version:",
    "chunk_chars:", "chunk_overlap:", "tokenizer_version:", "scope_config_hash:",
    "SQLite ", "metadata missing", "generation mismatch", "lexical ", "missing lexical",
    "file lexical", "body lexical", "heading lexical", "chunk_headings_fts",
    "index missing", "Unsupported future state schema version",
    "Lexical migration", "State migration", "state schema", "core schema",
)


def classify_index_problems(problems: list[str]) -> str:
    """Classify compatibility problems into the minimal recovery action.

    ``rebuild_vectors`` re-embeds the same chunks (engine/provider/model/
    normalization/vector-file mismatches); ``rebuild_all`` re-chunks the vault
    (schema/chunking/tokenizer/scope/lexical mismatches). Any structural
    problem forces ``rebuild_all`` even if vector-only problems are also
    present.
    """
    if not problems:
        return "none"
    for problem in problems:
        if any(problem.startswith(prefix) for prefix in REBUILD_ALL_PREFIXES):
            return "rebuild_all"
    for problem in problems:
        if any(problem.startswith(prefix) for prefix in REBUILD_VECTORS_PREFIXES):
            return "rebuild_vectors"
    return "rebuild_all"


def write_metadata(path: Path, metadata: dict[str, Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)
