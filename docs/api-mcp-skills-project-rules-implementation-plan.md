# API 모델용 MCP·Skills·프로젝트 규칙 구현 계획

작성일: 2026-08-22  
대상 저장소: `obsidian-vault-search` v0.1.56  
문서 성격: 다른 구현 모델이 그대로 작업 계약으로 사용할 수 있는 상세 설계·검증 계획

## 1. 목표

Obsidian 안의 **AI Vault Search**가 CLI 에이전트와 비슷한 확장성을 갖도록 다음 세 기능을 추가한다.

1. API provider로 연결한 모델이 사용자가 등록한 로컬 MCP 서버의 도구를 발견하고 호출할 수 있게 한다.
2. API 모델이 프로젝트 또는 사용자가 지정한 경로의 `SKILL.md`를 발견하고, 필요한 스킬만 점진적으로 불러와 따를 수 있게 한다.
3. 설정에서 프로젝트 규칙 프롬프트를 직접 입력하거나 볼트 루트의 `AGENTS.md`를 가져와 API 모델의 시스템 지침에 포함할 수 있게 한다.

완성된 기능은 기존 `search` / `read` / `grep` 기반 deep answer, 볼트 범위 제한, 인용, provider 선택, 히스토리와 공존해야 한다. API 키와 MCP 비밀값은 볼트, plugin `data.json`, `service-config.json`, 요청·응답, 로그에 평문으로 남지 않아야 한다.

## 2. 범위와 비범위

### 2.1 첫 릴리스에 반드시 포함할 범위

- Desktop Obsidian에서 로컬 **stdio MCP 서버** 등록·연결·도구 조회·도구 호출
- MCP 서버 및 도구별 활성화 상태와 실행 정책: `deny`, `ask`, `allow`
- `ask` 도구의 실행 전 인자 표시, 한 번 허용, 현재 대화에서 허용, 거부
- 실행 중인 MCP 호출 취소와 backend 종료 시 자식 프로세스 정리
- `.agents/skills`, `.claude/skills`, `.opencode/skills` 및 사용자가 명시적으로 추가한 스킬 루트 탐색
- 스킬 메타데이터 카탈로그와 `load_skill`, `read_skill_resource` 점진적 로딩
- 설정의 프로젝트 규칙 textarea, `AGENTS.md` 가져오기, 초기화, 길이·출처 표시
- OpenAI Responses API와 OpenAI-compatible Chat Completions의 네이티브 function/tool calling
- 새 승인 상태를 표시·재개·취소하는 AI Vault Search UI
- 기존 vault citation과 외부 도구 사용 내역을 구분하는 결과·진단 데이터
- 설정 migration, 자동 테스트, 실제 로컬 MCP smoke test, 문서와 릴리스 패키징 갱신

### 2.2 첫 릴리스의 명시적 비범위

- Streamable HTTP/SSE MCP, OAuth, 원격 MCP 인증
- MCP `resources`, `prompts`, `sampling`, `elicitation`, server-to-client roots 제공
- 스킬에 포함된 shell/Python/PowerShell 스크립트의 임의 실행
- CLI별 전용 훅이나 서브에이전트 기능의 완전 복제
- 모바일 Obsidian에서 MCP subprocess 실행
- MCP 결과를 웹 출처 수준의 자동 인용으로 변환하는 기능
- 사용자가 고르지 않은 전역 홈 디렉터리 전체의 자동 스캔

스크립트 실행은 스킬의 지침·참조 파일 로딩과 별개의 권한 모델이 필요하다. 첫 버전에 섞지 않는다. 스킬이 요구하는 실제 동작은 허용된 MCP 도구로 수행하게 한다.

## 3. 확인된 현재 구조

### 3.1 기존 실행 경로

```text
SearchItemView
  -> BackendManager.call("answer", { deep: true, ... })
  -> loopback JSONL protocol
  -> SearchService._deep_answer()
  -> DeepAnswerEngine
  -> LLM provider HTTP API
```

- 모델 호출과 에이전트 루프는 TypeScript 플러그인이 아니라 Python sidecar에 있다.
- `backend/vault_search/deep_answer.py`는 모델 텍스트에서 `TOOL: search(...)` 형식을 정규식으로 파싱한다.
- 도구는 `search`, `read`, `grep` 세 개로 하드코딩되어 있다.
- `backend/vault_search/llm.py`의 provider 계약은 텍스트 응답만 반환하며 구조화된 tool call을 표현하지 못한다.
- backend server는 작업 큐를 통해 `answer` 등 무거운 작업을 한 스레드에서 직렬 실행한다.
- API 키는 Obsidian `secretStorage`에서 읽어 sidecar 환경변수로만 주입된다.
- `service-config.json`은 sidecar가 필요한 일반 설정을 평문 JSON으로 저장한다.
- CLI 에이전트 통합은 이미 `src/agent-integration.ts`에서 `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `search.ps1`을 설치한다. 이번 기능은 이 설치물을 대체하지 않고 API 모델 경로를 보완한다.

### 3.2 기존 보안·호환성 불변조건

- 볼트 파일 읽기는 include/exclude glob, traversal, out-of-vault symlink 검사를 계속 통과해야 한다.
- 검색 결과와 파일 내용은 신뢰할 수 없는 데이터이며 시스템 지침으로 취급하면 안 된다.
- provider는 사용자가 선택한 provider를 그대로 사용하며 자동 fallback하지 않는다.
- 기존 `answer` 응답의 `answer`, `citations`, `evidence`, `provider`, `model`, `grounded`, `diagnostics` 필드는 제거하지 않는다.
- sidecar token과 provider/MCP secret은 stdout, stderr, backend log, history에 노출하지 않는다.
- 기존 deep answer를 확장 기능 없이 사용하는 경로는 회귀시키지 않는다.

## 4. Smart Composer 참고 결과와 적용 원칙

Smart Composer의 원본 구현에서 참고할 구조는 다음과 같다.

- MCP manager가 서버 연결 상태, tool list cache, active call의 `AbortController`, 대화별 허용 도구를 분리해 관리한다.
- 도구 이름을 `server__tool` 형태로 namespace하고, 설정 변경 시 해당 서버만 재연결하며 tool cache를 무효화한다.
- 도구별 `disabled`와 `allowAutoExecution`을 두고, 기본적으로 승인이 끝난 호출만 실행한다.
- 모델에게 MCP `inputSchema`를 function tool schema로 전달하고, tool 결과를 다음 모델 요청에 포함한다.
- custom prompt를 별도 메시지로 조립한다.

그대로 복사하지 않고 다음을 개선해 적용한다.

- 이 저장소에서는 모델 루프가 Python에 있으므로 MCP host도 Python sidecar에 둔다.
- custom/project rules는 일반 user message가 아니라 **고정 보안 지침보다 낮은 우선순위의 system instructions 구획**으로 넣는다.
- Smart Composer가 첫 번째 text content만 지원하는 방식은 따르지 않는다. text 여러 개와 structured content를 안전하게 직렬화하고, image/audio/resource 결과는 명시적 미지원 오류로 처리한다.
- MCP 서버가 제공한 `readOnlyHint` 등 annotations는 UI 힌트로만 사용한다. 자동 승인 근거로 신뢰하지 않는다.

참고 원본:

- Smart Composer 저장소: <https://github.com/glowingjade/obsidian-smart-composer>
- MCP manager: `src/core/mcp/mcpManager.ts`
- tool loop: `src/utils/chat/responseGenerator.ts`
- prompt 조립: `src/utils/chat/promptGenerator.ts`
- MCP Python SDK: <https://github.com/modelcontextprotocol/python-sdk>

구현 시 MCP SDK는 현재 안정 버전인 `mcp==2.0.0`을 정확히 pin한다. major 범위를 열어 두지 말고, API 사용법은 v2 문서와 고정 버전에서 검증한다.

## 5. 핵심 아키텍처 결정

### 5.1 MCP host의 위치

MCP client/host는 `Python sidecar` 안에 둔다.

이유:

- provider 호출, tool loop, source budget이 이미 Python에 있어 tool call 왕복이 한 프로세스 안에서 끝난다.
- TypeScript에 MCP를 두면 backend가 플러그인으로 역호출하는 새 duplex protocol이나 모델 루프 전체 이전이 필요하다.
- sidecar의 단일 작업 큐와 MCP call 상태를 같은 run state에서 관리하기 쉽다.

### 5.2 async MCP와 현재 sync 서비스 연결

`McpHost`는 전용 background thread와 하나의 `asyncio` event loop를 소유한다.

```text
SearchService main task thread
  -> McpHost.list_tools()/call_tool()  [sync facade]
  -> asyncio.run_coroutine_threadsafe(...)
  -> MCP event-loop thread
  -> persistent MCP Client sessions / stdio child processes
```

- 매 tool call마다 `asyncio.run()`으로 연결을 새로 만들지 않는다.
- 서버별 session과 subprocess는 연결 후 재사용한다.
- `SearchService.close()`에서 host 종료를 요청하고, 모든 session context를 빠져나온 뒤 event-loop thread를 join한다.
- backend의 모든 종료 경로(정상 shutdown, parent disconnect, heartbeat timeout, 예외)에 `service.close()`를 `finally`에서 호출한다.
- 종료 시간은 서버별 2초, 전체 5초로 제한하고 이후 SDK의 강제 종료 경로를 사용한다.

### 5.3 에이전트 루프

새 `StructuredAgentRun` 상태 머신을 추가한다.

```text
start
  -> initial vault search
  -> provider turn(tools 포함)
  -> final text -----------------------------> complete
  -> tool_calls
       -> 모두 allow                         -> execute -> provider turn
       -> 하나라도 ask                       -> approval_required
       -> continue(decisions)
            -> execute/reject results         -> provider turn
       -> budget/timeout/cancel               -> coded failure or finalization
```

현재 정규식 기반 `DeepAnswerEngine`은 즉시 삭제하지 않는다.

- MCP와 skills가 모두 꺼진 경우에는 한 릴리스 동안 legacy text-tool loop를 fallback으로 유지한다.
- 확장 기능이 켜졌는데 모델/provider가 native tools를 거부하면 text 형태로 MCP를 흉내 내지 말고 `LLM_TOOLS_UNSUPPORTED`를 반환한다.
- provider adapter와 structured loop 계약 테스트가 모두 통과한 뒤 후속 릴리스에서 legacy parser 제거를 검토한다.

### 5.4 승인 때문에 필요한 상태형 protocol

현재 `answer` 한 번으로 최종 문자열까지 기다리는 계약은 중간 승인을 표현할 수 없다. 다음 additive methods를 추가한다.

- `answer_start`
- `answer_continue`
- `answer_cancel`
- `mcp_status`
- `mcp_refresh`
- `set_mcp_secrets`
- `skills_status`
- `skills_refresh`

기존 `answer`는 호환성을 위해 유지한다. 새 UI는 `answer_start`를 사용한다.

## 6. 설정과 데이터 모델

### 6.1 TypeScript 설정 타입

`src/types.ts`에 아래 개념을 추가한다. 이름은 구현 중 동일 의미를 유지하는 선에서 조정할 수 있으나 필드 의미를 바꾸지 않는다.

```ts
export type McpToolPolicy = "deny" | "ask" | "allow";

export interface McpServerSettings {
  id: string;                 // 생성 후 불변 UUID
  name: string;               // 사용자 표시명, 중복 금지
  enabled: boolean;
  transport: "stdio";
  command: string;
  args: string[];
  cwd: "vault" | "plugin" | string;
  envNames: string[];         // 값은 SecretStorage에 별도 저장
  toolPolicies: Record<string, McpToolPolicy>;
}

export interface SkillRootSettings {
  id: string;
  path: string;               // vault-relative 우선, 명시적 absolute 허용
  enabled: boolean;
}

export interface VaultSearchSettings {
  // 기존 필드 유지
  answerProjectRules: string;
  answerProjectRulesSource: "custom" | "agents-md";
  mcpEnabled: boolean;
  mcpServers: McpServerSettings[];
  skillsEnabled: boolean;
  skillRoots: SkillRootSettings[];
  enabledSkills: string[];    // canonical skill id
}
```

기본값:

- `answerProjectRules = ""`
- `answerProjectRulesSource = "custom"`
- `mcpEnabled = false`
- `mcpServers = []`
- `skillsEnabled = false`
- project-local skill root 후보는 UI에서 발견 상태만 보여 주고 자동 활성화하지 않는다. 사용자가 **프로젝트 스킬 사용**을 켜면 존재하는 `.agents/skills`, `.claude/skills`, `.opencode/skills`를 제안한다.

`SETTINGS_VERSION`을 올리고 migration은 없는 배열·문자열만 기본값으로 채운다. 기존 사용자 설정을 덮어쓰지 않는다. `cloneSettings`는 새 중첩 배열과 `toolPolicies` 객체를 deep-copy해야 한다.

### 6.2 MCP 비밀값 저장

MCP env 값은 전부 비밀값으로 취급한다.

- plugin data에는 env 이름만 저장한다.
- SecretStorage key는 `vault-search-mcp-env-<server UUID>-<env-name hash>`처럼 안정적으로 생성한다.
- 서버 삭제 시 관련 secret도 삭제하되, 삭제 전 정확한 server UUID와 env name 목록을 확인한다.
- env name 변경은 새 secret 저장 성공 후 이전 secret을 삭제한다.
- UI는 저장된 값의 존재 여부만 표시하고 실제 값을 다시 채우지 않는다.
- `service-config.json`에는 env 값이나 secret ID를 넣지 않고 env 이름만 넣는다.

sidecar로 비밀값을 넘길 때 provider 키와 달리 공용 process env에 모든 MCP env를 섞지 않는다. plugin이 sidecar에 연결한 뒤 인증된 loopback protocol의 `set_mcp_secrets`로 다음 형태를 한 번 전달한다.

```json
{
  "servers": {
    "<server-uuid>": {
      "GITHUB_TOKEN": "..."
    }
  }
}
```

제약:

- 전체 secret payload 최대 32 KiB, 이름 최대 128자, 값 최대 8 KiB
- method 처리 코드와 backend log에 params를 출력하지 않음
- response에는 받은 server UUID와 env 이름만 반환하고 값은 반환하지 않음
- sidecar 메모리에서만 보관하고 종료 시 참조를 비움
- stdio child에는 SDK 기본 safe environment와 해당 서버용 env만 전달함
- provider API key, 다른 MCP 서버 secret, 전체 parent `os.environ`을 child에 넘기지 않음

### 6.3 Python 설정 타입

`SearchConfig`에는 비밀값 없는 설정만 추가한다.

- `project_rules: str`
- `mcp_enabled: bool`
- `mcp_servers: list[McpServerConfig]`
- `skills_enabled: bool`
- `skill_roots: list[Path]`
- `enabled_skills: set[str]`

파서 제한:

- project rules 최대 32,000자
- MCP 서버 최대 20개, args 최대 64개, 각 arg 최대 2,048자
- tool policy 항목 서버당 최대 500개
- skill root 최대 20개
- NUL, 제어 문자, 빈 command, 중복 server ID/name 거부
- custom `cwd`는 존재하는 디렉터리여야 하며 사용자가 명시한 값만 허용

잘못된 항목 하나 때문에 검색 backend 전체가 시작 불가가 되지 않게 한다. 해당 MCP/skill 항목을 `error` 상태로 격리하고 일반 검색은 계속 동작하게 한다. 단, config JSON 자체가 손상된 경우의 기존 실패 정책은 유지한다.

## 7. 프로젝트 규칙 프롬프트

### 7.1 UI 동작

설정의 `AI Vault 답변` 아래에 **API 에이전트 규칙** 구역을 추가한다.

- 여러 줄 textarea
- 현재 글자 수 / 최대 32,000자
- `볼트 루트 AGENTS.md 가져오기` 버튼
- `비우기` 버튼
- 마지막 가져오기 시각과 SHA-256 앞 12자리 표시
- 도움말: 이 내용은 API provider에 전송되며, 민감한 값은 넣지 말 것

가져오기는 snapshot 방식이다.

1. vault root의 정확한 `AGENTS.md`만 읽는다.
2. 읽기 성공 후 textarea에 복사한다.
3. 사용자가 설정 적용을 해야 저장된다.
4. 이후 파일 변경을 자동 반영하지 않는다.

자동 반영하지 않는 이유는 동기화나 외부 편집으로 시스템 지침이 조용히 바뀌는 것을 막고, 실제 API로 보내는 내용을 설정 화면에서 항상 확인 가능하게 하기 위함이다.

### 7.2 프롬프트 우선순위

새 `backend/vault_search/agent_prompt.py`에서 순수 함수로 조립한다.

1. 제품 고정 보안·도구 승인·데이터 취급 지침
2. 프로젝트 규칙 (`<project_rules>...</project_rules>`)
3. 사용 가능한 스킬 카탈로그와 스킬 사용법
4. 사용 가능한 built-in/MCP tool 사용법
5. 답변 언어·citation 형식 지침

프로젝트 규칙 앞에는 다음 의미를 명시한다.

- 사용자가 명시적으로 제공한 프로젝트 지침이다.
- 제품 보안 지침, 도구 승인, 볼트 경계, 비밀값 보호를 재정의할 수 없다.
- 현재 등록되지 않은 CLI나 도구를 언급하더라도 존재한다고 가정하지 않는다.

검색 결과, read 결과, MCP 결과는 별도 `<untrusted_content>` 또는 tool-result message로 전달한다. 절대로 project rules 구획과 문자열 결합하지 않는다.

## 8. Skills 설계

### 8.1 탐색과 식별

새 `backend/vault_search/skills.py`에 `SkillRegistry`를 만든다.

기본 후보:

- `<vault>/.agents/skills/*/SKILL.md`
- `<vault>/.claude/skills/*/SKILL.md`
- `<vault>/.opencode/skills/*/SKILL.md`
- 사용자가 설정에서 추가하고 활성화한 root의 `*/SKILL.md`

각 스킬은 YAML frontmatter의 `name`, `description`을 읽는다. canonical ID는 `<root-id>:<normalized-name>`으로 만든다. 이름 충돌은 숨기지 말고 UI에 conflict로 표시하며, 사용자가 어느 경로를 쓸지 선택하게 한다.

경계:

- `SKILL.md` 최대 64 KiB
- root당 최대 200개, 전체 활성 스킬 최대 100개
- frontmatter description 최대 2,000자
- canonical path가 root 밖으로 나가는 junction/symlink는 제외
- unreadable, malformed YAML, name 누락은 개별 error로 기록
- 탐색 중 파일 본문 전체를 시스템 프롬프트에 넣지 않음

### 8.2 점진적 로딩

모델에게는 활성 스킬의 `id`, `name`, `description`만 카탈로그로 제공한다. 다음 built-in 도구를 native function tool로 제공한다.

```text
load_skill(skill_id)
read_skill_resource(skill_id, relative_path)
```

`load_skill`:

- 선택한 `SKILL.md` 전체를 읽는다.
- 이미 로드한 스킬은 같은 run에서 cache한다.
- 결과를 `<skill_instructions id="...">`로 감싸 반환한다.
- 모델에게 고정 보안 지침보다 낮고 일반 vault/MCP 데이터보다 높은 지침으로 따르라고 알려 준다.

`read_skill_resource`:

- 해당 skill directory 내부 파일만 읽는다.
- absolute path, `..`, junction/symlink escape를 거부한다.
- text 파일만 지원하며 한 파일 최대 64 KiB, run 전체 skill resource 최대 256 KiB로 제한한다.
- `.env`, credential, key/certificate 확장자, hidden secret 후보는 기본 거부한다.
- 실행 비트나 확장자와 무관하게 파일을 **읽기만** 하며 실행하지 않는다.

스킬 본문이 다른 스킬을 참조해도 자동으로 연쇄 로드하지 않는다. 모델이 catalog에 있는 다른 스킬을 명시적으로 `load_skill` 해야 한다.

### 8.3 스킬 상태 UI

- root별 경로·활성화·스캔 상태·오류
- 발견한 skill name/description/path
- skill별 활성화 toggle
- `다시 검색` 버튼
- 중복 이름, root escape, malformed frontmatter 경고
- 활성 스킬 수와 catalog 예상 문자 수

## 9. MCP 설계

### 9.1 새 backend 모듈

`backend/vault_search/mcp_host.py`에 다음 책임을 둔다.

- event-loop thread 시작·종료
- 서버 설정 validation
- stdio transport 연결과 initialize handshake
- 서버별 상태: `disabled`, `awaiting_secret`, `connecting`, `connected`, `error`
- `list_tools` cache와 변경 시 무효화
- tool alias ↔ `(server_id, original_tool_name)` mapping
- call timeout, cancellation, result 정규화
- 설정 변경 시 변경된 서버만 disconnect/reconnect
- backend 종료 시 모든 session/subprocess 정리

SDK는 `mcp==2.0.0`의 unified `Client`/stdio transport API를 사용한다. 구현 전에 설치된 고정 버전의 실제 signature로 최소 spike를 만들고, 문서와 다르면 고정 버전 코드를 기준으로 테스트를 먼저 확정한다.

### 9.2 도구 이름과 schema

provider에 노출할 이름은 다음 규칙을 사용한다.

```text
mcp__<safe-server-name>__<safe-tool-name>
```

- 영문자·숫자·underscore만 허용
- provider 제한을 고려해 최대 64자
- 잘림 또는 정규화 충돌 시 원본 `(server UUID, tool name)`의 SHA-256 앞 8자를 suffix로 붙임
- mapping은 run 동안 불변
- built-in은 `vault_search`, `vault_read`, `vault_grep`, `skill_load`, `skill_read_resource`처럼 별도 namespace 사용

MCP `inputSchema`는 provider tool schema로 전달하기 전에 다음을 검증한다.

- JSON object schema인지 확인
- 전체 직렬화 크기 최대 64 KiB, nesting depth 최대 20
- `properties`가 없으면 빈 object로 보정
- 모델이 반환한 arguments는 JSON object, 최대 64 KiB
- schema validation 실패 시 서버를 호출하지 않고 tool error 결과를 모델에 돌려줌

`jsonschema`를 직접 사용한다면 requirements에 정확한 버전을 pin한다. transitive dependency에 우연히 기대지 않는다.

### 9.3 결과 정규화

MCP result는 다음 내부 형식으로 변환한다.

```py
NormalizedToolResult(
    ok: bool,
    text: str,
    structured: dict | list | None,
    truncated: bool,
    error_code: str | None,
)
```

- 모든 text content를 순서대로 결합한다.
- structured content는 bounded JSON으로 추가한다.
- 합계 최대 32,000자, 초과 시 명시적 truncation marker를 붙인다.
- `isError`는 정상 응답처럼 삼키지 않고 `ok=false` tool result로 전달한다.
- image/audio/embedded resource만 있는 결과는 `MCP_RESULT_TYPE_UNSUPPORTED`를 반환한다.
- tool arguments, raw result, stack trace를 backend log에 기록하지 않는다.

### 9.4 실행 정책

- built-in vault search/read/grep과 skill read 도구는 기존 범위 제한 안에서 자동 실행 가능
- 외부 MCP tool은 새로 발견되면 무조건 `ask`
- annotations의 `readOnlyHint=true`도 자동으로 `allow`로 바꾸지 않음
- `deny`: 모델에게 tool schema 자체를 노출하지 않음
- `ask`: schema는 노출하지만 호출 시 `approval_required`
- `allow`: 사용자 설정에서 명시적으로 지정한 경우 자동 실행
- 승인 카드의 `현재 대화에서 허용`은 plugin session 메모리에만 남고 재시작·새 대화·히스토리 복원 시 유지하지 않음
- `항상 허용` 변경은 설정 화면에서만 수행하고 호출 카드에서는 제공하지 않음

### 9.5 timeout과 취소

- MCP connect 10초, list tools 10초, call 기본 30초
- 서버별 call timeout은 후속 설정으로 늘릴 수 있으나 첫 버전 최대 120초
- AI answer 전체 turn 최대 10, tool call 전체 최대 30, turn당 최대 6
- 동시에 실행해도 안전하다고 확정할 정보가 없으므로 한 turn의 외부 MCP 호출은 기본 직렬 실행
- 사용자 취소 시 현재 provider HTTP 요청과 active MCP call을 취소하고 run state를 제거
- provider의 동기 `urllib` 호출 취소는 즉시 중단할 수 없으므로, 첫 구현에서 request timeout을 기다려야 하는 한계를 UI에 표시한다. 후속으로 cancel 가능한 HTTP client 이전을 검토한다.

## 10. Provider native tool calling 계약

### 10.1 내부 타입

`backend/vault_search/llm.py`의 텍스트 전용 계약을 다음 개념으로 확장한다.

```py
@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]

@dataclass(frozen=True)
class ProviderToolCall:
    id: str
    name: str
    arguments: dict[str, Any]

@dataclass(frozen=True)
class ProviderTurn:
    text: str
    tool_calls: list[ProviderToolCall]
    provider: str
    model: str
```

메시지는 최소한 `system`, `user`, `assistant`, `tool`과 tool call ID를 손실 없이 표현하는 내부 tagged union으로 만든다. provider-specific raw JSON을 service/agent engine에 새지 않게 한다.

### 10.2 OpenAI Responses adapter

- `tools`에 function definition을 전달한다.
- 응답 `output`의 `function_call` 항목에서 `call_id`, `name`, `arguments`를 파싱한다.
- 다음 turn에서 원래 function call item과 `function_call_output`을 올바른 순서로 전달한다.
- `output_text`와 tool calls가 동시에 있는 경우 둘 다 보존한다.
- malformed arguments, duplicate call ID, unknown tool을 coded tool error로 처리한다.

### 10.3 OpenAI-compatible adapter

- `tools: [{type: "function", function: ...}]`를 전달한다.
- assistant `message.tool_calls`를 파싱한다.
- assistant tool-call message 다음에 call ID별 `role: "tool"` message를 전달한다.
- DeepSeek와 OpenCode Go 각각의 fixture를 둔다. 두 endpoint가 동일하다고 가정만 하지 않는다.

### 10.4 기능 감지와 실패

- 모델 catalog만 보고 tool support를 추측하지 않는다.
- 실제 provider가 tools 요청을 400/422로 거부하면 `LLM_TOOLS_UNSUPPORTED`로 정규화한다.
- MCP/skills가 켜진 상태에서 text `TOOL:` fallback으로 외부 도구를 실행하지 않는다.
- extensions가 모두 꺼져 있으면 기존 legacy deep loop로 fallback 가능하다.
- reasoning trace나 provider 내부 chain-of-thought는 저장·표시하지 않는다.

## 11. 상태형 answer protocol 계약

### 11.1 `answer_start`

요청:

```json
{
  "query": "...",
  "conversation": [],
  "max_context_chars": 24000,
  "client_conversation_id": "uuid",
  "session_allowed_tools": ["mcp__server__tool"]
}
```

응답 union:

```json
{
  "status": "complete",
  "result": { "answer": "...", "citations": [], "tool_activity": [] }
}
```

또는:

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
      "description": "...",
      "arguments": {},
      "annotations": {}
    }
  ]
}
```

`arguments`는 승인에 필요한 정보이므로 UI에 보여 주지만 로그와 history에는 남기지 않는다.

### 11.2 `answer_continue`

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

- pending call마다 정확히 하나의 decision 필요
- 다른 run의 call ID, 중복 ID, 빠진 ID는 전체 요청 거부
- `reject`는 모델에게 구조화된 `USER_REJECTED_TOOL_CALL` 결과를 제공하고 loop를 계속함
- `allow_session`은 응답에도 tool name을 반환해 plugin의 현재 AnswerSession set에 추가함
- continue도 다시 `approval_required` 또는 `complete`를 반환할 수 있음

### 11.3 run registry

- `run_id`는 예측 불가능한 UUID
- 최대 active run 4개
- approval 대기 TTL 10분
- 같은 run의 continue는 lock으로 직렬화
- 완료·취소·만료 즉시 registry에서 제거
- backend 종료 시 모두 취소
- run state에는 messages, sources, loaded skills, tool counts, session approvals만 보관
- API/MCP secret과 raw provider response는 보관하지 않음

### 11.4 결과 확장

기존 필드는 유지하고 다음을 additive로 추가한다.

```ts
toolActivity?: Array<{
  toolName: string;
  serverName?: string;
  status: "success" | "error" | "rejected" | "cancelled";
  durationMs?: number;
  truncated?: boolean;
}>;
groundingKind?: "vault" | "tool" | "mixed" | "none";
```

- `citations`/`evidence`는 계속 vault sources만 의미한다.
- `grounded`는 하위 호환을 위해 유지한다. 새 코드의 정확한 의미 판단에는 `groundingKind`를 사용한다.
- 성공한 MCP 결과만 있고 vault source가 없어도 강제로 “볼트에서 근거 없음”으로 덮어쓰지 않는다.
- tool output 원문과 arguments는 history에 저장하지 않는다. activity metadata만 저장한다.

## 12. TypeScript UI와 session 변경

### 12.1 `AnswerSession`

현재 `Promise<AnswerResult>` 콜백을 step 기반 콜백으로 바꾼다.

추가 상태:

```ts
{ kind: "tool-approval"; runId: string; calls: PendingToolCall[] }
{ kind: "tool-running"; runId: string; calls: PendingToolCall[] }
```

동작:

- 새 질문 제출 시 이전 run이 있으면 `answer_cancel`
- 승인 응답 중 새 질문·clear·dispose가 발생하면 cancel
- pending approval 동안 입력창 중복 submit 방지
- `allow_session` tool name set은 현재 대화에만 유지
- restore된 history는 승인 set을 복원하지 않음
- stale generation의 continue 결과가 UI/history에 들어가지 않음

### 12.2 승인 카드

`src/search-item-view.ts` 또는 별도 `src/tool-approval-renderer.ts`로 분리한다.

- server/tool 이름
- 설명
- JSON arguments 접기/펼치기
- 한 번 허용
- 이 대화에서 허용
- 거부
- 실행 중 spinner와 취소
- 실패·timeout·거부 결과

모든 버튼은 키보드 접근, `aria-label`, disabled 중복 클릭 방지를 지원한다. 긴 arguments는 화면에서 접지만 실제 승인 대상 값은 바꾸지 않는다.

### 12.3 설정 UI

`src/settings-tab.ts`가 더 비대해지지 않도록 다음 renderer를 새 파일로 분리한다.

- `src/api-agent-settings.ts`
- `src/mcp-settings.ts`
- `src/skill-settings.ts`

MCP 서버 form:

- 표시명, command, args 한 줄당 하나, cwd, enabled
- env 이름과 password 입력 행 추가/삭제
- 저장 전 command/args/env name client validation
- 연결 테스트 버튼
- 상태와 발견 tool 수
- tool별 description, annotations, `deny/ask/allow` dropdown
- 서버 삭제는 확인 modal 후 secret 정리와 child disconnect

JSON 전체를 직접 편집하는 textarea를 주 UI로 사용하지 않는다. command/args quoting 오류와 secret 평문 저장을 유발하기 쉽다.

## 13. 파일별 구현 계약

### 13.1 기존 TypeScript 파일

| 파일 | 변경 책임 |
| --- | --- |
| `src/types.ts` | 설정, answer step, pending tool call, tool activity 타입 추가 |
| `src/constants.ts` | 기본값, 새 error/status label, 설정 version 관련 상수 |
| `src/settings.ts` | deep clone, impact 분류, hot config, migration |
| `src/main.ts` | 설정 normalize, AGENTS import, MCP secret CRUD, status refresh, save/apply orchestration |
| `src/backend-manager.ts` | secret bootstrap, 새 protocol methods, MCP config 변경 시 refresh/restart, config secret 제외 |
| `src/answer-session.ts` | start/continue/cancel 상태 머신과 session approval |
| `src/search-item-view.ts` | 승인 상태 연결, tool activity 렌더링, cancel 연동 |
| `src/settings-tab.ts` | 새 하위 renderer 호출만 유지 |
| `src/history.ts` | additive `groundingKind`/safe tool activity 저장·복원, raw args/result 제외 |
| `src/llm-secrets.ts` | provider secret 책임 유지; MCP secret은 별도 모듈로 분리 |

### 13.2 새 TypeScript 파일

| 파일 | 책임 |
| --- | --- |
| `src/mcp-secrets.ts` | stable secret ID, get/set/delete, payload 구성, 값 없는 상태 표시 |
| `src/mcp-settings.ts` | MCP 서버·도구 UI와 validation |
| `src/skill-settings.ts` | skill roots/registry 상태 UI |
| `src/api-agent-settings.ts` | project rules와 API agent 상위 설정 UI |
| `src/tool-approval-renderer.ts` | 승인 카드와 접근성 동작 |

### 13.3 기존 Python 파일

| 파일 | 변경 책임 |
| --- | --- |
| `backend/vault_search/config.py` | 일반 agent/MCP/skill 설정 parse와 bound |
| `backend/vault_search/llm.py` | native tool definition/message/turn adapter |
| `backend/vault_search/deep_answer.py` | legacy loop 보존, 공통 built-in tool을 registry로 추출 |
| `backend/vault_search/service.py` | host/skill/run registry 소유, start/continue/cancel/status routing |
| `backend/vault_search/server.py` | 새 method validation, shutdown에서 `service.close()` 보장 |
| `backend/vault_search/protocol.py` | 새 요청·응답 validation과 coded errors |
| `backend/requirements.txt` | `mcp==2.0.0` 및 직접 사용하는 validation dependency pin |
| `backend/requirements-runtime.txt` | CPU와 동일한 agent runtime dependency 반영 |
| `backend/pyproject.toml` | 의존성 source of truth 동기화 |

### 13.4 새 Python 파일

| 파일 | 책임 |
| --- | --- |
| `backend/vault_search/agent_prompt.py` | prompt precedence와 bounded composition |
| `backend/vault_search/agent_tools.py` | built-in/native tool registry, alias, schema, 결과 타입 |
| `backend/vault_search/agent_run.py` | structured run state machine과 approval boundary |
| `backend/vault_search/mcp_host.py` | MCP SDK lifecycle, sessions, list/call/cancel/reconnect |
| `backend/vault_search/skills.py` | discovery, frontmatter, enablement, safe resource reads |

### 13.5 테스트·문서

| 파일 | 변경 또는 추가 |
| --- | --- |
| `backend/tests/test_agent_prompt.py` | prompt 우선순위·경계·길이 |
| `backend/tests/test_agent_run.py` | native loop, approval, reject, budget, cancel |
| `backend/tests/test_mcp_host.py` | mock stdio server E2E와 cleanup |
| `backend/tests/test_skills.py` | discovery·dedupe·traversal·junction·size |
| `backend/tests/fixtures/mcp_test_server.py` | deterministic stdio MCP fixture |
| `backend/tests/test_llm.py` | provider native tool request/response fixtures |
| `backend/tests/test_protocol.py` | start/continue/cancel 실행 가능한 계약 테스트 |
| `tests/plugin/settings.test.ts` | 새 설정 clone/migration/impact |
| `tests/plugin/mcp-secrets.test.ts` | secret 비영속·삭제·payload bounds |
| `tests/plugin/answer-session.test.ts` | pending/continue/cancel/stale result |
| `tests/plugin/search-item-view.test.ts` | approval UI 상태와 접근성 |
| `tests/plugin/history.test.ts` | safe activity만 저장, raw args/result 미저장 |
| `docs/settings.md` | 사용자 설정·위험·모바일 제한 |
| `docs/protocol.md` | 새 method와 union contract |
| `docs/architecture.md` | MCP host/thread/run registry/prompt precedence |
| `README.md` | 기능, 보안 경고, 빠른 설정 |

릴리스 스크립트가 세 dependency manifest와 backend 파일 전체를 실제 zip에 포함하는지도 검증한다.

## 14. 구현 순서와 단계별 완료 조건

### 단계 0 — 계약 fixture와 baseline 고정

1. 기존 `answer` 요청/응답 fixture를 저장한다.
2. OpenAI Responses function call/return fixture를 추가한다.
3. OpenAI-compatible tool_calls/tool-result fixture를 추가한다.
4. 최소 stdio MCP test server를 만든다.
5. 새 settings shape와 protocol union을 테스트에 먼저 표현한다.

완료 조건:

- 기존 `answer` fixture가 변하지 않는다.
- 새 테스트가 구현 부재 때문에 예상된 지점에서만 실패한다.
- secret canary 문자열이 어느 snapshot/log에도 들어가지 않는다.

### 단계 1 — 설정·migration·secret 저장

1. TS/Python 설정 타입과 bound를 추가한다.
2. `cloneSettings`, default, migration을 갱신한다.
3. MCP secretStorage helper를 구현한다.
4. `service-config.json` serializer가 secret 값을 구조적으로 받을 수 없게 타입과 테스트로 고정한다.

완료 조건:

- 기존 data.json을 읽으면 기능이 모두 off인 상태로 정상 시작한다.
- 중첩 설정 clone이 원본을 alias하지 않는다.
- 저장된 data/config/history에서 canary secret 검색 결과가 0건이다.

### 단계 2 — Skills registry와 project prompt

1. safe discovery와 frontmatter parser를 구현한다.
2. prompt builder와 `skill_load`/`skill_read_resource`를 구현한다.
3. project rules textarea와 AGENTS snapshot import를 연결한다.
4. prompt 전체 및 skill resource budget을 적용한다.

완료 조건:

- 정상 skill, malformed skill, duplicate, traversal, out-of-root junction 테스트 통과
- project rules가 system 구획에 정확히 한 번 포함됨
- vault source와 MCP result가 project rules 구획에 들어갈 수 없음
- 스킬 본문은 선택 전 기본 prompt에 포함되지 않음

### 단계 3 — MCP host

1. pinned SDK로 event-loop thread와 persistent session을 구현한다.
2. connect/list/call/cancel/reconnect/close를 구현한다.
3. alias와 schema/result normalization을 구현한다.
4. `set_mcp_secrets`, status, refresh protocol을 연결한다.

완료 조건:

- 두 개 mock server를 동시에 연결하고 이름 충돌 없이 호출
- 설정 한 서버 변경 시 그 서버만 재연결
- parent env의 API key가 MCP child에 전달되지 않음
- backend 종료 후 mock child process가 남지 않음
- timeout/cancel 뒤 다음 호출이 정상 동작

### 단계 4 — Provider native tools

1. provider-neutral message/turn contract를 만든다.
2. OpenAI Responses adapter를 구현한다.
3. OpenAI-compatible adapter를 구현한다.
4. malformed/unknown/unsupported tool 오류 mapping을 추가한다.

완료 조건:

- fixture round trip에서 call ID와 arguments가 손실되지 않음
- tool text와 최종 text가 섞여도 최종 answer와 calls를 구분
- tools 미지원 provider는 `LLM_TOOLS_UNSUPPORTED`
- API key/reasoning content가 diagnostic에 노출되지 않음

### 단계 5 — Agent run과 승인 protocol

1. structured loop와 built-in/MCP/skill registry를 연결한다.
2. approval boundary와 run registry를 구현한다.
3. start/continue/cancel validation을 구현한다.
4. TTL, active run cap, turn/call/context budget을 구현한다.
5. legacy deep fallback을 연결한다.

완료 조건:

- `ask` 도구는 승인 전에 mock server call count가 0
- allow 후 정확히 1회 실행
- reject 후 서버는 호출되지 않고 모델은 rejection result를 받음
- duplicate continue가 같은 side effect를 재실행하지 않음
- expired/cancelled run은 coded error
- external-only answer가 기존 vault-empty guard로 덮어써지지 않음

### 단계 6 — UI와 history

1. settings 하위 renderer를 추가한다.
2. AnswerSession step state를 구현한다.
3. 승인 카드·취소·tool activity를 렌더링한다.
4. safe history metadata만 저장한다.

완료 조건:

- 버튼 중복 클릭으로 tool이 중복 실행되지 않음
- 새 질문/clear/view close가 pending run을 cancel
- history 복원 시 raw args/result와 session approval이 복원되지 않음
- keyboard와 screen-reader label이 존재
- 좁은/넓은 설정 창에서 행이 잘리지 않음

### 단계 7 — 통합·문서·릴리스

1. 전체 자동 테스트와 실제 provider smoke test를 수행한다.
2. packaged backend venv에서 `mcp==2.0.0` import와 stdio child 실행을 검증한다.
3. README/settings/protocol/architecture를 같은 변경에서 갱신한다.
4. source, `main.js`, manifest/backend version, release zip의 동기화를 검증한다.

완료 조건:

- 아래 최종 체크리스트 전부 통과
- clean install과 기존 v0.1.56 upgrade 모두 동작
- 기능 off 상태의 검색·answer 성능과 결과 계약에 의미 있는 회귀 없음

## 15. 자동 검증 체크리스트

### 15.1 기본 명령

```powershell
npm test
npm run build

Push-Location backend
python -X utf8 -m pytest -q
python -X utf8 -m ruff check .
python -X utf8 -m compileall -q vault_search
Pop-Location

git diff --check
git status --short
```

현재 조사 시 baseline:

- `npm test`: 15 files, 106 tests 통과
- `npm run build`: 통과
- `python -X utf8 -m pytest -q`: 단독 재실행에서 228 통과, 3 스킵
- 첫 Python 전체 테스트를 npm build와 병렬 실행했을 때 `test_service_build_search_auth_and_shutdown`의 `rebuild_all` 연결이 Windows `WinError 10054`로 한 번 끊겼고, 부하를 제거한 동일 명령 재실행에서는 통과했다. 구현 후 lifecycle/MCP child 테스트는 무거운 build와 병렬 실행하지 말고 단독으로도 반복 검증한다.

### 15.2 설정·migration

- [ ] v0.1.56 data.json load
- [ ] 새 default는 MCP/skills off
- [ ] user custom provider/model/rules 보존
- [ ] malformed MCP server 하나가 일반 검색 시작을 막지 않음
- [ ] clone 후 nested args/policies/root 수정이 원본을 바꾸지 않음
- [ ] restart 후 선택 provider/model/rules/MCP/skills 상태 유지
- [ ] service config에 fetched model cache와 secret value가 없음

### 15.3 Provider 계약

- [ ] OpenAI Responses: tools request shape
- [ ] OpenAI Responses: multiple function calls
- [ ] OpenAI Responses: function_call_output ordering
- [ ] Chat Completions: assistant tool_calls + role tool ordering
- [ ] JSON arguments object/string normalization
- [ ] empty text + valid tool calls는 bad response가 아님
- [ ] final empty text는 `LLM_BAD_RESPONSE`
- [ ] 401/403/429/5xx/timeout 기존 mapping 유지
- [ ] tools unsupported 400/422 mapping
- [ ] reasoning effort shape 회귀 없음

### 15.4 MCP lifecycle

- [ ] disabled server는 spawn하지 않음
- [ ] missing command는 해당 server error
- [ ] connect timeout
- [ ] initialize/list timeout
- [ ] tool list cache와 refresh invalidation
- [ ] server/tool name collision
- [ ] malformed input schema 격리
- [ ] argument schema 불일치 시 미실행
- [ ] text 여러 content 결합
- [ ] structured content 보존
- [ ] unsupported binary/image result coded error
- [ ] oversized result truncation
- [ ] `isError=true` propagation
- [ ] call timeout 후 session 상태
- [ ] call cancel
- [ ] changed server only reconnect
- [ ] plugin unload/backend shutdown child cleanup
- [ ] standalone owner idle exit child cleanup
- [ ] MCP stderr에 secret이 포함돼도 plugin log redaction 또는 stderr 비기록 정책 검증

마지막 항목은 특히 중요하다. 외부 MCP 서버가 자신에게 전달된 secret을 stderr로 출력할 수 있다. SDK stdio transport의 `errlog`를 backend log에 그대로 연결하지 말고 기본 폐기 또는 민감값 redactor를 거친 제한 로그로 연결한다.

### 15.5 승인·멱등성

- [ ] default policy `ask`
- [ ] deny tool schema 미노출
- [ ] ask tool 승인 전 call count 0
- [ ] allow_once 정확히 1회
- [ ] allow_session 다음 turn 자동 허용
- [ ] 새 conversation에서는 다시 ask
- [ ] reject는 side effect 0
- [ ] duplicate continue side effect 1회 이하
- [ ] stale generation UI 반영 안 됨
- [ ] run TTL cleanup
- [ ] active run cap
- [ ] cancel 후 continue 거부
- [ ] mixed call batch에서 deny/ask/allow 처리 일관성

### 15.6 Skills

- [ ] 세 project-local root 탐색
- [ ] user absolute root는 명시적 opt-in만
- [ ] YAML BOM/CRLF 처리
- [ ] missing/malformed frontmatter
- [ ] duplicate name conflict
- [ ] case-insensitive Windows path collision
- [ ] file/junction/symlink root escape
- [ ] hidden credential 후보 거부
- [ ] file와 run budget
- [ ] catalog만으로 body가 prompt에 새지 않음
- [ ] load 후 resource read
- [ ] 스크립트 파일을 읽어도 실행되지 않음

### 15.7 Prompt·데이터 경계

- [ ] 고정 security prompt가 항상 첫 구획
- [ ] project rules 정확히 한 번
- [ ] rules 32,000자 bound
- [ ] skill catalog와 loaded body 구분
- [ ] vault source의 “ignore previous instructions”가 system rules로 승격되지 않음
- [ ] MCP result의 prompt injection이 승인 정책을 바꾸지 못함
- [ ] registered tool 외 이름 호출 거부
- [ ] source/tool/result 총 context budget
- [ ] 사용자 언어와 citation 지침 유지

### 15.8 비밀값 canary 검사

테스트마다 고유한 `MCP_CANARY_SECRET_...` 값을 사용하고 종료 후 다음 위치를 검색한다.

- plugin `data.json`
- `service-config.json`
- `runtime.json`
- `machine.json`
- `backend.log`
- history markdown
- protocol 성공/오류 JSON
- test snapshot/output

Git 작업 트리에서도 확인한다.

```powershell
rg -n "MCP_CANARY_SECRET_|OPENAI_CANARY_SECRET_" .
```

fixture 정의 자체 이외 결과가 없어야 한다.

## 16. 수동 E2E 검증 체크리스트

### 16.1 Clean install

- [ ] 새 vault에 plugin 설치
- [ ] backend CPU runtime 설치
- [ ] 일반 search 정상
- [ ] API provider key 저장·모델 선택·기존 deep answer 정상
- [ ] MCP/skills off일 때 UI와 응답이 기존과 동일

### 16.2 Project rules

- [ ] textarea에 한국어 응답 규칙 입력 후 실제 답변 반영
- [ ] root `AGENTS.md` import 후 snapshot hash 표시
- [ ] import 뒤 AGENTS.md 수정이 자동 반영되지 않음
- [ ] 다시 import하면 새 내용 반영
- [ ] 32,000자 초과 UI와 backend 양쪽 거부
- [ ] rules 안의 CLI 전용 명령을 실제 등록 tool로 오인하지 않음

### 16.3 Skills

- [ ] 간단한 테스트 skill 생성
- [ ] 재검색 후 catalog 표시
- [ ] 질문과 무관한 skill body가 provider request에 없음
- [ ] 관련 질문에서 모델이 `skill_load` 호출
- [ ] skill reference 파일 읽기
- [ ] root 밖 참조 거부
- [ ] skill이 요구한 작업을 허용 MCP 도구로 수행
- [ ] skill script는 실행되지 않음

### 16.4 Read-only MCP

- [ ] filesystem/calculator 형태 test server 등록
- [ ] 연결 상태와 tool list 표시
- [ ] tool default ask
- [ ] 인자 확인 후 한 번 허용
- [ ] 결과가 최종 답변에 반영
- [ ] 이 대화에서 허용 후 재호출은 자동 실행
- [ ] 새 대화에서 다시 승인 요구

### 16.5 Side-effect MCP

- [ ] 테스트용 create/update tool 등록
- [ ] 거부 시 실제 상태 변화 없음
- [ ] 허용 시 정확히 한 번만 변화
- [ ] 더블 클릭/네트워크 retry/continue retry에도 중복 실행 없음
- [ ] always allow는 설정에서만 바뀜

### 16.6 오류·복구

- [ ] command 없음
- [ ] server handshake 실패
- [ ] list tools 실패
- [ ] call timeout
- [ ] server가 call 중 종료
- [ ] 잘못된 JSON arguments
- [ ] provider tools unsupported
- [ ] backend restart 후 MCP reconnect
- [ ] plugin unload 후 child process 없음
- [ ] 한 MCP server 오류 중 다른 server와 일반 vault search 정상

### 16.7 UI와 레이아웃

- [ ] 좁은 settings 창
- [ ] 넓은 settings 창
- [ ] 긴 command/args/tool description
- [ ] 100개 tool 목록 성능
- [ ] dark/light theme
- [ ] 키보드만으로 승인/거부/취소
- [ ] screen reader label
- [ ] 승인 대기 중 view 닫기/재열기

## 17. 보안 검토 체크리스트

- [ ] MCP server 등록은 명시적 사용자 행동
- [ ] 새 MCP tool 기본 `ask`
- [ ] annotations를 신뢰해 자동 승인하지 않음
- [ ] command 실행에 `shell=True` 사용 금지
- [ ] command와 args를 문자열 shell command로 합치지 않음
- [ ] child working directory가 명확함
- [ ] child env 최소화 및 서버별 격리
- [ ] provider key가 MCP child env에 없음
- [ ] MCP secret이 config/log/history에 없음
- [ ] MCP stderr secret 노출 방지
- [ ] tool args/result 로그 금지
- [ ] tool result context size 제한
- [ ] skill traversal/junction/symlink 방지
- [ ] vault read scope 기존 검사 유지
- [ ] duplicate continue side effect 방지
- [ ] run TTL과 active cap으로 메모리 고갈 방지
- [ ] server/tool/schema 수 제한으로 prompt·메모리 고갈 방지
- [ ] project rules가 approval/security를 덮어쓰지 못함
- [ ] 일반 vault/MCP content를 system instruction으로 승격하지 않음

## 18. 성능·운영 검증

측정 항목:

- MCP/skills off인 backend 시작 시간
- MCP 서버 0/1/5개 연결 시 시작 시간
- tool catalog 10/100/500개 prompt 문자·토큰 수
- answer first-token 전 list-tools 비용
- cached list-tools 경로
- idle MCP child의 메모리와 handle 수
- backend restart 20회 후 orphan process 수
- tool 결과 32k와 skill resource 256k에서 context cap 동작

허용 기준:

- MCP/skills off 경로 시작 시간과 answer latency가 baseline 대비 5% 이상 악화되지 않음
- tool list는 매 model turn마다 네트워크 재조회하지 않고 cache 사용
- MCP server config/notification 변경 때만 해당 cache 무효화
- backend 종료 후 5초 내 관리 child가 모두 종료
- 100개 활성 tool에서도 provider request가 설정한 전체 payload bound 안에 있음

tool 수가 많으면 모든 schema 전송이 비싸다. 첫 구현은 활성 도구만 전송하고, 100개를 넘으면 UI 경고와 hard cap을 적용한다. 향후 tool search/router 기능은 별도 개선으로 다룬다.

## 19. 문서·릴리스 체크리스트

- [ ] README에 MCP/skills/project rules 기능과 Desktop 전용 표시
- [ ] settings 문서에 secret 저장 방식과 provider 전송 경고
- [ ] protocol 문서에 request/response JSON 예시
- [ ] architecture 문서에 event-loop thread와 run registry
- [ ] MCP SDK 정확한 pin을 세 dependency manifest에 동기화
- [ ] CPU/CUDA managed runtime 모두 MCP import 검사
- [ ] release zip에 새 Python modules와 requirements 포함
- [ ] plugin/backend/manifest/versions 버전 동기화
- [ ] source build 결과 `main.js` 동기화
- [ ] clean install과 upgrade install smoke test
- [ ] 태그 checkout으로 동일 release zip 재현 가능

## 20. 완료 정의

다음 시나리오가 한 번의 실제 사용자 흐름에서 성공해야 기능이 완료된 것이다.

1. 사용자가 설정에서 프로젝트 `AGENTS.md`를 가져온다.
2. project-local skill 하나를 활성화한다.
3. secret이 필요한 stdio MCP 서버를 등록하고 tool 하나를 `ask`로 둔다.
4. API provider 모델에 질문한다.
5. 모델은 관련 skill만 로드하고, 필요할 때 MCP tool call을 요청한다.
6. UI가 server/tool/arguments를 보여 주며 실행 전 대기한다.
7. 사용자가 한 번 허용하면 tool이 정확히 한 번 실행된다.
8. 모델이 vault sources와 MCP result를 이용해 답하고 vault facts에는 기존 `[S#]` citation을 붙인다.
9. history에는 답변, vault citations, 안전한 tool activity만 저장되고 secret/arguments/raw result는 없다.
10. plugin을 종료했을 때 sidecar와 MCP child가 정리되고, 재시작 후 설정과 server 상태가 정상 복구된다.

이 시나리오와 전체 자동 테스트, secret canary 검사, packaged runtime smoke test가 모두 통과하기 전에는 완료로 표시하지 않는다.

## 21. 구현자가 임의로 바꾸면 안 되는 결정

- MCP host는 Python sidecar에 둔다.
- 첫 릴리스 transport는 stdio만 지원한다.
- 외부 MCP tool의 기본 정책은 `ask`이다.
- MCP annotations만으로 자동 승인하지 않는다.
- 승인 전 side-effect tool을 실행하지 않는다.
- MCP secret 값은 plugin data/service config/history/log에 저장하지 않는다.
- project rules는 system 지침으로 전달하되 제품 보안 지침보다 우선하지 않는다.
- 스킬은 점진적으로 로드하며 첫 릴리스에서 script를 실행하지 않는다.
- external tool 사용 때문에 기존 vault citation 의미를 바꾸지 않는다.
- 기존 `answer` 계약과 extensions-off 동작을 한 릴리스 이상 보존한다.

구현 중 이 결정과 실제 코드가 충돌하거나 public protocol/persisted format/security 경계를 바꿔야 한다면, 추측으로 진행하지 말고 해당 한 가지 설계 쟁점만 별도로 검토한 뒤 계약·테스트·문서를 함께 수정한다.

## 22. 구현 기록 (2026-08-23)

### 22.1 어디까지 수행했는가

단계 0~6은 모두 구현을 마쳤다. 단계 7(통합·문서·릴리스) 중 README/docs 갱신과 버전 동기화(v0.1.57)까지 완료했고, release zip 검증과 실제 provider 키를 쓰는 최종 사용자 흐름 확인(§20 시나리오)이 남아 있다.

구현된 것:

- 설정·migration: `answerProjectRules`/`answerProjectRulesSource`/`mcpServers`/`skillRoots`/`enabledSkills` 신규 필드와 v3 migration, secretStorage 기반 MCP 시크릿 저장
- Python 신규 모듈 5종:
  - `agent_prompt.py` — 보안 지침 → `<project_rules>` → 스킬 카탈로그 → 도구 사용법 순의 고정 우선순위 system prompt 조립기
  - `skills.py` — 3개 프로젝트 루트 + 사용자 루트 탐색, 점진적 로딩(`skill_load`/`skill_read_resource`), credential 파일 차단, junction/symlink 탈출 차단
  - `agent_tools.py` — built-in 도구 정의, `mcp__<server>__<tool>` alias 네임스페이스, schema/argument 방어적 검증, MCP 결과 정규화
  - `mcp_host.py` — 전용 event-loop 스레드 + stdio 영속 세션(`mcp==2.0.0` pin), 시크릿은 인증된 loopback(`set_mcp_secrets`)으로만 주입, stderr 폐기, 협력→강제 2단계 자식 정리
  - `agent_run.py` — 승인 경계가 있는 구조화 run 상태머신(call id당 실행 1회 보장, allow_session 대화 범위, TTL 10분·동시 run 4개)
- `llm.py`: OpenAI Responses / 호환 Chat Completions 양쪽 native tool calling, HTTP 400/422 → `LLM_TOOLS_UNSUPPORTED`
- protocol/server/service: `answer_start/continue/cancel`, `set_mcp_secrets`, `mcp_status/mcp_refresh`, `skills_status/skills_refresh`
- 플러그인: AnswerSession step 상태머신, 승인 카드(더블클릭 가드·aria-label), tool activity 렌더링, 설정 UI 3분리(api-agent/mcp/skill), history에 안전한 tool activity 메타데이터만 저장
- extensions가 모두 꺼지면 기존 legacy deep-answer 경로 유지(§21 계약 보존)

테스트 baseline 대비: pytest 228 → 348 통과(+3 skip), vitest 106 → 137. 실서버 E2E 스모크(시크릿 대기→주입→연결→도구 발견→스킬 탐색→인덱스→라우팅→shutdown 후 MCP 자식 잔존 0건) 통과.

### 22.2 오늘 발견해 수정한 결함 (1~7)

검토 결과 "1~5번을 해결하기 전에는 릴리스 보류" 판정을 받아 다음 일곱 가지를 최소 범위로 수정했다.

1. **프로젝트 규칙만 설정하면 structured agent가 활성화되지 않았다**
   - 원인: `_extensions_active()`가 mcp/skills 플래그만 보았고, 플러그인 hotConfig의 `answerProjectRules`와 백엔드 파서의 `projectRules` 키가 달라 규칙이 실제로 적용되지 않았다.
   - 수정: 규칙이 비어있지 않으면 structured 활성화. `answerProjectRules`를 정식 키로 수용하고 `projectRules`는 한 릴리스 호환 alias로 유지.
2. **external-only 답변이 부족 문구로 덮어써졌고 continue 완료의 provider/model이 공백이었다**
   - 원인: vault source 부재 시 성공한 MCP 활동 여부와 무관하게 덮어쓰기. `_answer_continue`가 provider=None을 전달.
   - 수정: "source 없음 AND 성공 tool 없음"일 때만 덮어쓰기. groundingKind 산출은 그대로. RunState에 provider를 저장해 continue 완료가 start 완료와 동일 소스를 사용.
3. **실행 중 취소가 직렬 task 큐 뒤에서 막혔다**
   - 원인: `answer_cancel`도 큐를 거쳐 장시간 answer 작업 뒤에 줄섬. 첫 turn은 클라이언트가 run_id를 몰라 취소 요청 자체가 불가했다.
   - 수정: handler 스레드에서 즉시 실행하는 thread-safe `cancel_answer()`(레지스트리·cancelled 플래그·MCP cancel registry만 접근). 등록 전 취소는 pending-cancel 마커로 흡수. additive client `run_id`(패턴 `[A-Za-z0-9_-]{8,64}`, v1 기존 필드 불변) 도입. provider turn 반환 직후 cancelled 가드로 늦게 도착한 turn 폐기. 플러그인은 시작 전 UUID 발급·즉시 추적하고 cancel 이후 늦게 온 start/continue 응답은 런 단위 가드로 폐기.
4. **enabledSkills가 완전히 무시되었다**
   - 원인: `SkillRegistry.refresh(enabled_skills=...)` 인자를 사용하지 않았고 UI는 빈 배열="전체 활성"으로 해석했다.
   - 수정: 카탈로그를 allowlist 교집합으로 한정(빈 set=활성 없음, None=발견 전체). 미선택 skill은 catalog_lines/skill_load/read_resource 어디로도 가지 않음. UI는 "모두 선택" 시 발견된 canonical ID 전체를 명시 저장하고 개별 토글은 settings 저장 플로우로 재시작 후 유지.
5. **set_mcp_secrets가 무검증 수용이었다**
   - 원인: 미등록 server ID/env 이름을 그대로 메모리에 적립 — 나중에 child env로 주입될 수 있었고(예: OPENAI_API_KEY), 값 삭제가 전파되지 않았다.
   - 수정: 미등록 서버=전체 거부(`MCP_UNKNOWN_SERVER`), 미등록 env=격리 후 이름만 보고. 서버별 wholesale replace로 rotation/deletion을 구현하고 값이 바뀐 서버만 재연결(awaiting→완료된 서버 포함). 저장/회전/삭제 직후 최신 스냅샷을 푸시하고 env row 제거 시 SecretStorage 값도 삭제.
6. **provider 노출 도구와 per-run 컨텍스트에 bound가 없었다**
   - 원인: alias map이 연결된 서버의 도구를 전부 노출했고 개별 schema bound(64KiB)만 존재. MCP 결과와 skill body는 예산 추적 밖이라 run당 이론상 ~960KiB 유입 가능했다.
   - 수정: `build_alias_map`에서 정렬 순 100개 hard cap(노출=실행 경계 일치, 미등록 alias는 resolve 불가), schema 총량 256KiB prefix-cut, run당 512KiB 공유 예산을 vault source/MCP 결과/skill body·resource에 적용. 초과분은 조용히 누락하지 않고 `[CONTEXT_BUDGET_EXHAUSTED]` coded tool error로 반환(side effect가 발생한 호출의 activity는 success 유지). status의 `agent_tool_surface`와 MCP 설정 UI에 truncation 경고 표시.
7. **per-turn cap 초과 tool call이 transcript에 dangling으로 남았다**
   - 원인: `tool_calls[:MAX_TOOL_CALLS_PER_TURN]` 절단 후 assistant 메시지에는 전체 호출을 남겨 초과 call에 대응하는 result가 없었다.
   - 수정: 초과 call마다 `TOOL_BUDGET_EXHAUSTED` result를 생성 — Chat Completions와 Responses payload 양쪽에서 assistant call:result = 1:1 보장.

### 22.3 구현·디버깅 과정에서 추가로 발견한 문제

- **MCP SDK 1.x/2.x 필드명 차이**: 2.x는 `input_schema`/`is_error`, 1.x는 `inputSchema`/`isError`. 버전 무관 접근자(`_result_attr`)로 해결하고 두 버전 모두에서 검증했다.
- **wait_connected 경쟁 상태**: 재연결 시 오래된 ready 이벤트를 기다려 실패. 세대별 짧은 폴링으로 수정.
- **Windows `os.kill(pid, 0)`**: 프로브가 아니라 프로세스 종료를 수행한다. 생존 확인은 exit-code 조회로 교체.
- **스모크 스크립트 stdout 미소진 시 서버 본체 블록**(py-spy 덤프로 진단): 제품 결함이 아니라 하니스 문제 — 실제 플러그인은 stdout을 소진한다.
- **resume 경로 예산 우회, 중복 id 처리** 등 agent_run 로직 결함 다수 수정.
- **in-process TCP 하니스에서 task 큐 무처리**: `serve_forever`만 띄우면 run_server 본체의 drain 루프가 없어 answer_start가 영원히 실행되지 않는다. 하니스에 drain 스레드를 재현해 해결.
- **Windows loopback RST 경합**: 응답 write+close가 마이크로초 단위로 연속일 때 클라이언트가 데이터를 받지 못하고 WSAECONNRESET(10054). 파일 트레이스 계측으로 서버 측은 정상(write done→clean close)임을 확인했다. 대응: (a) `protocol.request`가 멱등 메서드(answer_cancel/status류)에 한해 읽기-단계 리셋을 1회 재시도, (b) 비멱등 answer_start/continue는 재시도하지 않고 테스트 단언을 응답 의존에서 상태 불변식(activity=`cancelled`, 레지스트리 drain, provider 재호출 0건)으로 전환. 8회 연속 반복 통과.

### 22.4 최종 검증 결과 (2026-08-23)

```text
npm test                    137 passed (17 files)
npm run build               tsc + esbuild 통과
pytest -q                   348 passed, 3 skipped (~82s)
ruff check .                All checks passed
compileall -q vault_search  OK
git diff --check            OK
canary rg                   저장소 내 fixture 정의 외 0건
packaged venv               mcp==2.0.0 import OK (Python 3.13)
stdio E2E (packaged venv)   connect→call→실행 중 cancel(즉시, MCP_CALL_CANCELLED)→close→5초 후 orphan 없음
안정성                      test_agent_fixes.py 8회 연속 통과
```

추가 회귀 테스트 40개: `test_agent_fixes.py` 신규 18(rules 활성/키 통일/런타임 변경, MCP-only/mixed/none/continue 메타데이터, out-of-band 취소·pending 마커·client id·TCP 첫 turn/승인 후 continue, 시크릿 거부/격리/rotation, 500개 tool cap/schema 총량), `test_agent_run.py` +6(예산 3종/overflow/payload 완전성 양쪽), `test_skills.py` +3(allowlist/빈 set/None), `test_mcp_host.py` +7(rotation 선택 재연결/거부/격리, 제거 서버 purge·unknown 거부·재등록 clean 시작, error 상태 rotation 재연결·신규 자식 시크릿 전달·global-disabled 무시), `test_protocol.py` +3(run_id), vitest +3(client run_id 2종/시크릿 스냅샷 갱신).

### 22.5 남은 수동 항목

- [ ] 실제 API 키를 넣은 §20 최종 시나리오(승인 카드→continue→완료 화면 흐름)
- [ ] Obsidian GUI 육안 확인: 스킬 카탈로그 토글·"모두 선택", MCP tool-surface 경고 문구
- [ ] Windows loopback RST가 TS 전송 경로(플러그인 requestBackend)에서도 관찰되는지 장기 모니터링 — Python 측은 멱등 재시도로 방어했으나 TS 측은 미적용
- [ ] `release.ps1` 패키징 후 zip 내용물 검증

작업 트리는 커밋하지 않은 상태로 보존되어 있다.
