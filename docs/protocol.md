# Protocol

The service uses one JSON Lines request per TCP connection on a dynamic `127.0.0.1` port. Every request includes protocol version 1, request ID, and the random token from `runtime.json`.

Methods: `health`, `status`, `load_model`, `search`, `answer`, `sync_paths`, `reconcile`, `preview_scope`, `rebuild_vectors`, `rebuild_all`, `apply_search_config`, `heartbeat`, `shutdown`.

Messages are limited to 2 MiB. Unknown versions and invalid tokens are rejected. No method accepts commands or unrestricted absolute file paths.

`search` accepts optional `top_k`, `verbose`, `intent`, and `match_mode` parameters. `match_mode` defaults to
`any` and also accepts `all` or `phrase`; invalid values return `INVALID_PARAMS` without changing
protocol version 1. With `verbose: true`, each result includes query tokens, match mode, contributing
channels (`body`, `heading`, `file`, `vector`), per-channel ranks, and RRF contributions. The stable result fields remain `rank`,
`file_path`, `score`, and `content`.

Verbose results expose `body_rank`, `heading_rank`, `file_rank`, and `vector_rank`. The older
`bm25_rank`, `title_rank`, `title` channel, and `title` contribution aliases remain for protocol v1
consumers. Title aliases mirror the generalized file signal and do not add a second RRF score.

For `intent: timeline`, search may fill ranks 31-40 with up to five explicit `sources` from the top
five direct Wiki issue, entity, or decision results. The direct top 30 never move. This bounded one-hop
expansion performs no additional embedding or lexical search. If `intent` is omitted, only conservative
relationship phrases such as `연결`, `전체 경과`, or `공통 패턴` enable it. Expanded results include
`expanded: true`, `source: wiki_sources`, and `linked_from`; their score is a synthetic tail score rather
than an RRF contribution.

`reconcile` accepts an optional `mode` parameter without changing protocol version 1. The default is
`fast`, which stats current files and skips unchanged bodies. `strict` hashes every current file. Any
other value returns `INVALID_PARAMS`.

Status responses may include `pending_recovery_required: true` and `pending_recovery_warning` after a
transient startup replay failure. The existing searchable generation remains available; a later sync
or restart retries the journal.

Status responses also expose index compatibility state: `index_validation_state`
(`pending` | `compatible` | `incompatible`), `index_rebuild_required`, `index_problems`, and
`recommended_action` (`rebuild_vectors` | `rebuild_all` | null). The action is the minimal recovery
the CLI, settings tab, and startup notice all recommend. Validation is cached at
initialization/reconcile/rebuild boundaries and never recomputed per status call.

Status responses expose the runtime's effective execution state, not just the
configured values:

- `device` — the device the model runs on. When loaded this is the actual
  device; before load (idle/loading) it is resolved from config + runtime
  (e.g. `auto` with a CUDA-capable EP reports `cuda`), so an idle service
  never reports a misleading `cpu`.
- `provider` — the configured provider value (`auto` | `cuda` | `tensorrt`).
- `expected_provider` — the EP the ONNX engine will run on, resolved pre-load
  from config + runtime (`TensorrtExecutionProvider` |
  `CUDAExecutionProvider` | `CPUExecutionProvider`), or null only for the
  PyTorch engine (a CPU device resolves to `CPUExecutionProvider`).
- `effective_provider` — the EP the loaded ONNX session was actually built
  with (the truth), or null while the model is not loaded. A silent fallback
  (e.g. TensorRT removed) shows up as a mismatch between `effective_provider`
  and `provider`.
- `capabilities` — what the current runtime can execute: `onnx_available`,
  `cuda_available`, `tensorrt_available`, `model_available`,
  `derived_model_available`. CUDA/TensorRT availability is gated on an actual
  `torch.cuda.is_available()` init, not just EP registration.

`search` responses include an optional `diagnostics` object inside the data payload with
`candidate_pool_size`, `requested_top_k`, and `returned_count`. When `requested_top_k` exceeds
`candidate_pool_size`, the CLI prints a warning on stderr. `rebuild_vectors` and `rebuild_all`
perform the corresponding recovery and clear the incompatibility cache on success.

`rebuild_vectors` fails with a coded `INDEX_REBUILD_REQUIRED` error (including
`recommended_action: rebuild_all`) when the base lexical index is missing or structurally
incompatible — a vectors-only rebuild cannot create `chunks.db` — instead of a raw
`FileNotFoundError`. The CLI prints the matching Korean recovery hint for either action.

The wiki sources expansion in `intent: timeline` follows the configured `wikiFolders` (see
[Settings](settings.md)); an empty folder list disables the expansion.

`status` and `heartbeat` return cached index counts and never open SQLite. `count_available: false`
means the backend could not refresh counts at a worker-controlled boundary, including an incompatible
future database shape; compatibility errors are still returned through the existing rebuild-required path.

## `answer`

`answer` is an additive protocol-v1 method. It searches the local hybrid index first,
then sends only bounded, explicitly labelled source blocks to the selected provider.
`query` is limited to 8,000 characters, `top_k` to 1–12, context to 8,000–32,000
characters, and conversation to four complete user/assistant turns with each
message at most 8,000 characters. Empty evidence returns `GROUNDING_EMPTY` without
calling a provider. Each source is capped at 3,000 characters and at most two
chunks per file are included. Provider output citations not present in the source
set are removed.

The response contains `answer`, `citations`, safe `evidence`, `provider`, `model`,
`grounded`, and diagnostics. Supported providers are `openai`, `opencode-go`, and
`deepseek`. Their keys are stored by the Obsidian plugin in `secretStorage` and
injected into the sidecar as `OPENAI_API_KEY`, `OPENCODE_GO_API_KEY`, or
`DEEPSEEK_API_KEY`; keys are never part of plugin data, runtime configuration,
protocol responses, or backend logs. HTTP 429/5xx are retried once after 500 ms;
auth and other 4xx errors are not retried. The provider is never silently switched.

Answer-specific errors are coded as `ANSWER_INVALID_PARAMS`, `GROUNDING_EMPTY`,
`LLM_NOT_CONFIGURED`, `LLM_API_KEY_MISSING`, `LLM_AUTH_FAILED`,
`LLM_RATE_LIMITED`, `LLM_TIMEOUT`, `LLM_PROVIDER_UNAVAILABLE`, `LLM_BAD_RESPONSE`,
and `ANSWER_TOO_LARGE`.

## Stateful agent answer (plan §11)

`answer_start` / `answer_continue` / `answer_cancel` are additive protocol-v1
methods implementing the structured agent run (native tool calling, MCP tools,
skills, project rules). The legacy one-shot `answer` contract above is
unchanged; when both extensions are off, `answer_start` returns the legacy
deep-answer result wrapped as a `complete` union.

### `answer_start`

```json
{
  "query": "...",
  "conversation": [],
  "max_context_chars": 24000,
  "session_allowed_tools": ["mcp__server__tool"],
  "client_conversation_id": "uuid"
}
```

Response union — either:

```json
{ "status": "complete", "run_id": "...", "result": { "answer": "...", "citations": [], "toolActivity": [] } }
```

or:

```json
{
  "status": "approval_required",
  "run_id": "uuid",
  "expires_at": "ISO-8601",
  "calls": [
    {
      "call_id": "provider-call-id",
      "tool_name": "mcp__github__create_issue",
      "server_name": "github",
      "display_name": "create_issue",
      "arguments": {},
      "annotations": {}
    }
  ]
}
```

`arguments` is shown in the UI for approval decisions but never persisted to
history, logs, or responses beyond the approval card itself.

### `answer_continue`

```json
{
  "run_id": "uuid",
  "decisions": [
    { "call_id": "...", "decision": "allow_once" },
    { "call_id": "...", "decision": "allow_session" },
    { "call_id": "...", "decision": "reject" }
  ]
}
```

Decisions must cover exactly the pending calls — unknown, duplicate, or
missing ids reject the whole request (`ANSWER_INVALID_PARAMS`). `reject`
feeds the model a structured `USER_REJECTED_TOOL_CALL` result and the loop
continues. `allow_session` grants the tool alias for the current conversation
only. A continue may return another `approval_required` or a `complete`.
Runs expire after 10 minutes (`RUN_EXPIRED`), at most 4 runs are active
(`TOO_MANY_RUNS`), and every provider call id executes at most once even
across duplicate continues.

### `answer_cancel`

`{ "run_id": "..." }` cancels the run and any in-flight MCP call. Returns
`{ "cancelled": bool }`. Cancelling an unknown/expired run reports
`cancelled: false` without error.

## MCP / skills management methods

- `set_mcp_secrets` — one-shot handoff of per-server env values over the
  authenticated loopback: `{ "servers": { "<server-uuid>": { "NAME": "value" } } }`.
  Bounds: 32 KiB total payload, name ≤128 chars, value ≤8 KiB. Values are
  never echoed back; the response lists received server ids + env names only.
- `mcp_status` — `{ enabled, servers: [{id, name, state, message, command,
  tools, tool_names, env_names, tool_policies}], connected, config_problems }`.
  States: `disabled | awaiting_secret | connecting | connected | error`.
- `mcp_refresh` — reconnect changed servers and re-list their tools.
- `skills_status` / `skills_refresh` — skill registry scan state: roots with
  `{state, skills}` counts, discovered catalog entries, conflicts, problems,
  active count, and estimated catalog size.

New error codes: `MCP_INVALID_SECRETS` (invalid handoff shape),
`RUN_NOT_FOUND`, `RUN_EXPIRED`, `RUN_CANCELLED`, `RUN_NOT_WAITING`,
`DECISION_MISMATCH`, `DUPLICATE_DECISION`, `INVALID_DECISION`, `TOO_MANY_RUNS`,
`ANSWER_CANCELLED`, `LLM_TOOLS_UNSUPPORTED` (the provider rejected native
tool calling with HTTP 400/422), `MCP_RESULT_TYPE_UNSUPPORTED`
(image/audio/resource-only results).
