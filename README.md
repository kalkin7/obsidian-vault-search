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

BRAT installs the plugin files. On first run the
plugin downloads its Python backend (~700 KB) from the matching GitHub release
automatically, and keeps it in sync with the plugin version. Use **설정 → Python
백엔드 → 백엔드 설치/복구** to re-download or recover. First indexing still
needs a vector rebuild and the embedding model snapshot (see below).

AI 답변 provider와 API 키는 **설정 → AI 답변**에서 관리합니다. API 키는 Obsidian
보안 저장소에 저장되며 `data.json`이나 vault 파일에 기록되지 않습니다.

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

## AI Vault Search panel (우측 패널) & 빠른 검색 모달

Open the panel from the left ribbon. It answers questions directly from the
vault using the configured provider (`openai` / `opencode-go` / `deepseek`),
with **agentic (deep) answers**: the model iteratively searches, reads, and
greps the vault — the same strategy coding agents follow via AGENTS.md — then
answers with `[S#]` citations. A per-model **추론** selector sits next to the
model picker in the composer. ★-marked models in the settings list are the
only ones offered in the model picker, and changes apply immediately. API keys
are validated against the real endpoint when saved or tested. Conversations
are autosaved to the vault as notes (default `AI Vault Search/history` —
clock icon in the panel header to browse/load/delete, folder and retention
configurable in settings).

각 답변 블록과 검색 모달에서 Smart Composer 스타일의 **액션 툴바**를 제공합니다:
- **복사** — 클릭 가능한 ① 소스 링크와 `## 근거` 목록이 포함된 노트용 마크다운으로 클립보드에 복사.
- **새 노트** — 질문/답변 기반의 새로운 마크다운 노트를 생성하고 새 탭으로 즉시 열기 (Obsidian의 "새 노트 생성 위치" 기본 폴더 설정 존중, `created` 프론트매터 자동 첨부 및 본문 제목 중복 방지).
- **현재 노트에 삽입** — 현재 활성화되어 있는 마크다운 노트의 커서 위치(선택 영역 보존)에 결과 내용을 직접 삽입.

The command palette offers "AI Vault Search: 목록 렌더링 샘플 미리보기" for checking
list rendering without the model. See
[Settings](docs/settings.md#ai-vault-답변) for the full behavior.

## API 에이전트 확장 (MCP · 스킬 · 프로젝트 규칙)

설정 탭의 **API 에이전트** 탭에서 켤 수 있는 Desktop 전용 확장입니다. 세 기능 모두
기본값은 꺼짐이며, 끄면 기존 답변 동작이 그대로 유지됩니다.

- **프로젝트 규칙** — 최대 32,000자의 규칙을 시스템 지침 구획으로 전송하거나, 볼트
  루트 `AGENTS.md`를 스냅샷으로 가져옵니다(자동 동기화 없음, 해시 표시). 제품 보안
  지침보다 우선하지 않습니다.
- **MCP 서버** — stdio 방식 로컬 서버 및 원격 HTTP(Streamable) 서버를 등록하면 API 모델이 도구를 발견하고,
  기본 정책 `ask`에 따라 실행 전 서버/도구/인자를 보여주며 승인을 요구합니다.
  환경 변수 값과 원격 접속 URL(인증 토큰 포함)은 Obsidian 보안 저장소에만 안전하게 저장되고
  로그·설정·히스토리에 남지 않습니다. 실행 중 호출은 취소할 수 있고, 백엔드 종료 시 자식 프로세스가
  정리됩니다.
- **스킬** — `.claude/skills` 등 프로젝트 루트와 사용자 지정 루트의 `SKILL.md`를
  카탈로그로 제공하고, 모델이 필요한 스킬만 점진적으로 불러옵니다. 참조 파일은
  스킬 폴더 안에서만 읽히며 스크립트는 실행하지 않습니다.

보안 경고: MCP 서버 등록과 스킬 활성화는 명시적인 사용자 행동입니다. 새 외부 도구는
항상 승인 후 실행되며, annotations는 자동 승인 근거로 사용되지 않습니다. 프로젝트
규칙에는 민감한 값을 넣지 마세요(내용은 provider로 전송됩니다). 자세한 내용은
[Settings](docs/settings.md#api-에이전트-mcp--스킬--프로젝트-규칙)와
[Protocol](docs/protocol.md) 문서를 참고하세요.

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
