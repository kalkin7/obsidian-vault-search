# Implementation report — 2026-08-11

## Outcome

`obsidian-vault-search` v0.1.0 was completed, installed in K_Notes, and published to a private GitHub repository. The plugin-managed sidecar is now the standard hybrid-search path; the previous fixed-port daemon remains only as a rollback option.

## Delivered

- desktop-only Obsidian plugin with asynchronous lifecycle supervision
- dynamic loopback port, per-run token, runtime discovery, and machine-local configuration
- isolated versioned Python venv and installed `vault-search` CLI
- E5 query/passage prefixes and index compatibility metadata
- SQLite FTS5, USEARCH vectors, RRF fusion, and one-process model ownership
- validated temporary index builds with backup restoration on replacement failure
- hot search settings, scope reconciliation, vector rebuild, and complete rebuild classification
- coalesced/batched create, modify, rename, and delete synchronization
- `vault-open`, `first-search`, and manual load policies
- parent PID, nonblocking stdin EOF, heartbeat, graceful shutdown, and Windows process-tree fallback
- unit, integration, smoke, CI, release, migration, and rollback documentation

## Windows issues found and resolved

1. A blocking `stdin.read()` watcher prevented Sentence Transformers from completing under a Windows pipe. It was replaced with nonblocking `PeekNamedPipe` monitoring.
2. Torch inference and embedding work could stall in request-handler threads. Model and index operations now run through a main-thread task queue while health and heartbeat requests remain responsive.
3. Electron can throttle renderer timers in the background. Parent-PID liveness is therefore checked alongside heartbeat instead of treating a delayed timer as an immediate orphan.
4. Virtual-environment Python uses a launcher and worker process on Windows. Shutdown terminates the complete process tree and verifies runtime removal.
5. Runtime tokens were initially visible in persistent backend logs. Plugin-side log serialization now redacts them.

## K_Notes migration result

- model: `intfloat/multilingual-e5-base`
- device: CPU
- embedding dimension: 768
- indexed files: 2,865
- chunks: 8,537
- warm search, 10 runs: p50 approximately 0.12 s; p95 approximately 0.13 s
- cached restart/model ready: approximately 9–12 s
- normal stop: approximately 1 s, with PID and runtime removed
- create/modify/rename/delete smoke test: all passed

The standard vault entry point is:

```powershell
& .\9_System\scripts\vault-search\search.ps1 -Json "query"
```

## Automated verification

- TypeScript: 3 files, 5 tests passed
- Python: 14 tests passed
- Windows fake-model service lifecycle and parent EOF passed
- real E5 full build and search passed
- GitHub Actions CI passed on `main` and `v0.1.0`
- release workflow uploaded `obsidian-vault-search-v0.1.0.zip`

## Publication

- repository: <https://github.com/kalkin7/obsidian-vault-search> (private)
- release: <https://github.com/kalkin7/obsidian-vault-search/releases/tag/v0.1.0>
- release asset SHA-256: `3c3cf1da5783ff4f96d29f69d2f77a8cb5a3b795ab7bc08e8dd34c1bc2b4d900`

## Remaining scope

No required v0.1.0 work remains. The following are optional later work and were explicitly outside the MVP:

- public Obsidian Community Plugin submission
- mobile support
- offline BM25-only CLI mode
- one-shot ephemeral model mode
- multi-vault shared model broker
