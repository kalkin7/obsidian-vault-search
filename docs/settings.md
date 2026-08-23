# Settings

Portable settings are stored in plugin `data.json`. The Python executable is machine-local and stored in `%LOCALAPPDATA%/ObsidianVaultSearch/vaults/<vault-id>/machine.json`.

## Runtime selection (P1)

- **Python 실행 파일** defaults to empty = **auto**: the plugin prefers a
  **managed venv runtime** (`machine.json` `runtimes`, CUDA first then CPU —
  the self-contained environment installed by **CUDA 런타임 설치** /
  `setup-backend.ps1`), falling back to the PATH `python` when no managed
  runtime exists yet. Typing an explicit path disables auto mode and pins
  that interpreter as-is.
- The plugin inspects candidate Pythons with the plugin-side backend on
  `PYTHONPATH`. CUDA capability is judged by **onnxruntime providers**
  (`CUDAExecutionProvider` / `TensorrtExecutionProvider`), not torch alone — a
  CUDA torch with a CPU-only onnxruntime is not selected as a GPU runtime.
- The selected executable is **resolved to its real interpreter path
  (`sys.executable`)** and persisted to `machine.json`, so a resolved auto
  choice survives restarts. Clearing the field returns to auto mode, which
  re-resolves against the managed runtimes and ignores a stale machine.json
  `pythonExecutable` drift to an arbitrary system python (a once-chosen
  system interpreter no longer sticks forever).
- Bare command names (e.g. `python`) are still accepted as auto: the wrapper
  resolves them via `Get-Command` and the CLI via `shutil.which`.

## Backend install state

The **Python 백엔드** setting row reports the plugin-side backend folder
install state — `미설치`, `설치됨 (vX.Y.Z, 최신)`, or a version-mismatch
warning — refreshed on plugin load and after **백엔드 설치/복구**, so a
missing or stale backend is visible before the first service start instead of
failing later.

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
  favorite changes persist immediately. The
  fetched model lists are also persisted, so the list and its stars survive
  restarts (refresh with **모델 최신화**).
- **Auto-save settings** — the settings tab has no save button: every change
  is applied automatically ~0.7 s after the last edit (heavy changes such as
  engine/chunking restart or rebuild the service). The 서비스 제어 row keeps
  only 시작/중지.
- **Conversation UI** — the panel keeps a chat history (question bubbles +
  per-answer blocks with markdown, tables, citation pills, and a hover copy
  button) for the session only; the input is cleared when the panel reopens.
- **히스토리 (history)** — each completed answer is autosaved as a note in
  the vault (default `AI Vault Search/history`, configurable). The note body
  is the readable, clickable transcript (`## Q` / `## A` with ① wikilinks and
  a `## 근거` list); YAML frontmatter keeps the raw messages and citations so
  the panel can reload the conversation losslessly (citation pills included)
  and continue it. The clock icon in the panel header opens the history list
  (load / delete / 지금 저장). Retention is configurable (0 = keep all).
  History notes carry a frontmatter schema marker
  (`ai_vault_search_history: 1`); only marked notes are listed/loaded/pruned,
  so notes in the folder without the marker are never touched, and a
  misconfigured folder (root, `..`) falls back to the default. Deletion moves
  notes to the vault trash (recoverable), not a permanent delete. History
  notes are ordinary vault files and are indexed like any other note — to
  keep AI-generated answers out of search evidence, add the history folder to
  the exclude list.
- **Panel rendering & note actions** — markdown headings of any level
  (`#`…`######`) render as h3–h6; numbered lists with nested bullets render
  with continuous numbering (one `<ol>`, 1, 2, 3…), matching the note —
  including when items are separated by blank lines (blank lines never end
  a markdown list). Task-list markers (`- [ ]` / `- [x]`) render as
  read-only checkboxes (checked for `[x]`). **액션 툴바** offers:
  - **복사** — produces note-ready markdown: `[S#]` citations become inline wikilinks labeled
    with circled endnote numbers (`[[file|①]]`) that open the source file
    directly, plus a deduplicated `## 근거` list mapping each number to its file.
  - **새 노트** — creates a new standalone markdown note (inheriting Obsidian's
    "Default location for new notes" folder setting, with frontmatter `created` timestamp,
    intelligent H1 title extraction, and body heading deduplication) and opens it in a new tab immediately.
  - **현재 노트에 삽입** — inserts the note-ready markdown at the cursor location (or after
    the active selection without overwriting existing text, or at document end)
    of the currently active markdown note.
  The search modal provides the same action bar (복사, 새 노트, 현재 노트에 삽입) for vault search results.
- **Diagnostic command** — "AI Vault Search: 목록 렌더링 샘플 미리보기"
  (command palette) renders a fixed sample answer (numbered list with nested
  bullets, a task-list section, and citations) in the panel, so list and
  checkbox rendering can be checked deterministically without the model.
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

## API 에이전트 (MCP · 스킬 · 프로젝트 규칙)

Desktop 전용 확장으로, API provider 모델이 CLI 에이전트처럼 로컬 MCP 도구와 볼트
스킬을 활용할 수 있게 합니다. 설정 탭의 **API 에이전트** 탭에서 관리합니다. 세
기능은 모두 기본적으로 꺼져 있으며, 기존 답변 동작은 바뀌지 않습니다.

### 프로젝트 규칙

- 최대 32,000자의 텍스트를 시스템 지침의 한 구획(`<project_rules>`)으로 전송합니다.
- **AGENTS.md 가져오기**는 볼트 루트의 `AGENTS.md` 내용을 스냅샷으로 복사합니다 —
  이후 파일이 변경되어도 자동 반영되지 않고, 가져온 시각과 SHA-256 앞 12자리가
  표시됩니다. 재가입하면 새 내용으로 갱신됩니다.
- 프로젝트 규칙은 제품 보안 지침(도구 승인, 볼트 경계, 비밀값 보호)보다 우선하지
  못합니다. 규칙에 등록되지 않은 CLI/도구가 언급되어도 실제 도구로 취급되지 않습니다.
- 이 내용은 provider로 전송되므로 민감한 값을 넣지 마세요.

### MCP 서버

- 서버 편집은 전용 입력창(모달)에서 하고, 설정 탭 목록에는 이름·요약·사용
  스위치만 표시됩니다. 최대 20개.
- **전송 방식 2종**을 지원합니다.
  - **로컬 명령(stdio)**: 이 컴퓨터에서 자식 프로세스로 실행. 실행 명령은 셸을
    거치지 않고 직접 실행되며, 작업 폴더는 볼트 루트 / 플러그인 폴더 / 사용자가
    지정한 절대 경로 중 하나입니다.
  - **원격 URL(HTTP)**: 스트리밍 HTTP MCP 서버에 직접 연결. 서비스에서 발급한
    전체 URL(토큰이 쿼리에 포함된 형태 포함)을 그대로 붙여넣습니다. URL은 설정
    파일에만 저장되고 상태 표시·로그에는 origin+경로까지만 노출되며, 원격 서버에는
    어떤 환경 변수도 주입되지 않습니다. OAuth 플로우는 미지원입니다.
- 환경 변수 **값은 Obsidian `secretStorage`에만** 저장됩니다(로컬 stdio 서버).
  plugin data, `service-config.json`, 요청·응답, 로그, 히스토리에는 이름만 남습니다.
  값은 sidecar 연결 후 인증된 loopback 프로토콜(`set_mcp_secrets`)로 한 번
  전달되며, 응답·로그에 절대 기록되지 않습니다. 전체 payload는 32 KiB, 이름 128자,
  값 8 KiB로 제한됩니다. 서버 삭제 시 해당 secret도 함께 삭제됩니다.
- MCP 자식 프로세스에는 SDK 기본 safe environment + 해당 서버 env만 전달됩니다 —
  provider API 키나 다른 서버의 secret, 부모의 전체 환경은 들어가지 않습니다.
  자식의 stderr는 폐기됩니다(서버가 secret을 stderr로 출력해도 기록되지 않음).
- 도구 정책: 새 도구는 항상 **ask**(실행 전 승인). `deny`는 목록에서 숨기고,
  `allow`는 자동 실행입니다. annotations(readOnlyHint 등)로 자동 승인하지 않습니다.
  승인 카드에서 **한 번 허용 / 이 대화에서 허용 / 거부**를 선택하며, "이 대화에서
  허용"은 현재 대화에만 유효하고 재시작·새 대화·히스토리 복원 시 사라집니다.
  항상 허용으로 바꾸려면 설정 화면에서만 가능합니다.
- 타임아웃: 연결/목록 10초, 호출 기본 30최대 120초. 실행 중 호출과 run은 패널에서
  취소할 수 있습니다(provider HTTP 요청 자체는 현재 즉시 중단되지 않을 수 있음).
- 백엔드 종료 시 모든 MCP 자식 프로세스가 정리됩니다.

### 스킬

- `.agents/skills`, `.claude/skills`, `.opencode/skills`(프로젝트 루트)와 사용자가
  추가한 루트(최대 20개)에서 `*/SKILL.md`를 탐색합니다.
- 카탈로그에는 id·이름·설명만 제공되고 본문은 모델이 `skill_load`로 선택할 때만
  로드됩니다(점진적 로딩). 참조 파일은 `skill_read_resource`로 스킬 폴더 안에서만
  읽히며, 파일당 64 KiB, run당 총 256 KiB, `.env`·인증서·키 파일은 거부합니다.
  스크립트는 **읽기만** 하고 실행하지 않습니다.
- SKILL.md 64 KiB, 루트당 200개, 전체 활성 100개, 설명 2,000자로 제한되며,
  잘못된 프론트매터·루트 탈출(junction/symlink)·중복 이름은 개별 경고로 격리됩니다.
- 하나의 malformed 스킬 때문에 검색 서비스 전체가 망가지지 않습니다.

### 데이터 경계 (공통)

- 검색 결과, read 결과, MCP 결과, 스킬 본문은 항상 **데이터**로 전달되며 시스템
  지침으로 승격되지 않습니다("ignore previous instructions" 무효).
- 히스토리에는 도구 **활동 메타데이터**(도구명/상태/시간)만 저장되고, 인자 원문과
  결과 원문은 저장되지 않습니다. `groundingKind`(vault/tool/mixed/none)로 답변의
  근거 출처를 구분할 수 있습니다.
- 모바일에서는 MCP subprocess 실행이 불가합니다(Desktop 전용).
