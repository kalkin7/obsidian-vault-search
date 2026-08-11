# Architecture

Obsidian is the process supervisor; Python owns the model, SQLite FTS5, and USEARCH index.

1. The desktop-only plugin computes a path-derived vault ID.
2. It starts Python with `detached: false`, an open stdin pipe, and a dynamic loopback port.
3. Runtime, machine settings, logs, and indexes live under `%LOCALAPPDATA%/ObsidianVaultSearch`.
4. The backend exits on authenticated shutdown, stdin EOF, or heartbeat timeout.
5. Search and index writes share one process and an operation lock, so the model is loaded once.
6. A file-level FTS5 auxiliary index ranks basename, directory, and H1-H3 fields independently of chunk embeddings.
7. The auxiliary title index self-migrates from vault files without rebuilding USEARCH vectors and follows incremental file events.
8. Search merges body BM25 chunks, title-matched files (mapped to a representative chunk), and vector results as independent channels via weighted reciprocal-rank fusion, then caps chunks per file for result diversity.
9. Index replacement uses validated temporary files plus rollback backups.
10. Schema v2 stores display content separately from heading-aware embedding text and source line ranges. Empty Markdown files receive one lexical-only title chunk, which is searchable through FTS/title channels but deliberately omitted from USEARCH.
11. Vector-count validation compares USEARCH entries with non-lexical-only DB chunks; total chunk counts still include lexical-only title chunks.

`vault-open` loads the model after layout readiness. `first-search` starts only the lightweight sidecar; the first CLI search triggers model loading. `manual` starts nothing automatically.
