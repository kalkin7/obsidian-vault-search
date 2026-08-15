# Obsidian Vault Search

Desktop-only Obsidian plugin that owns the lifecycle of a local Python hybrid-search backend. The embedding model is loaded only while the vault plugin is active, and CLI clients query the same process.

## Install for development

```powershell
npm ci
npm run build
$Python = .\scripts\setup-backend.ps1 -Vault "C:\path\to\vault" | Select-Object -Last 1
.\scripts\install-dev.ps1 -Vault "C:\path\to\vault" -PythonExecutable $Python -Enable
```

## Install via BRAT (other computers)

1. Install the **BRAT** community plugin.
2. **Add Beta plugin** → `kalkin7/obsidian-vault-search`.
3. Reload Obsidian. A release must exist for the current plugin version.

BRAT installs the plugin files and `lightning.search.png`. On first run the
plugin downloads its Python backend (~700 KB) from the matching GitHub release
automatically, and keeps it in sync with the plugin version. Use **설정 → Python
백엔드 → 백엔드 설치/복구** to re-download or recover. First indexing still
needs a vector rebuild and the embedding model snapshot (see below).

Reload Obsidian and open **Vault Search Service** settings. The first installation needs **전체 재구축**. Indexes, runtime tokens, logs, and the Python path stay outside the vault under `%LOCALAPPDATA%\ObsidianVaultSearch`.

`setup-backend.ps1` defaults to `-Runtime auto`. It always prepares a CPU runtime and, when an NVIDIA
GPU is detected, explains the multi-GB CUDA download before asking whether to install the CUDA runtime.
Use `-AcceptCudaDownload` for an unattended approved CUDA install, or `-Runtime cpu` to explicitly keep
the installation CPU-only. The plugin also offers **CUDA 런타임 설치** later; existing CPU runtime and
settings remain active until CUDA installation and validation succeed. The default `engine=onnx` uses a
direct ONNX Runtime path on CPU or GPU; the CUDA runtime may additionally install the optional TensorRT
accelerator, which `provider=auto` uses to speed up indexing. See
[ONNX / TensorRT embedding engine](docs/onnx-tensorrt-engine.md).

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
vault-search --vault "C:\path\to\vault" search --top 40 --intent timeline --json "전체 경과"
```

The CLI discovers the vault from `--vault`, `OBSIDIAN_VAULT_ROOT`, or the
current directory walk-up (`.obsidian/`). With `first-search`, a `search` /
`rebuild-vectors` / `rebuild-all` call asks the already-running lightweight
plugin sidecar to load the model and waits for readiness. If no service is
running, the CLI starts a detached **standalone** backend from `machine.json`
(also when Obsidian is closed) and attaches to it; the plugin later attaches to
that standalone instead of killing it. `status` never auto-starts a service.

Timeline searches can cheaply supplement ranks 31-40 from explicit `sources`
in top-ranked wiki notes. The expansion follows the configured **위키 폴더**
(`wikiFolders`, default `5_Wiki/issues|entities|decisions`; empty disables it),
is limited to one hop and five source notes, and never performs a second model
search.

## Agent integration (에이전트 통합)

Coding agents in a vault only use `vault-search` if they can discover it. The
settings tab (**에이전트 통합 → 설치/갱신**) or the **Install agent
integration** command installs, on explicit user action only:

- a path-independent search wrapper `search.ps1` in the plugin directory,
- a marker-guarded `## Vault Search` section in the vault-root `AGENTS.md`,
- a skill at `.claude/skills/vault-search/SKILL.md`.

The AGENTS.md block is idempotent (re-run = unchanged) and never clobbers
user-authored search guidance: if the vault already instructs agents about
`vault-search` outside the managed marker block, the installer reports a
conflict and leaves the file untouched (K_Notes' hand-tuned AGENTS.md is
preserved this way). See [Agent integration](docs/agent-integration.md).

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
- [Agent integration](docs/agent-integration.md)
- [ONNX / TensorRT embedding engine](docs/onnx-tensorrt-engine.md)
- [CUDA / TensorRT production validation](docs/cuda-tensorrt-production-validation-2026-08-13.md)
- [Development](docs/development.md)
- [K_Notes migration and rollback](docs/migration-from-knotes.md)
- [2026-08-11 implementation report](docs/implementation-report-2026-08-11.md)
- [Search quality improvements and Omnisearch live comparison](docs/search-quality-improvements-2026-08-11.md)
- [Semantic search improvement roadmap](docs/semantic-search-improvement-roadmap-2026-08-11.md)
- [Original implementation plan](plan.md)
