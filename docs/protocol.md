# Protocol

The service uses one JSON Lines request per TCP connection on a dynamic `127.0.0.1` port. Every request includes protocol version 1, request ID, and the random token from `runtime.json`.

Methods: `health`, `status`, `load_model`, `search`, `sync_paths`, `reconcile`, `preview_scope`, `rebuild_vectors`, `rebuild_all`, `apply_search_config`, `heartbeat`, `shutdown`.

Messages are limited to 2 MiB. Unknown versions and invalid tokens are rejected. No method accepts commands or unrestricted absolute file paths.
