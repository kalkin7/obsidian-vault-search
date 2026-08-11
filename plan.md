# Obsidian Vault Search 구현 계획

> 이 문서는 다른 구현 모델이 추가 설계 판단을 최소화하고 그대로 단계별 구현할 수 있도록 작성한 실행 계획서입니다.
>
> **구현 상태 (2026-08-11):** v0.1.0 코어 구현, K_Notes 개발 설치, LocalAppData 전체 인덱스 구축, lifecycle·증분 동기화·CLI·성능 smoke test, private GitHub 저장소·CI·release 게시까지 완료했습니다. 실제 결과는 [`docs/implementation-report-2026-08-11.md`](docs/implementation-report-2026-08-11.md)에 정리했습니다.

---

## 1. 프로젝트 목표

Obsidian 데스크톱에서 특정 볼트를 열었을 때만 로컬 임베딩 모델과 검색 백엔드를 로드하고, 볼트를 닫거나 플러그인을 비활성화하면 모델을 완전히 언로드하는 **데스크톱 전용 Obsidian 플러그인**을 만듭니다.

플러그인이 다음을 담당해야 합니다.

1. Python 검색 백엔드 프로세스의 시작·상태 확인·종료
2. 임베딩 모델, CPU/CUDA, include/exclude 범위 등의 설정 관리
3. 볼트 파일 변경 이벤트를 백엔드에 전달하여 인덱스를 증분 동기화
4. 인덱스 구축·재구축·상태 확인 UI 제공
5. 외부 CLI/AI 에이전트가 플러그인의 설정과 실행 중인 백엔드를 이용해 검색하도록 로컬 프로토콜 제공
6. Obsidian/플러그인 종료 후 Python 프로세스와 모델이 남지 않도록 보장

### 핵심 설계 원칙

- 임베딩 모델을 Obsidian Electron 렌더러 안에 직접 로드하지 않습니다.
- Obsidian 플러그인은 **프로세스 감독자(supervisor)** 역할만 합니다.
- 모델은 별도의 Python 자식 프로세스(sidecar)에 로드합니다.
- CLI는 모델을 직접 import하거나 로드하지 않는 **얇은 클라이언트**로 만듭니다.
- Python 백엔드 한 프로세스가 검색과 증분 인덱싱을 모두 담당하여 모델 중복 로드를 막습니다.
- 고정 포트 대신 볼트별 동적 포트를 사용합니다.
- 인덱스·가상환경·로그·runtime 파일은 기본적으로 볼트 밖의 PC 로컬 저장소에 둡니다.
- 최초 버전은 개인용/볼트 전용으로 완성하고, 공개 Community Plugin 등록은 별도 후속 작업으로 둡니다.

---

## 2. 현재 시스템 파악 결과

기존 검색 시스템 위치:

```text
<현재 K_Notes 볼트>/9_System/scripts/hybrid-search/
```

주요 파일:

```text
_common.py
build_index.py
config.json
query.py
rebuild_vectors.py
sync.py
requirements.txt
index/chunks.db
index/vectors.usearch
```

현재 실제로 검사한 개발 환경의 볼트 경로는 다음이지만, 새 코드에 절대 경로를 하드코딩하면 안 됩니다.

```text
C:\Users\manager\Documents\Obsidian\K_Notes
```

기존 인덱스 기준값:

- 인덱싱 파일: 약 2,873개
- 청크: 약 8,343개
- `chunks.db`: 약 12MB
- `vectors.usearch`: 약 26MB
- 현재 모델: `intfloat/multilingual-e5-base`
- 현재 고정 포트: `17951`
- 캐시 확보 후 모델 재로딩: 약 10.4초
- 데몬 워밍 후 검색: 약 0.16초

### 기존 코드에서 그대로 복사하면 안 되는 문제

1. `query.py`가 데몬을 `DETACHED_PROCESS`로 실행하므로 호출 프로세스나 Obsidian이 종료되어도 상주합니다.
2. 포트 `17951`이 고정되어 여러 볼트 또는 중복 프로세스에서 충돌할 수 있습니다.
3. CLI가 데몬 시작 실패 시 최대 150초를 기다립니다.
4. `sync.py`가 데몬과 별개로 모델을 로드하여 메모리 중복 사용 가능성이 있습니다.
5. `sync.py`에서 벡터 인덱스 복원 실패 시 `ndim=1024`를 하드코딩합니다. e5-base는 일반적으로 768차원이므로 잘못된 처리입니다.
6. 모델, 임베딩 차원, 접두어, 정규화 방식, 청킹 설정을 벡터 인덱스와 대조하는 메타데이터가 없습니다.
7. 데몬 실행 중 모델 설정을 바꿔도 전역 `_embed` 객체가 이전 모델로 남을 수 있습니다.
8. exclude 처리가 glob이 아니라 `문자열이 경로 안에 포함되는지`로 검사됩니다.
9. 현재 e5-base 사용 시 `query:` / `passage:` 접두어를 적용하지 않습니다. 모델 카드 확인과 재벤치마크가 필요합니다.
10. 기존 인덱스는 위 설정 메타데이터가 없으므로 새 플러그인 인덱스로 그대로 신뢰하여 복사하지 않습니다.

---

## 3. 최종 아키텍처

```text
Obsidian에서 볼트 열기
  └─ obsidian-vault-search 플러그인 onload
       ├─ 설정 로드
       ├─ Vault 파일 이벤트 등록
       └─ workspace.onLayoutReady 이후 비동기 백엔드 기동
            └─ Python sidecar
                 ├─ 동적 포트(127.0.0.1:0) 바인딩
                 ├─ runtime.json 원자적 기록
                 ├─ Kiwi + 임베딩 모델 1회 로드
                 ├─ SQLite FTS5 + USEARCH 인덱스 소유
                 ├─ 검색 요청 처리
                 └─ 파일 변경/재구축 요청 처리

CLI / AI 에이전트
  └─ 볼트 루트 탐색
       └─ LocalAppData의 runtime.json 탐색
            └─ 인증 토큰을 포함한 JSON-line 요청

플러그인 비활성화 / 볼트 종료
  └─ shutdown 요청 → 제한 시간 내 종료 확인 → 필요 시 kill
       └─ Python 프로세스 종료로 모델 메모리 완전 해제
```

### 중요한 구현 결정

- 플러그인 `manifest.json`에는 반드시 `"isDesktopOnly": true`를 설정합니다.
- Node `child_process.spawn()`을 사용하되 `detached: false`, `shell: false`, `windowsHide: true`로 실행합니다.
- 명령과 인수는 문자열 셸 명령으로 결합하지 말고 배열로 전달합니다.
- `onload()`에서 모델 로딩 완료를 기다리지 않습니다. UI가 멈추지 않게 `workspace.onLayoutReady()` 뒤에서 비동기로 시작합니다.
- Python 백엔드는 플러그인 부모의 stdin EOF와 heartbeat를 감시합니다. Obsidian이 비정상 종료되어 파이프가 닫히거나 heartbeat가 끊기면 스스로 종료합니다.
- 정상 종료 시 플러그인은 `shutdown` 요청 후 최대 3~5초 기다리고, 실패하면 자식 프로세스를 종료합니다. Windows 최후 수단은 `taskkill.exe /PID <pid> /T /F`를 `execFile()`로 호출합니다.

---

## 4. 저장 위치 설계

### Git 저장소

```text
C:\Users\manager\Dev\obsidian-vault-search
```

### 플러그인 설치 위치

```text
<볼트>\.obsidian\plugins\obsidian-vault-search\
```

설치 폴더에는 빌드 산출물만 둡니다.

```text
main.js
manifest.json
styles.css             # 실제 스타일이 있을 때만
```

### PC 로컬 데이터

기본 위치:

```text
%LOCALAPPDATA%\ObsidianVaultSearch\
  runtime\<backend-version>\
    venv\
  vaults\<vault-id>\
    machine.json
    runtime.json
    backend.log
    index\
      chunks.db
      vectors.usearch
      metadata.json
```

`vault-id` 생성 규칙:

1. 볼트 루트의 정규화된 절대 경로를 구합니다.
2. Windows에서는 경로 구분자를 통일하고 소문자로 변환합니다.
3. SHA-256 해시의 앞 16~24자를 사용합니다.
4. 볼트가 이동하면 새 인덱스로 판단합니다.

### 플러그인 `data.json`에 저장할 설정

볼트와 함께 이동해도 되는 portable 설정만 저장합니다.

- load policy
- model profile ID
- custom model 설정
- device preference
- include globs
- exclude globs
- chunk size/overlap
- BM25/vector top-k
- RRF k
- 자동 동기화 설정

### `machine.json`에 저장할 설정

PC마다 달라질 수 있는 값만 LocalAppData에 저장합니다.

- Python launcher 또는 전용 venv Python 경로
- 로컬 인덱스 경로 재정의
- 로컬 HF cache 경로 재정의
- GPU/CPU 로컬 override가 필요할 경우 해당 값

`runtime.json`과 인증 토큰은 절대 Git이나 Remotely Save 동기화 대상에 넣지 않습니다.

---

## 5. 저장소 파일 구조

다음 구조를 기본으로 사용합니다.

```text
obsidian-vault-search/
  plan.md
  README.md
  LICENSE
  .gitignore
  package.json
  package-lock.json
  tsconfig.json
  esbuild.config.mjs
  manifest.json
  versions.json

  src/
    main.ts
    constants.ts
    types.ts
    settings.ts
    settings-tab.ts
    backend-manager.ts
    backend-protocol.ts
    runtime-paths.ts
    vault-event-queue.ts
    index-status.ts
    notices.ts

  backend/
    pyproject.toml
    requirements.txt
    vault_search/
      __init__.py
      __main__.py
      config.py
      runtime_paths.py
      protocol.py
      server.py
      service.py
      model_manager.py
      model_profiles.py
      tokenizer.py
      chunking.py
      scope.py
      database.py
      vector_index.py
      index_metadata.py
      indexing.py
      search.py
      cli.py
    tests/
      test_scope.py
      test_chunking.py
      test_index_metadata.py
      test_protocol.py
      test_runtime_paths.py
      test_cli_discovery.py
      test_lifecycle.py

  tests/
    plugin/
    integration/
    fixtures/
      sample-vault/

  scripts/
    setup-backend.ps1
    install-dev.ps1
    uninstall-dev.ps1
    smoke-test.ps1

  docs/
    architecture.md
    protocol.md
    settings.md
    development.md
    migration-from-knotes.md

  .github/
    workflows/
      ci.yml
      release.yml
```

`src`의 TypeScript 파일이 너무 커지지 않게 프로세스 관리, 설정, 이벤트 큐, 프로토콜을 분리합니다. Python도 기존처럼 모든 기능을 `query.py` 한 파일에 합치지 않습니다.

---

## 6. 플러그인 설정 명세

### 기본 설정값

```ts
loadPolicy: "vault-open" // vault-open | first-search | manual
modelProfile: "multilingual-e5-base"
device: "auto"          // auto | cpu | cuda
includeGlobs: ["**/*.md"]
excludeGlobs: [
  ".obsidian/**",
  "9_System/**",
  "**/node_modules/**"
]
chunkChars: 400
chunkOverlap: 60
bm25TopK: 30
vectorTopK: 30
finalTopK: 20
rrfK: 60
autoSync: true
syncDebounceMs: 1500
startupReconcile: true
```

K_Notes 마이그레이션 시에는 기존 범위와 동일하도록 명시적으로 다음 include를 설정할 수 있습니다.

```text
0_Slip-box/**
1_Projects/**
2_Area/**
3_Resource/**
4_Archive/**
5_Wiki/**
+/**
```

### 설정 UI 섹션

1. **서비스 상태**
   - 중지 / 시작 중 / 모델 로딩 중 / 준비 / 동기화 중 / 재구축 중 / 오류
   - PID, 포트, 모델, 디바이스, 시작 시각
   - 시작, 중지, 재시작 버튼

2. **시작 정책**
   - 볼트가 열릴 때 로드
   - 첫 검색 요청 때 로드
   - 수동 시작

3. **모델**
   - curated dropdown
   - 사용자 지정 Sentence Transformers 모델 ID
   - CPU/CUDA/자동
   - query/document prefix
   - normalize_embeddings
   - 예상 메모리·현재 벤치마크 설명

4. **검색 범위**
   - include glob 목록(한 줄에 하나)
   - exclude glob 목록(한 줄에 하나)
   - 현재 대상 파일 수 미리보기

5. **인덱스**
   - 파일 수, 청크 수, DB/벡터 크기
   - 마지막 동기화
   - 변경 대조
   - 증분 동기화
   - 벡터만 재구축
   - 전체 재구축

6. **고급 설정**
   - chunk size/overlap
   - top-k/RRF
   - debounce
   - Python/venv 상태
   - 로그 폴더 열기

### 설정 변경 시 동작

| 설정 변경 | 처리 |
|---|---|
| final top-k, BM25/vector top-k, RRF | 백엔드에 hot apply |
| include/exclude | 범위 reconciliation 수행 |
| 모델 또는 device | 기존 프로세스 종료 → 새 모델로 시작 → 벡터 재구축 요구 |
| query/document prefix, normalize | 벡터 재구축 요구 |
| chunk size/overlap, 토크나이저 규칙 | 전체 인덱스 재구축 요구 |
| load policy | 다음 lifecycle부터 적용 |

재구축이 필요한 변경을 했는데 사용자가 취소한 경우, 이전 설정과 인덱스로 계속 검색해야 합니다. 설정만 먼저 저장하여 인덱스와 불일치하는 상태를 만들지 않습니다.

---

## 7. 모델 프로필

최초 curated 모델:

1. `intfloat/multilingual-e5-base`
2. `BAAI/bge-m3`
3. `nlpai-lab/KoE5`
4. 사용자 지정 모델

각 프로필은 다음 메타데이터를 가져야 합니다.

```text
id
display_name
huggingface_model_id
query_prefix
document_prefix
normalize_embeddings
expected_dimension(optional)
resource_note
benchmark_note
```

### 반드시 지킬 사항

- e5-base의 query/document prefix는 공식 모델 카드를 확인한 뒤 지정합니다. 일반적으로 `query: ` / `passage: `가 필요하지만 추측만으로 확정하지 않습니다.
- BGE-M3와 KoE5도 공식 모델 카드의 검색용 입력 지침을 확인합니다.
- 모델을 최초 로드한 후 실제 embedding dimension을 측정하고 인덱스 메타데이터에 기록합니다.
- 사용자 지정 모델은 샘플 문장 encode 테스트에 성공한 뒤에만 활성화합니다.
- 새 모델로 전환할 때 기존 vector 파일을 덮어쓰지 말고 `.tmp`에 완성한 후 원자적으로 교체합니다.
- BM25/FTS DB는 모델과 무관하므로 청킹이 동일하면 그대로 유지하고 벡터만 재구축합니다.

---

## 8. 인덱스 및 메타데이터

SQLite에 기존 `chunks`, `chunks_fts`, `file_state` 외에 `index_metadata` 테이블을 추가합니다.

필수 키:

```text
schema_version
backend_version
model_id
embedding_dimension
normalize_embeddings
query_prefix
document_prefix
chunk_chars
chunk_overlap
tokenizer_version
scope_config_hash
created_at
updated_at
```

검색 전에 다음을 검증합니다.

1. 벡터 인덱스가 존재하는가
2. 벡터 차원이 현재 모델 출력과 일치하는가
3. 모델 ID와 prefix/normalize 설정이 일치하는가
4. chunk 설정이 SQLite 데이터와 일치하는가
5. USEARCH 파일이 SQLite보다 오래되거나 부분 생성 상태가 아닌가

불일치 시 시맨틱 검색을 조용히 수행하지 않습니다. `INDEX_REBUILD_REQUIRED` 오류를 반환하고 UI에 재구축 버튼을 표시합니다.

### 안전한 파일 교체

- 전체 DB 구축: `chunks.db.tmp` 완성 → 검증 → `os.replace()`
- 벡터 구축: `vectors.usearch.tmp` 완성 → 개수/차원 검증 → `os.replace()`
- 중간 실패 시 기존 정상 인덱스를 유지합니다.
- 백엔드에서 검색과 쓰기 작업을 단일 소유권으로 관리합니다.
- 초기 버전은 간단한 async lock 또는 작업 큐로 검색/인덱싱 충돌을 막습니다.

---

## 9. 파일 범위 및 증분 동기화

### glob 규칙

- 모든 경로는 `/`를 사용하는 볼트 상대 경로로 정규화합니다.
- include에 하나 이상 일치하고 exclude에는 일치하지 않는 `.md` 파일만 포함합니다.
- `..`, 절대 경로, 볼트 밖 경로는 거부합니다.
- Python과 TypeScript에서 같은 glob 결과가 나오도록 공유 테스트 fixture를 둡니다.
- 가능하면 백엔드 Python을 범위 판정의 단일 진실 공급원으로 사용합니다.

### Obsidian 이벤트

다음을 등록합니다.

```text
vault.on("create")
vault.on("modify")
vault.on("delete")
vault.on("rename")
```

이벤트 처리 규칙:

1. 이벤트에서 파일 내용을 직접 임베딩하지 않습니다.
2. 볼트 상대 경로와 이벤트 종류만 큐에 넣습니다.
3. 동일 파일의 연속 modify는 하나로 합칩니다.
4. debounce 후 한 번에 `sync_paths` 요청을 보냅니다.
5. rename은 old path 삭제 + new path 추가로 처리합니다.
6. 대량 이벤트 중에는 배치 크기를 제한합니다.

### 누락 방지

- 시작 시 전체 파일 목록과 `file_state`를 대조합니다.
- 외부 편집이나 Remotely Save 이벤트가 누락될 수 있으므로 선택적 주기 reconciliation을 지원합니다.
- reconciliation은 우선 mtime/size로 후보를 좁히고 필요할 때 hash를 계산할 수 있습니다.
- 변경량이 많아도 사용자 입력을 기다리는 CLI 대화형 프롬프트를 띄우지 않습니다. 플러그인 UI에서 승인하거나 백그라운드 정책으로 처리합니다.

---

## 10. 백엔드 프로토콜

TCP `127.0.0.1` JSON Lines를 사용합니다. HTTP 프레임워크를 새로 추가하지 않습니다.

### 요청 예시

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "token": "random-secret",
  "method": "search",
  "params": {
    "query": "전기차 충전기 설치 경과",
    "top_k": 20,
    "verbose": false
  }
}
```

### 응답 예시

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "ok": true,
  "data": {
    "mode": "hybrid",
    "model": "intfloat/multilingual-e5-base",
    "device": "cpu",
    "results": []
  }
}
```

오류 예시:

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "ok": false,
  "error": {
    "code": "MODEL_LOADING",
    "message": "Embedding model is still loading"
  }
}
```

### 필수 method

```text
health
status
search
sync_paths
reconcile
preview_scope
rebuild_vectors
rebuild_all
apply_search_config
heartbeat
shutdown
```

### 보안 및 안정성

- `127.0.0.1`에만 바인딩합니다.
- OS가 할당하는 동적 포트를 사용합니다.
- 시작할 때 `secrets.token_urlsafe()`로 토큰을 생성합니다.
- 모든 요청에서 token과 protocol version을 검증합니다.
- 요청 최대 크기를 제한합니다.
- 타임아웃과 잘못된 JSON을 처리합니다.
- 임의 명령 실행 API를 만들지 않습니다.
- 외부에서 전달된 절대 파일 경로를 그대로 열지 않습니다.

---

## 11. runtime.json 명세

LocalAppData의 해당 vault 디렉터리에 임시 파일 작성 후 원자적으로 교체합니다.

```json
{
  "runtime_schema": 1,
  "protocol_version": 1,
  "backend_version": "0.1.0",
  "vault_id": "...",
  "vault_path": "C:/.../K_Notes",
  "pid": 12345,
  "parent_pid": 23456,
  "host": "127.0.0.1",
  "port": 54321,
  "token": "...",
  "state": "loading",
  "model_id": "intfloat/multilingual-e5-base",
  "started_at": "ISO-8601"
}
```

- 백엔드 종료 시 삭제합니다.
- CLI는 파일이 있어도 `health` 응답과 PID를 확인합니다.
- stale runtime이면 빠르게 오류 처리하고 자동으로 모델을 시작하지 않습니다.
- CLI 연결 실패 대기 시간은 1초 안팎으로 제한합니다. 기존 150초 대기를 반복하지 않습니다.

---

## 12. Python 프로세스 lifecycle

### 시작

1. 플러그인이 설정과 LocalAppData 경로를 확정합니다.
2. 전용 venv Python이 있는지 검사합니다.
3. `spawn(python, ["-X", "utf8", "-m", "vault_search", "serve", ...])`로 실행합니다.
4. `detached: false`, `shell: false`, `windowsHide: true`를 사용합니다.
5. stdout의 JSON event를 파싱합니다.
6. `listening` 이벤트를 받으면 runtime 정보를 기록합니다.
7. `ready` 이벤트를 받으면 UI 상태를 준비 완료로 바꿉니다.
8. 모델 로딩이 오래 걸려도 Obsidian UI를 블로킹하지 않습니다.

### 종료

1. 플러그인이 shutdown 요청을 보냅니다.
2. 최대 3~5초 기다립니다.
3. 종료하지 않으면 `child.kill()`을 호출합니다.
4. Windows에서 자식 트리가 남으면 `taskkill.exe`를 `execFile()`로 호출합니다.
5. runtime 파일을 정리합니다.
6. 종료 후 PID와 포트가 실제로 사라졌는지 검증합니다.

### 비정상 종료 방지

- 플러그인이 spawn한 stdin 파이프를 열어 둡니다.
- Python은 별도 thread에서 stdin EOF를 감시합니다.
- heartbeat를 5초마다 보냅니다.
- 20초 이상 heartbeat가 없거나 stdin EOF이면 Python이 자체 종료합니다.
- 모델 언로드는 Python 객체 삭제에 의존하지 말고 **프로세스 종료**로 보장합니다.

---

## 13. CLI 명세

명령 예시:

```powershell
python -X utf8 -m vault_search.cli search --vault "C:\path\to\vault" --top 20 --json "검색어"
python -X utf8 -m vault_search.cli status --vault "C:\path\to\vault"
```

가능하면 설치 후 짧은 wrapper도 제공합니다.

```powershell
vault-search search --top 20 --json "검색어"
```

### 볼트 탐색 순서

1. `--vault`
2. `OBSIDIAN_VAULT_ROOT` 환경 변수
3. 현재 작업 폴더에서 상위로 올라가며 `.obsidian` 탐색
4. 찾지 못하면 명확한 오류 반환

### 플러그인이 실행 중이지 않을 때

MVP 기본 동작:

- 모델을 자동으로 상주시작하지 않습니다.
- 1초 이내에 `SERVICE_UNAVAILABLE`로 종료합니다.
- 사용자가 Obsidian에서 해당 볼트를 열거나 플러그인을 시작하라는 메시지를 출력합니다.

후속 선택 기능:

- `--bm25-only`: 모델 없이 SQLite FTS 검색
- `--ephemeral`: 사용자가 명시했을 때만 모델을 로드하고 한 번 검색 후 즉시 프로세스 종료

`--ephemeral`은 MVP 필수 기능이 아닙니다. 먼저 플러그인 관리형 lifecycle을 완성합니다.

### JSON 호환성

기존 에이전트가 파싱하기 쉽도록 검색 결과의 핵심 필드는 유지합니다.

```text
rank
file_path
score
content
bm25_rank(optional)
vector_rank(optional)
```

stderr에는 상태 로그, stdout에는 `--json` 결과만 출력합니다.

---

## 14. 전용 Python 환경

이번에 전역 `tokenizers==0.23.1` 때문에 `transformers` import와 데몬 시작이 실패한 전례가 있으므로, 플러그인용 전용 venv를 반드시 사용합니다.

### 개발 환경

저장소 루트 또는 LocalAppData에 전용 venv를 생성합니다.

```powershell
python -X utf8 -m venv .venv
.\.venv\Scripts\python.exe -X utf8 -m pip install -r backend\requirements.txt
```

### 설치 환경

`setup-backend.ps1`이 다음을 수행합니다.

1. 사용 가능한 Python 탐색
2. LocalAppData에 버전별 venv 생성
3. pinned requirements 설치
4. import smoke test
5. 설치 결과를 `machine.json`에 기록

자동 pip 설치는 사용자 동의 없이 플러그인 로드 중 수행하지 않습니다. 설정 화면의 “백엔드 설치/복구” 버튼으로 실행합니다.

### requirements 원칙

- 테스트가 끝난 호환 버전을 명시적으로 pin합니다.
- 최소한 `tokenizers`와 `transformers`의 호환 범위를 고정합니다.
- 현재 확인된 조합은 다음과 같습니다.

```text
tokenizers 0.22.2
transformers 5.6.2
sentence-transformers 5.4.1
```

- Torch는 CPU/CUDA 배포 차이가 있으므로 설치 전략을 별도 함수/스크립트로 분리합니다.
- CUDA 설치를 무조건 강제하지 않습니다.
- 설치 후 다음 import 테스트를 통과해야 합니다.

```text
torch
transformers
tokenizers
sentence_transformers
kiwipiepy
usearch
numpy
```

---

## 15. 구현 단계

각 단계가 끝날 때 테스트하고 별도 Git commit을 만듭니다. 다음 단계로 넘어가기 전에 현재 단계의 완료 조건을 모두 충족해야 합니다.

### Phase 0 — 저장소 초기화

작업:

- Node/TypeScript Obsidian 플러그인 scaffold
- Python package scaffold
- lint/test/build 명령 구성
- `.gitignore` 작성
- README 초안

완료 조건:

- `npm ci`
- `npm run build`
- Python unit test 빈 suite 실행
- 생성된 `main.js`가 Obsidian에서 로드 가능한 형식

권장 commit:

```text
chore: scaffold obsidian plugin and python backend
```

### Phase 1 — Python 검색 코어 분리

작업:

- 기존 `_common.py`, `build_index.py`, `query.py`, `sync.py`의 로직을 모듈로 분리
- chunking, Kiwi tokenization, SQLite FTS, USEARCH, RRF 구현
- 기존 코드를 복붙한 뒤 끝내지 말고 알려진 문제를 수정
- model profile과 index metadata 구현
- 테스트용 fake embedding model 지원

완료 조건:

- 임시 sample vault 전체 인덱스 구축
- BM25 검색 테스트
- fake vector 검색/RRF 테스트
- 모델/차원 불일치 거부 테스트
- 768차원과 1024차원 모두 하드코딩 없이 처리

권장 commit:

```text
feat(backend): extract indexed hybrid search core
```

### Phase 2 — 백엔드 서비스와 lifecycle

작업:

- 동적 포트 JSON-line 서버
- token 인증
- runtime 파일
- status/search/shutdown/heartbeat
- stdin EOF 감시
- graceful shutdown

완료 조건:

- 서버 시작 후 동적 포트 연결
- 잘못된 token 거부
- shutdown 후 프로세스/포트/runtime 파일 제거
- 부모 종료를 모사했을 때 자동 종료
- 모델 로딩 중 status 응답

권장 commit:

```text
feat(backend): add authenticated per-vault search service
```

### Phase 3 — Obsidian 플러그인 프로세스 감독

작업:

- settings load/save
- backend-manager
- layoutReady 비동기 시작
- 상태 표시 및 시작/중지/재시작 명령
- onunload 종료
- 에러 Notice와 로그 링크

완료 조건:

- 볼트 열기 → 모델 로드
- 플러그인 비활성화 → Python 프로세스 종료
- Obsidian UI가 모델 로딩 동안 멈추지 않음
- 설정이 `data.json`에 저장됨
- 이미 실행 중이거나 stale runtime인 상황 처리

권장 commit:

```text
feat(plugin): manage backend lifecycle per vault
```

### Phase 4 — 설정 UI와 인덱스 관리

작업:

- 모델/device/load policy
- include/exclude glob 편집
- 대상 파일 미리보기
- 인덱스 상태
- 증분/벡터/전체 재구축 버튼
- 설정 변경 영향 분류

완료 조건:

- 모델 변경 시 잘못된 기존 벡터를 사용하지 않음
- include/exclude 변경이 예상 파일 수와 일치
- 재구축 중 progress/status 표시
- 실패 시 기존 정상 인덱스 보존

권장 commit:

```text
feat(plugin): add model scope and index settings
```

### Phase 5 — 파일 이벤트 기반 증분 동기화

작업:

- create/modify/delete/rename 이벤트 큐
- debounce와 batch
- startup reconciliation
- 대량 변경 처리

완료 조건:

- 파일 생성 후 검색 결과에 반영
- 수정 후 이전 청크 제거 및 새 청크 반영
- 삭제 후 검색 결과에서 제거
- rename 후 old path 제거/new path 등록
- 이벤트 폭주에서 모델 중복 로드 없음

권장 commit:

```text
feat(index): synchronize vault changes through backend queue
```

### Phase 6 — CLI

작업:

- 볼트 탐색
- runtime 탐색
- status/search JSON 출력
- 빠른 unavailable 처리
- 기존 결과 스키마 호환

완료 조건:

- Obsidian/플러그인 실행 중 CLI 하이브리드 검색 성공
- 워밍 후 검색 목표 0.5초 이하
- 플러그인 종료 후 CLI가 1초 이내 실패하며 모델을 시작하지 않음
- `--json` stdout에 JSON 외 텍스트 없음

권장 commit:

```text
feat(cli): query plugin-managed vault search service
```

### Phase 7 — K_Notes 개발 설치 및 마이그레이션

작업:

- `install-dev.ps1 -Vault <path>` 구현
- 현재 K_Notes 설정을 플러그인 기본 설정으로 가져오기
- 새 LocalAppData 인덱스 전체 구축
- 기존 검색과 결과 비교
- 새 CLI가 안정화되기 전 기존 스크립트 삭제 금지

완료 조건:

- 기존 2,873개 파일 규모가 예상대로 인덱싱됨
- top-20 검색 결과 수동 비교
- 모델 로딩/언로드 메모리 확인
- 플러그인 재로드·Obsidian 재시작 반복 테스트
- rollback 절차 문서화

권장 commit:

```text
chore: add K_Notes migration and development installer
```

### Phase 8 — 문서·CI·GitHub

작업:

- README 완성
- architecture/protocol/settings/development 문서
- Windows CI에서 TypeScript/Python unit test
- release workflow
- GitHub repository 생성·push

완료 조건:

- 새 PC에서 README만 보고 개발 설치 가능
- GitHub Actions 통과
- v0.1.0 태그와 release artifact 생성

권장 commit:

```text
docs: complete setup architecture and release guide
```

---

## 16. 테스트 계획

### Python 단위 테스트

- include/exclude glob
- Windows 경로 정규화
- path traversal 거부
- YAML frontmatter 제거 및 청킹
- 한국어/영문/숫자 tokenization
- RRF 결과
- model prefix 적용
- embedding dimension 검증
- index metadata 불일치
- runtime atomic write/stale 판정
- protocol token/version 검증

### TypeScript 단위 테스트

- 설정 기본값과 migration
- 설정 변경 영향 분류
- backend state machine
- event queue debounce/coalescing
- runtime path/vault ID
- malformed backend stdout 처리

### 통합 테스트

fake embedding 모델을 사용해 인터넷·GPU·대형 모델 없이 CI에서 실행합니다.

1. 임시 볼트 생성
2. backend 시작
3. index 구축
4. CLI 검색
5. 파일 수정 이벤트 반영
6. shutdown
7. 프로세스와 runtime 정리 확인

### Windows 실제 모델 수동 테스트

반드시 다음을 모두 수행합니다.

1. Obsidian에서 K_Notes를 열어 e5-base 로드
2. 캐시 상태 재가동 시간 측정
3. 워밍 검색 10회 p50/p95 측정
4. 플러그인 비활성화 후 Python PID와 모델 RAM/VRAM 해제 확인
5. Obsidian 강제 종료 후 orphan 프로세스가 20초 이내 종료되는지 확인
6. include/exclude 변경 후 대상 파일 검증
7. 모델을 e5-base → BGE-M3 → e5-base로 변경하며 벡터 재구축 검증
8. create/modify/delete/rename 검증
9. Remotely Save 대량 변경 상황 검증
10. CLI JSON을 실제 AI 에이전트에서 파싱
11. 플러그인이 꺼진 상태에서 CLI가 모델을 자동 시작하지 않는지 확인
12. 포트 충돌과 stale runtime 복구 테스트

### 성능 합격 기준

현재 시스템 기준을 회귀 기준으로 사용합니다.

- e5-base 캐시 확보 후 모델 준비: 목표 20초 이내
- 워밍 검색: p95 0.5초 이내(현재 약 0.16초)
- CLI 서비스 부재 판정: 1초 이내
- 종료 후 backend PID: 5초 이내 정상 종료, crash 감지 시 20초 이내
- 종료 후 모델 메모리 잔류 없음
- Obsidian UI thread 장시간 block 없음

---

## 17. Git 및 GitHub 운영 계획

### `.gitignore` 필수 항목

```text
node_modules/
.venv/
__pycache__/
.pytest_cache/
.mypy_cache/
dist/
*.log
runtime.json
machine.json
index/
*.usearch
*.db
.env
```

Git에 넣으면 안 되는 항목:

- Hugging Face 모델 파일
- Torch/venv
- 실제 볼트 내용
- 실제 인덱스
- LocalAppData runtime/token
- Obsidian 개인 설정 `data.json`

### 저장소 생성

로컬 테스트가 통과한 뒤 진행합니다.

```powershell
cd C:\Users\manager\Dev\obsidian-vault-search
git init
git branch -M main
git add .
git commit -m "chore: initial obsidian vault search implementation"
```

GitHub CLI 인증 확인:

```powershell
gh auth status
```

사용자가 public을 명시하지 않았으므로 최초 저장소는 **private**으로 생성하는 것을 기본으로 합니다.

```powershell
gh repo create obsidian-vault-search --private --source . --remote origin --push
```

계정/조직이 여러 개면 임의로 선택하지 말고 사용자에게 확인합니다.

### 버전

Semantic Versioning을 사용합니다.

```text
0.1.0: 개인용 MVP
0.2.0: 증분 동기화·설정 안정화
0.3.0: 설치 자동화·offline BM25
1.0.0: 안정화 및 공개 배포 검토 완료
```

플러그인 `manifest.json`, `versions.json`, Python package version, Git tag를 일치시킵니다.

---

## 18. 기존 K_Notes 시스템 마이그레이션

1. 기존 시스템은 새 플러그인 검증 전까지 그대로 둡니다.
2. 현재 독립 데몬이 실행 중이면 마이그레이션 테스트 전에 `query.py --stop-server`로 종료합니다.
3. 기존 `config.json`을 읽어 새 플러그인 설정 초기값으로 변환할 수 있지만 절대 경로를 저장하지 않습니다.
4. 기존 `chunks.db`와 `vectors.usearch`는 메타데이터와 prefix가 불명확하므로 기본적으로 새 LocalAppData 인덱스를 구축합니다.
5. 기존 인덱스와 새 인덱스의 대표 검색 결과를 비교합니다.
6. 새 CLI가 안정화된 후 기존 `query.py`는 새 CLI로 안내하는 wrapper로 바꿀 수 있습니다.
7. 최소 한 번의 rollback 테스트 전에는 기존 검색 스크립트와 인덱스를 삭제하지 않습니다.
8. 최종 전환 후 K_Notes의 `AGENTS.md`, hybrid-search README, 검색 명령 예시를 새 CLI 기준으로 갱신합니다.
9. 볼트 파일 삭제가 필요하면 K_Notes의 Remotely Save 삭제 규칙을 반드시 따릅니다. 단, 이 프로젝트 구현 단계에서는 기존 볼트 파일을 삭제하지 않는 것이 기본입니다.

---

## 19. MVP에서 하지 않을 일

범위 확장을 막기 위해 다음은 MVP 비목표입니다.

- Obsidian 모바일 지원
- 임베딩을 JavaScript/ONNX로 전면 재작성
- Obsidian Community Plugin Store 공개 등록
- 여러 볼트가 같은 모델 프로세스를 공유하는 전역 브로커
- 클라우드 검색 또는 원격 서버
- PDF/OCR/Office 문서 직접 인덱싱
- 대형 검색 결과 UI 또는 채팅 UI
- 기존 rg/Gemini 검색전략 전체를 플러그인 안에 재구현

MVP는 **모델 lifecycle + 설정 + 인덱싱 + CLI 하이브리드 검색**에 집중합니다.

---

## 20. 구현 모델 작업 수칙

1. 이 문서의 Phase 순서를 지킵니다.
2. 한 번에 전체를 구현하지 말고 각 Phase 테스트 후 commit합니다.
3. 기존 K_Notes 코드는 참고용으로 읽되 직접 수정은 Phase 7까지 하지 않습니다.
4. 새 코드에 K_Notes 절대 경로를 하드코딩하지 않습니다.
5. Windows에서 한글을 처리하는 모든 Python 실행에는 `-X utf8`을 사용합니다.
6. Node child process 실행에 `shell: true`를 사용하지 않습니다.
7. 데몬을 detached로 실행하지 않습니다.
8. 모델/인덱스 설정 불일치 시 조용히 폴백하거나 잘못된 검색을 하지 않습니다.
9. 인덱스 재구축은 임시 파일 + 원자적 교체 방식으로 구현합니다.
10. 테스트에서 실제 대형 모델 다운로드를 요구하지 말고 fake model을 사용합니다.
11. 실제 모델 테스트는 별도의 명시적 수동 테스트로 둡니다.
12. 전역 Python 환경에 패키지를 설치하지 말고 전용 venv를 사용합니다.
13. GitHub 저장소는 로컬 테스트가 통과한 뒤 생성합니다.
14. API 키, 토큰, 실제 runtime 파일, 모델, 인덱스를 commit하지 않습니다.
15. 사용자가 요청하지 않은 기존 파일을 삭제하거나 unrelated 변경을 commit하지 않습니다.

---

## 21. 최종 완료 정의(Definition of Done)

다음이 모두 참일 때 v0.1.0 MVP가 완료된 것입니다.

- [x] K_Notes 볼트를 열면 설정에 따라 Python backend와 모델이 비동기로 로드됩니다.
- [x] 다른 볼트를 열었거나 K_Notes가 닫혀 있으면 K_Notes 모델이 로드되지 않습니다.
- [x] 플러그인을 끄거나 Obsidian을 종료하면 Python 프로세스가 종료되고 모델 메모리가 해제됩니다.
- [x] Obsidian 비정상 종료에도 orphan backend가 자동 종료됩니다.
- [x] 모델·device·include·exclude를 설정 화면에서 변경할 수 있습니다.
- [x] 모델/청킹 설정과 인덱스가 불일치하면 재구축을 요구합니다.
- [x] 파일 생성·수정·삭제·rename이 증분 반영됩니다.
- [x] CLI가 실행 중인 플러그인 백엔드를 통해 JSON 하이브리드 검색을 수행합니다.
- [x] 플러그인이 꺼져 있을 때 CLI가 모델을 자동 상주시작하지 않습니다.
- [x] 검색과 증분 인덱싱에서 모델이 한 프로세스에 한 번만 로드됩니다.
- [x] Windows 한글 경로·내용이 깨지지 않습니다.
- [x] 전용 venv로 전역 Python 패키지 충돌을 차단합니다.
- [x] 단위·통합 테스트와 Windows 실제 모델 smoke test가 통과합니다.
- [x] GitHub private 저장소와 v0.1.0 release가 만들어집니다.
- [x] 기존 검색 시스템으로 되돌리는 rollback 절차가 문서화되어 있습니다.
