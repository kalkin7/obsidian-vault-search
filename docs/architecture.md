# Architecture

Obsidian is the process supervisor; Python owns the model, SQLite FTS5, and USEARCH index.

1. The desktop-only plugin computes a path-derived vault ID.
2. It starts Python with `detached: false`, an open stdin pipe, and a dynamic loopback port.
3. Runtime, machine settings, logs, and indexes live under `%LOCALAPPDATA%/ObsidianVaultSearch`.
4. The backend exits on authenticated shutdown, stdin EOF, or heartbeat timeout.
5. Search and index writes share one process and an operation lock, so the model is loaded once.
6. A file-level FTS5 index ranks basename, directory, aliases, tags, and properties with initial field weights `10, 7, 8, 3, 2`. A separate chunk-level FTS5 index maps heading matches directly to `chunks.id`; the body FTS contains body tokens only.
7. `LEXICAL_SCHEMA_VERSION=2` is independent from core `SCHEMA_VERSION=2`. Older lexical indexes migrate in a temporary DB copy, validate row counts and SQLite integrity, then atomically replace only the DB and metadata generation. `vectors.usearch` is never rewritten by this migration, and failures leave the prior generation intact.
8. Search merges body, heading, file, and vector candidates via weighted reciprocal-rank fusion, then caps chunks per file for result diversity. File candidates retain the established representative-chunk and vector coalescing behavior.
9. Index replacement uses validated temporary files plus rollback backups.
10. Schema v2 stores display content separately from heading-aware embedding text and source line ranges. Empty Markdown files receive one lexical-only title chunk, which is searchable through lexical channels but deliberately omitted from USEARCH.
11. Vector-count validation compares USEARCH entries with non-lexical-only DB chunks; total chunk counts still include lexical-only title chunks.

`vault-open` loads the model after layout readiness. `first-search` starts only the lightweight sidecar; the first CLI search triggers model loading. `manual` starts nothing automatically.
