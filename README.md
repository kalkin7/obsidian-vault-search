# Obsidian Vault Search

Desktop-only Obsidian plugin that owns the lifecycle of a local Python hybrid-search backend. The embedding model is loaded only while the vault plugin is active, and CLI clients query the same process.

## Install for development

```powershell
npm ci
npm run build
$Python = .\scripts\setup-backend.ps1 -Vault "C:\path\to\vault" | Select-Object -Last 1
.\scripts\install-dev.ps1 -Vault "C:\path\to\vault" -PythonExecutable $Python -Enable
```

Reload Obsidian and open **Vault Search Service** settings. The first installation needs **전체 재구축**. Indexes, runtime tokens, logs, and the Python path stay outside the vault under `%LOCALAPPDATA%\ObsidianVaultSearch`.

## Test

```powershell
.\scripts\smoke-test.ps1
```

The integration suite uses a deterministic fake model and does not download Hugging Face files.

## CLI

After `setup-backend.ps1`, use the venv-installed wrapper:

```powershell
vault-search --vault "C:\path\to\vault" status
vault-search --vault "C:\path\to\vault" search --top 20 --json "검색어"
```

The CLI does not start an orphan service. With `first-search`, it asks the already-running lightweight plugin sidecar to load the model and waits for readiness. If the plugin is unavailable it exits in about one second with code 3.

## Lifecycle guarantees

- dynamic loopback port and per-run authentication token
- non-detached child process
- authenticated shutdown, stdin EOF watcher, and heartbeat timeout
- one model instance for search and indexing
- validated temporary index files with rollback backups
- model/chunk metadata compatibility checks before search

## Documentation

- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Settings](docs/settings.md)
- [Development](docs/development.md)
- [K_Notes migration and rollback](docs/migration-from-knotes.md)
- [2026-08-11 implementation report](docs/implementation-report-2026-08-11.md)
- [Search quality improvements and Omnisearch live comparison](docs/search-quality-improvements-2026-08-11.md)
- [Semantic search improvement roadmap](docs/semantic-search-improvement-roadmap-2026-08-11.md)
- [Original implementation plan](plan.md)
