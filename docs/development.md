# Development

```powershell
npm ci
npm run build
npm test
python -X utf8 -m pytest backend/tests
.\scripts\setup-backend.ps1 -Vault "C:\path\to\vault"
.\scripts\install-dev.ps1 -Vault "C:\path\to\vault" -PythonExecutable "<venv-python>" -Enable
```

Unit and integration tests use the deterministic `__fake__` embedding model and do not download a model. Real-model smoke tests are Windows-only manual checks.

Lexical matching defaults to OR semantics. Use `--match all` to require every Kiwi token or
`--match phrase` to require adjacent tokens in order. `--verbose --json` includes channel ranks and
RRF contributions.

The lexical index uses `yaml.safe_load()` to extract aliases, tags, and scalar/nested properties.
Malformed frontmatter is logged by path and indexed with empty metadata; frontmatter source is never
written to logs. Lexical schema upgrades do not re-encode or rewrite vectors.

State schema upgrades are also non-embedding migrations. `STATE_SCHEMA_VERSION=2` is stored as the
SQLite `user_version`; migration adds file stat columns and the pending-path journal in a temporary DB
copy, validates it, and atomically replaces only `chunks.db`. Keep protocol version 1 when extending
`reconcile`: omitted `mode` must remain fast and invalid values must return `INVALID_PARAMS`.

Index replacement tests must cover post-install validation rollback, partial multi-target install
failure, and backup cleanup failure. The backup files are disposable only after validation succeeds.
Run the 2,000-file fast reconcile test when changing file discovery or state comparisons; unchanged
Markdown body reads must remain zero.

The backend acquires `%LOCALAPPDATA%/ObsidianVaultSearch/.../writer.lock` before replacement recovery,
migrations, or index writes and holds the OS lock until shutdown. Never bypass this lock in a second
backend process. Replacement crash tests simulate termination after every backup and install move;
`replace-operation.json` must restore the prior complete generation on the next startup.

Every UUID operation temp is owned by one rebuild, migration, or incremental call and must be removed
on any exception before manifest installation. After manifest recovery, startup removes unreferenced
UUID temp and backup artifacts. Cleanup must never remove source or backup names referenced by an
active manifest. Status and heartbeat are cache-only; do not add direct `index_counts()` calls there.

```powershell
vault-search --vault "C:\path\to\vault" search --match all --verbose --json "전기차 충전시설"
```

## Omnisearch live comparison — critical safety rule

**Do not enable the Omnisearch HTTP API, edit its `data.json`, or run `obsidian plugin:reload id=omnisearch` merely to compare search results.**

Omnisearch 1.30.1 clears its search cache in production `onunload()`. A developer reload therefore removes the cache, and the next load indexes the whole supported vault again. In K_Notes, PDF, Office, and image indexing are enabled and `hideExcluded` is false, so one cache miss scans about 7,946 files, including `9_System/attachments` and benchmark files. Reloading again while `populateIndex()` is still running can overlap old and new asynchronous indexing jobs.

Use the public in-process API through Obsidian CLI instead. This performs a live query against the already loaded Omnisearch index without changing settings, opening an unauthenticated port, reloading the plugin, or clearing its cache.

```powershell
$Query = "층간소음"
obsidian eval code="(async () => JSON.stringify((await globalThis.omnisearch.search('$Query')).slice(0,20).map(x => ({path:x.path, score:x.score}))))()"
```

For repeatable comparisons:

1. Confirm Omnisearch is enabled and its normal indexing has finished.
2. Query `globalThis.omnisearch.search()` with `obsidian eval` only.
3. Query Vault Search through `vault-search ... search --json`.
4. Save both result path lists and compare them offline.
5. Never reload Omnisearch during an active indexing job.
