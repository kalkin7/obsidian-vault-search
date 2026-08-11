from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


TITLE_INDEX_VERSION = 1


def compute_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def init_db(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.executescript("""
        PRAGMA journal_mode=DELETE;
        CREATE TABLE IF NOT EXISTS chunks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path   TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content     TEXT NOT NULL,
            UNIQUE(file_path, chunk_index)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            tokens,
            tokenize='ascii'
        );
        CREATE TABLE IF NOT EXISTS file_titles (
            file_path       TEXT NOT NULL UNIQUE,
            basename_tokens TEXT NOT NULL,
            directory_tokens TEXT NOT NULL,
            heading_tokens  TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(
            basename_tokens,
            directory_tokens,
            heading_tokens,
            tokenize='ascii'
        );
        CREATE TABLE IF NOT EXISTS file_state (
            file_path   TEXT PRIMARY KEY,
            file_hash   TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            indexed_at  REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS index_metadata (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    """)
    connection.commit()
    return connection


def insert_chunk(connection: sqlite3.Connection, file_path: str, chunk_index: int,
                 content: str, tokens: list[str]) -> int:
    cursor = connection.execute(
        "INSERT INTO chunks (file_path, chunk_index, content) VALUES (?, ?, ?)",
        (file_path, chunk_index, content),
    )
    row_id = int(cursor.lastrowid)
    connection.execute(
        "INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)",
        (row_id, " ".join(tokens)),
    )
    return row_id


def ensure_title_schema(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS file_titles (
            file_path       TEXT NOT NULL UNIQUE,
            basename_tokens TEXT NOT NULL,
            directory_tokens TEXT NOT NULL,
            heading_tokens  TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(
            basename_tokens,
            directory_tokens,
            heading_tokens,
            tokenize='ascii'
        );
    """)


def upsert_file_title(connection: sqlite3.Connection, file_path: str,
                      basename_tokens: list[str], directory_tokens: list[str],
                      heading_tokens: list[str]) -> None:
    existing = connection.execute(
        "SELECT rowid FROM file_titles WHERE file_path = ?", (file_path,)
    ).fetchone()
    basename = " ".join(basename_tokens)
    directory = " ".join(directory_tokens)
    headings = " ".join(heading_tokens)
    if existing is None:
        cursor = connection.execute(
            "INSERT INTO file_titles"
            " (file_path, basename_tokens, directory_tokens, heading_tokens)"
            " VALUES (?, ?, ?, ?)",
            (file_path, basename, directory, headings),
        )
        row_id = int(cursor.lastrowid)
    else:
        row_id = int(existing[0])
        connection.execute("DELETE FROM titles_fts WHERE rowid = ?", (row_id,))
        connection.execute(
            "UPDATE file_titles SET basename_tokens = ?, directory_tokens = ?,"
            " heading_tokens = ? WHERE rowid = ?",
            (basename, directory, headings, row_id),
        )
    connection.execute(
        "INSERT INTO titles_fts"
        " (rowid, basename_tokens, directory_tokens, heading_tokens)"
        " VALUES (?, ?, ?, ?)",
        (row_id, basename, directory, headings),
    )


def delete_file_titles(connection: sqlite3.Connection, file_paths: list[str]) -> None:
    if not file_paths:
        return
    placeholders = ",".join("?" for _ in file_paths)
    row_ids = [int(row[0]) for row in connection.execute(
        f"SELECT rowid FROM file_titles WHERE file_path IN ({placeholders})", file_paths
    ).fetchall()]
    if row_ids:
        row_placeholders = ",".join("?" for _ in row_ids)
        connection.execute(
            f"DELETE FROM titles_fts WHERE rowid IN ({row_placeholders})", row_ids)
    connection.execute(
        f"DELETE FROM file_titles WHERE file_path IN ({placeholders})", file_paths)


def title_index_needs_rebuild(connection: sqlite3.Connection) -> bool:
    ensure_title_schema(connection)
    value = connection.execute(
        "SELECT value FROM index_metadata WHERE key = 'title_index_version'"
    ).fetchone()
    try:
        version = int(json.loads(str(value[0]))) if value else 0
    except (TypeError, ValueError, json.JSONDecodeError):
        version = 0
    file_count = int(connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0])
    title_count = int(connection.execute("SELECT COUNT(*) FROM file_titles").fetchone()[0])
    return version != TITLE_INDEX_VERSION or file_count != title_count


def clear_title_index(connection: sqlite3.Connection) -> None:
    ensure_title_schema(connection)
    connection.execute("DELETE FROM titles_fts")
    connection.execute("DELETE FROM file_titles")


def mark_title_index_current(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)",
        ("title_index_version", json.dumps(TITLE_INDEX_VERSION)),
    )


def delete_files(connection: sqlite3.Connection, file_paths: list[str]) -> list[int]:
    if not file_paths:
        return []
    placeholders = ",".join("?" for _ in file_paths)
    ids = [int(row[0]) for row in connection.execute(
        f"SELECT id FROM chunks WHERE file_path IN ({placeholders})", file_paths
    ).fetchall()]
    if ids:
        id_placeholders = ",".join("?" for _ in ids)
        connection.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({id_placeholders})", ids)
        connection.execute(f"DELETE FROM chunks WHERE id IN ({id_placeholders})", ids)
    delete_file_titles(connection, file_paths)
    connection.execute(f"DELETE FROM file_state WHERE file_path IN ({placeholders})", file_paths)
    return ids


def upsert_file_state(connection: sqlite3.Connection, file_path: str,
                      file_hash: str, chunk_count: int) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO file_state"
        " (file_path, file_hash, chunk_count, indexed_at) VALUES (?, ?, ?, ?)",
        (file_path, file_hash, chunk_count, time.time()),
    )


def write_index_metadata(connection: sqlite3.Connection, metadata: dict[str, Any]) -> None:
    connection.executemany(
        "INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)",
        [(key, json.dumps(value, ensure_ascii=False)) for key, value in metadata.items()],
    )


def read_index_metadata(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    connection = sqlite3.connect(str(path))
    try:
        rows = connection.execute("SELECT key, value FROM index_metadata").fetchall()
        if not rows:
            return None
        return {str(key): json.loads(str(value)) for key, value in rows}
    except sqlite3.Error:
        return None
    finally:
        connection.close()


def index_counts(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"files": 0, "chunks": 0}
    connection = sqlite3.connect(str(path))
    try:
        return {
            "files": int(connection.execute("SELECT COUNT(*) FROM file_state").fetchone()[0]),
            "chunks": int(connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]),
        }
    finally:
        connection.close()
