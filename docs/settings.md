# Settings

Portable settings are stored in plugin `data.json`. The Python executable is machine-local and stored in `%LOCALAPPDATA%/ObsidianVaultSearch/vaults/<vault-id>/machine.json`.

## Runtime selection (P1)

- The plugin inspects candidate Pythons with the plugin-side backend on
  `PYTHONPATH`. CUDA capability is judged by **onnxruntime providers**
  (`CUDAExecutionProvider` / `TensorrtExecutionProvider`), not torch alone — a
  CUDA torch with a CPU-only onnxruntime is not selected as a GPU runtime.
- The selected executable is **resolved to its real interpreter path
  (`sys.executable`)** and persisted to `machine.json`, so the choice survives
  restarts instead of being re-derived from the default (`python`) every time.
- Bare command names (e.g. `python`) are still accepted: the wrapper resolves
  them via `Get-Command` and the CLI via `shutil.which`.

## Service status

The settings tab status block shows the effective execution state: 상태,
모델, 디바이스, 실행 제공자, PID/포트, 인덱스 개수. `디바이스` and `실행 제공자`
reflect **what is actually running**: `effective_provider` is the EP the loaded
ONNX session was built with, falling back to the config + runtime resolution
with a `(로드 전 예상)` marker while the model is not loaded (idle/loading).
An explicit `(설정: ...)` note is appended when the configured provider is not
`auto`, so a silent fallback (e.g. TensorRT became unavailable) is visible as
a mismatch instead of being hidden.

## Agent integration (P2-1)

Settings tab → **에이전트 통합** installs, on explicit user action, a search
wrapper, a marker-guarded `AGENTS.md` section, and a skill. It never runs
automatically and never overwrites user-authored search guidance. See
[Agent integration](agent-integration.md).

## Settings

- `loadPolicy` defaults are engine-aware: `first-search` for `engine=onnx` (fast cold start), `vault-open` for `engine=pytorch` (slow cold start). The default applies only when the setting is not explicitly chosen; changing the engine also updates the load policy while it is still at the previous engine's default.

- Search top-k, RRF, `maxChunksPerFile`, `titleRrfWeight`, `prefixFallback`, and
  `wikiFolders` changes are hot-applied — including to a live backend whose
  model is not loaded yet (lazy sidecar): `apply_search_config` is accepted in
  any live state, not only `ready`.
- `wikiFolders` (default `5_Wiki/issues`, `5_Wiki/entities`, `5_Wiki/decisions`)
  selects which vault-relative folders count as wiki pages whose `sources:`
  frontmatter feeds timeline/relation search expansion. An **empty list disables
  expansion** (no 5_Wiki layout needed). Changing it never triggers a rebuild.
- `maxChunksPerFile` defaults to 1 to maximize distinct-file coverage for agent retrieval.
- `titleRrfWeight` is the independent title retrieval channel weight; 0 disables the channel so only body/vector candidates remain.
- `prefixFallback` retries FTS5 with token prefixes only when exact BM25 returns no results.
- Include/exclude changes are hot-applied and reconciled.
- Model, device, engine, provider, prefixes, and normalization trigger an atomic vector rebuild.
- `engine` selects the embedding backend: `onnx` (default) or `pytorch`. `onnx` is a direct ONNX Runtime path for the `intfloat/multilingual-e5-base` model and runs on CPU or CUDA; see [ONNX / TensorRT engine](onnx-tensorrt-engine.md).
- `device` is `auto` (default), `cpu`, or `cuda`. With `engine=onnx`, `auto` uses CUDA when a CUDA-capable execution provider exists and CPU otherwise.
- `provider` (used when `engine=onnx` runs on CUDA — `device=cuda`, or
  `device=auto` resolving to CUDA) is `auto` (default), `cuda`, or `tensorrt`.
  `auto` prefers TensorRT when installed and falls back to the CUDA EP. The
  plugin exposes the provider options the running runtime reports as usable
  (status `capabilities`) and always keeps the saved value visible/selectable.
  See [ONNX / TensorRT engine](onnx-tensorrt-engine.md).
- `chunkingStrategy` defaults to `paragraph-v1`, which preserves the original paragraph chunker.
- `markdown-v2` keeps Markdown headings as embedding breadcrumbs and groups fences, tables, lists, and callouts at atom boundaries.
- Changing the chunking strategy, chunk size, or overlap triggers an atomic complete rebuild.
- Failed rebuilds restore the previous settings and index.
- Startup reconciliation uses fast mode: unchanged path, size, and nanosecond mtime tuples do not cause body reads.
- The manual **정밀 대조** action uses strict mode and hashes every current file.
- Interrupted incremental updates are replayed from the local pending-path journal when the backend starts.
- Only one backend may own a vault data directory. Startup waits for the prior managed process to stop and refuses a duplicate writer.

Paths are vault-relative POSIX-style globs. Absolute paths and traversal are rejected by the backend.

## AI Vault 답변

The AI Vault Search panel answers from the local hybrid search results. Choose
`openai`, `opencode-go`, or `deepseek`, enter the API key in the settings tab,
and use **모델 최신화** to fetch the provider's current model list. The key is
stored through Obsidian's `secretStorage` (never in plugin data or the vault)
and reaches the sidecar process only as an environment variable it sets at
startup; a host-process key can never leak in (provider env vars are
unconditionally overwritten from the stored secrets).

- **Agentic (deep) answers** — every question runs an agent loop: the model can
  call `search` (hybrid, top-40), `read` (a vault file — scoped to the
  include/exclude globs, `../` and out-of-vault symlinks rejected), and `grep`
  (bounded regex scan, pattern ≤ 200 chars) until it has enough evidence, then
  answers with `[S#]` citations. An automatic first search seeds the loop. The
  accumulated source budget follows `answerMaxContextChars`, and the output
  budget has a 4,000-token floor (reasoning models spend tokens on
  chain-of-thought). Without any sources the answer falls back to
  "볼트에서 충분한 근거를 찾지 못했습니다." instead of general knowledge.
- **Reasoning effort** — the composer shows a per-model **추론** selector
  (`auto` / `none` / `low` / `medium` / `high` / `xhigh` / `max`), restricted to
  the levels the current model supports (curated per official catalogs, with a
  provider fallback for new models; switching models resets an unsupported
  level to `auto`). OpenAI models receive the official nested
  `reasoning: {effort}`; compatible providers get a top-level
  `reasoning_effort`.
- **Favorite models** — in the settings model list, ★ marks favorites; only
  starred models (from providers with a stored key) appear in the composer's
  model selector, and selecting one switches the provider too. Model and
  favorite changes persist immediately (hot) — no "설정 적용" needed.
- **Conversation UI** — the panel keeps a chat history (question bubbles +
  per-answer blocks with markdown, tables, citation pills, and a hover copy
  button) for the session. Markdown headings of any level (`#`…`######`) are
  rendered as h3–h6. **답변 복사** produces note-ready markdown: `[S#]`
  citations become inline superscript wikilinks (`<sup>[[file|name]]</sup>`)
  that open the source file directly, plus a deduplicated `## 근거` list, so
  pasting an answer into a note keeps every reference live and clearly
  annotated.
- **Restart persistence** — every settings save rewrites `service-config.json`
  alongside the hot in-memory apply, so a sidecar restart keeps the currently
  selected provider/model/reasoning effort instead of reloading a stale
  snapshot from the last spawn.
- **API key validation** — 저장/테스트 probe the real chat endpoint with a
  one-token request: 401/403 is reported as an invalid key, a 2xx/3xx as
  valid, and anything else (network/timeout/429/5xx) as "확인 불가". Saving an
  empty value deletes the stored key.

The provider receives bounded source snippets, not the whole vault. Source text
is treated as untrusted data, and citations such as `[S1]` open the
corresponding note and line in Obsidian. Missing keys affect only answer
generation; ordinary vault search remains available.
