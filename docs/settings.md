# Settings

Portable settings are stored in plugin `data.json`. The Python executable is machine-local and stored in `%LOCALAPPDATA%/ObsidianVaultSearch/vaults/<vault-id>/machine.json`.

- Search top-k and RRF changes are hot-applied.
- Include/exclude changes are hot-applied and reconciled.
- Model, device, prefixes, and normalization trigger an atomic vector rebuild.
- Chunk size or overlap triggers an atomic complete rebuild.
- Failed rebuilds restore the previous settings and index.

Paths are vault-relative POSIX-style globs. Absolute paths and traversal are rejected by the backend.
