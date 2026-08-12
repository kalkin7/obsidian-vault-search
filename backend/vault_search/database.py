from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


def compute_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def init_db(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.executescript("""
        PRAGMA journal_mode=DELETE;
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            heading_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            embedding_text TEXT NOT NULL,
            lexical_only INTEGER NOT NULL DEFAULT 0,
            UNIQUE(file_path, chunk_index)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(tokens, tokenize='ascii');
        CREATE TABLE IF NOT EXISTS file_fields (
            file_path TEXT NOT NULL UNIQUE,
            basename_tokens TEXT NOT NULL,
            directory_tokens TEXT NOT NULL,
            alias_tokens TEXT NOT NULL,
            tag_tokens TEXT NOT NULL,
            property_tokens TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS file_fields_fts USING fts5(
            basename_tokens, directory_tokens, alias_tokens, tag_tokens, property_tokens,
            tokenize='ascii'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_headings_fts USING fts5(
            heading_tokens, tokenize='ascii'
        );
        CREATE TABLE IF NOT EXISTS file_state (
            file_path TEXT PRIMARY KEY,
            file_hash TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            indexed_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    """)
    connection.commit()
    return connection


def ensure_lexical_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS file_fields (
            file_path TEXT NOT NULL UNIQUE,
            basename_tokens TEXT NOT NULL,
            directory_tokens TEXT NOT NULL,
            alias_tokens TEXT NOT NULL,
            tag_tokens TEXT NOT NULL,
            property_tokens TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS file_fields_fts USING fts5(
            basename_tokens, directory_tokens, alias_tokens, tag_tokens, property_tokens,
            tokenize='ascii'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_headings_fts USING fts5(
            heading_tokens, tokenize='ascii'
        );
    """)


def lexical_index_problems(connection: sqlite3.Connection) -> list[str]:
    required = {
        "chunks", "chunks_fts", "file_state", "file_fields",
        "file_fields_fts", "chunk_headings_fts",
    }
    existing = {str(row[0]) for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    missing = sorted(required - existing)
    if missing:
        return ["missing lexical tables: " + ", ".join(missing)]

    problems: list[str] = []
    file_count = int(connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0])
    field_count = int(connection.execute("SELECT COUNT(*) FROM file_fields").fetchone()[0])
    field_fts_count = int(connection.execute(
        "SELECT COUNT(*) FROM file_fields_fts").fetchone()[0])
    chunk_count = int(connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
    body_count = int(connection.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0])
    heading_count = int(connection.execute(
        "SELECT COUNT(*) FROM chunk_headings_fts").fetchone()[0])
    if field_count != file_count or field_fts_count != field_count:
        problems.append(
            f"file lexical row count mismatch: state={file_count}, fields={field_count},"
            f" fts={field_fts_count}")
    if body_count != chunk_count:
        problems.append(f"body lexical row count mismatch: chunks={chunk_count}, fts={body_count}")
    if heading_count != chunk_count:
        problems.append(
            f"heading lexical row count mismatch: chunks={chunk_count}, fts={heading_count}")
    heading_difference = int(connection.execute("""
        SELECT COUNT(*) FROM (
            SELECT id AS rowid FROM chunks
            EXCEPT SELECT rowid FROM chunk_headings_fts
        )
    """).fetchone()[0]) + int(connection.execute("""
        SELECT COUNT(*) FROM (
            SELECT rowid FROM chunk_headings_fts
            EXCEPT SELECT id AS rowid FROM chunks
        )
    """).fetchone()[0])
    if heading_difference:
        problems.append("chunk_headings_fts rowids do not match chunks.id")
    return problems


def insert_chunk(connection: sqlite3.Connection, file_path: str, chunk_index: int,
                 content: str, tokens: list[str], heading_path: tuple[str, ...] = (),
                 start_line: int = 1, end_line: int = 1,
                 embedding_text: str | None = None, lexical_only: bool = False,
                 heading_tokens: list[str] | None = None) -> int:
    cursor = connection.execute(
        "INSERT INTO chunks (file_path, chunk_index, content, heading_path, start_line,"
        " end_line, embedding_text, lexical_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (file_path, chunk_index, content, json.dumps(heading_path, ensure_ascii=False),
         start_line, end_line, embedding_text if embedding_text is not None else content,
         int(lexical_only)),
    )
    row_id = int(cursor.lastrowid)
    connection.execute("INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)",
                       (row_id, " ".join(tokens)))
    connection.execute(
        "INSERT INTO chunk_headings_fts(rowid, heading_tokens) VALUES (?, ?)",
        (row_id, " ".join(heading_tokens or [])),
    )
    return row_id


def upsert_file_fields(connection: sqlite3.Connection, file_path: str,
                       basename_tokens: list[str], directory_tokens: list[str],
                       alias_tokens: list[str], tag_tokens: list[str],
                       property_tokens: list[str]) -> None:
    existing = connection.execute(
        "SELECT rowid FROM file_fields WHERE file_path = ?", (file_path,)).fetchone()
    values = tuple(" ".join(tokens) for tokens in (
        basename_tokens, directory_tokens, alias_tokens, tag_tokens, property_tokens))
    if existing is None:
        cursor = connection.execute(
            "INSERT INTO file_fields (file_path, basename_tokens, directory_tokens, alias_tokens,"
            " tag_tokens, property_tokens) VALUES (?, ?, ?, ?, ?, ?)", (file_path, *values))
        row_id = int(cursor.lastrowid)
    else:
        row_id = int(existing[0])
        connection.execute("DELETE FROM file_fields_fts WHERE rowid = ?", (row_id,))
        connection.execute(
            "UPDATE file_fields SET basename_tokens=?, directory_tokens=?, alias_tokens=?,"
            " tag_tokens=?, property_tokens=? WHERE rowid=?", (*values, row_id))
    connection.execute(
        "INSERT INTO file_fields_fts (rowid, basename_tokens, directory_tokens, alias_tokens,"
        " tag_tokens, property_tokens) VALUES (?, ?, ?, ?, ?, ?)", (row_id, *values))


def delete_files(connection: sqlite3.Connection, file_paths: list[str]) -> list[int]:
    if not file_paths:
        return []
    placeholders = ",".join("?" for _ in file_paths)
    rows = connection.execute(
        f"SELECT id, lexical_only FROM chunks WHERE file_path IN ({placeholders})", file_paths
    ).fetchall()
    all_ids = [int(row[0]) for row in rows]
    vector_ids = [int(row[0]) for row in rows if not bool(row[1])]
    if all_ids:
        ids = ",".join("?" for _ in all_ids)
        connection.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({ids})", all_ids)
        connection.execute(f"DELETE FROM chunk_headings_fts WHERE rowid IN ({ids})", all_ids)
        connection.execute(f"DELETE FROM chunks WHERE id IN ({ids})", all_ids)
    field_rows = connection.execute(
        f"SELECT rowid FROM file_fields WHERE file_path IN ({placeholders})", file_paths).fetchall()
    field_ids = [int(row[0]) for row in field_rows]
    if field_ids:
        ids = ",".join("?" for _ in field_ids)
        connection.execute(f"DELETE FROM file_fields_fts WHERE rowid IN ({ids})", field_ids)
    connection.execute(f"DELETE FROM file_fields WHERE file_path IN ({placeholders})", file_paths)
    connection.execute(f"DELETE FROM file_state WHERE file_path IN ({placeholders})", file_paths)
    return vector_ids


def upsert_file_state(connection: sqlite3.Connection, file_path: str,
                      file_hash: str, chunk_count: int) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO file_state (file_path, file_hash, chunk_count, indexed_at)"
        " VALUES (?, ?, ?, ?)", (file_path, file_hash, chunk_count, time.time()))


def write_index_metadata(connection: sqlite3.Connection, metadata: dict[str, Any]) -> None:
    connection.executemany(
        "INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)",
        [(key, json.dumps(value, ensure_ascii=False)) for key, value in metadata.items()])


def read_index_metadata(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    connection = sqlite3.connect(str(path))
    try:
        rows = connection.execute("SELECT key, value FROM index_metadata").fetchall()
        return {str(key): json.loads(str(value)) for key, value in rows} if rows else None
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def index_counts(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"files": 0, "chunks": 0}
    connection = sqlite3.connect(str(path))
    try:
        files = int(connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0])
        chunks = int(connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])
        columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(chunks)")}
        vector_chunks = int(connection.execute(
            "SELECT COUNT(*) FROM chunks WHERE lexical_only = 0").fetchone()[0]) \
            if "lexical_only" in columns else chunks
        return {"files": files, "chunks": chunks, "vector_chunks": vector_chunks}
    finally:
        connection.close()
