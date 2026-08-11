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
