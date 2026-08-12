# Protocol

The service uses one JSON Lines request per TCP connection on a dynamic `127.0.0.1` port. Every request includes protocol version 1, request ID, and the random token from `runtime.json`.

Methods: `health`, `status`, `load_model`, `search`, `sync_paths`, `reconcile`, `preview_scope`, `rebuild_vectors`, `rebuild_all`, `apply_search_config`, `heartbeat`, `shutdown`.

Messages are limited to 2 MiB. Unknown versions and invalid tokens are rejected. No method accepts commands or unrestricted absolute file paths.

`search` accepts optional `top_k`, `verbose`, and `match_mode` parameters. `match_mode` defaults to
`any` and also accepts `all` or `phrase`; invalid values return `INVALID_PARAMS` without changing
protocol version 1. With `verbose: true`, each result includes query tokens, match mode, contributing
channels (`body`, `heading`, `file`, `vector`), per-channel ranks, and RRF contributions. The stable result fields remain `rank`,
`file_path`, `score`, and `content`.

Verbose results expose `body_rank`, `heading_rank`, `file_rank`, and `vector_rank`. The older
`bm25_rank`, `title_rank`, `title` channel, and `title` contribution aliases remain for protocol v1
consumers. Title aliases mirror the generalized file signal and do not add a second RRF score.

`reconcile` accepts an optional `mode` parameter without changing protocol version 1. The default is
`fast`, which stats current files and skips unchanged bodies. `strict` hashes every current file. Any
other value returns `INVALID_PARAMS`.

Status responses may include `pending_recovery_required: true` and `pending_recovery_warning` after a
transient startup replay failure. The existing searchable generation remains available; a later sync
or restart retries the journal.

`status` and `heartbeat` return cached index counts and never open SQLite. `count_available: false`
means the backend could not refresh counts at a worker-controlled boundary, including an incompatible
future database shape; compatibility errors are still returned through the existing rebuild-required path.
