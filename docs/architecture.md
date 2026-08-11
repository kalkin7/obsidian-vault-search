# Architecture

Obsidian is the process supervisor; Python owns the model, SQLite FTS5, and USEARCH index.

1. The desktop-only plugin computes a path-derived vault ID.
2. It starts Python with `detached: false`, an open stdin pipe, and a dynamic loopback port.
3. Runtime, machine settings, logs, and indexes live under `%LOCALAPPDATA%/ObsidianVaultSearch`.
4. The backend exits on authenticated shutdown, stdin EOF, or heartbeat timeout.
5. Search and index writes share one process and an operation lock, so the model is loaded once.
6. Index replacement uses validated temporary files plus rollback backups.

`vault-open` loads the model after layout readiness. `first-search` starts only the lightweight sidecar; the first CLI search triggers model loading. `manual` starts nothing automatically.
