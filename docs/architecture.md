# Architecture

Obsidian is the process supervisor; Python owns the model, SQLite FTS5, and USEARCH index.

1. The desktop-only plugin computes a path-derived vault ID.
2. It starts Python with `detached: false`, an open stdin pipe, and a dynamic loopback port.
3. Runtime, machine settings, logs, and indexes live under `%LOCALAPPDATA%/ObsidianVaultSearch`.
4. The backend exits on authenticated shutdown, stdin EOF, or heartbeat timeout.
5. Search and index writes share one process and an operation lock, so the model is loaded once.
6. A file-level FTS5 auxiliary index ranks basename, directory, and H1-H3 fields independently of chunk embeddings.
7. The auxiliary title index self-migrates from vault files without rebuilding USEARCH vectors and follows incremental file events.
8. Final ranking fuses body BM25, vector, and title ranks, then caps chunks per file for result diversity.
9. Index replacement uses validated temporary files plus rollback backups.

`vault-open` loads the model after layout readiness. `first-search` starts only the lightweight sidecar; the first CLI search triggers model loading. `manual` starts nothing automatically.
