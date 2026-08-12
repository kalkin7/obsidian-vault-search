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
10. Schema v2 stores display content separately from heading-aware embedding text and source line ranges. Under `markdown-v2`, empty Markdown files receive one lexical-only title chunk, which is searchable through lexical channels but deliberately omitted from USEARCH. The compatibility `paragraph-v1` strategy retains its original empty-file behavior until the default strategy changes.
11. Vector-count validation compares USEARCH entries with non-lexical-only DB chunks; total chunk counts still include lexical-only title chunks.
12. `STATE_SCHEMA_VERSION=2` is independent from core and lexical schema versions. It adds required `file_size` and `modified_ns` columns plus `pending_paths`. Existing databases migrate through a validated temporary DB copy and DB-only atomic replacement; vectors and embedding metadata are not rewritten. A future state version is rejected and never downgraded.
13. Fast reconciliation stats every in-scope path but reads only new or stat-changed bodies. Reads use a bounded stat-read-stat retry so content, hash, chunks, and stored stat come from one stable snapshot. A stat-only change with the same SHA-256 updates file state without embedding. Strict reconciliation hashes every current file.
14. Incremental operations commit changed and deleted paths to `pending_paths` before building temporary index files. A successful generation removes those rows from the installed DB; startup replays remaining rows in batches of 400. Transient replay failures keep the prior valid generation ready and expose a retry warning.
15. Multi-file replacement writes a durable operation manifest before moving targets to unique backups. Startup holds the writer lock and rolls an interrupted install back to the complete prior generation. Validation removes the manifest before best-effort backup cleanup, so a manifest-free target set is never a partial install.
16. A service-lifetime OS file lock permits one backend writer per vault data directory, preventing cross-process replacement and rollback races.
17. Status and heartbeat never open SQLite. Worker-controlled initialization and index-operation boundaries refresh cached counts; incompatible or unreadable future schemas report counts as unavailable instead of aborting before compatibility checks.
18. Startup recovery removes UUID-suffixed stale operation temps and backups only after processing any replacement manifest. Files named by an active manifest are protected until rollback completes.
19. `engine=onnx` uses a direct ONNX Runtime backend for the fixed e5-base model. `provider=auto` prefers TensorRT (when its runtime is installed) and otherwise falls back to the CUDA EP; ORT can silently return a CUDA-primary session, which `auto` also treats as a fallback and rebuilds as a CUDA-only session. TRT engines are cached under `dataDir/trt-cache/<key>` (keyed by ONNX path, ORT/TRT versions, batch profile) with a size cap. The metadata records both the requested and the effective provider, and the effective provider participates in the index compatibility gate, so an environment change invalidates the index even under `provider=auto`. See [ONNX / TensorRT engine](onnx-tensorrt-engine.md).

`vault-open` loads the model after layout readiness. `first-search` starts only the lightweight sidecar; the first CLI search triggers model loading. `manual` starts nothing automatically.
