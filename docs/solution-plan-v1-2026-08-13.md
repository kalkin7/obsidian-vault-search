# obsidian-vault-search 최종 해결 계획 (검증·완결판) — 2026-08-13

> 작성: 2026-08-13 (plan-sol 검증·정교화 후 완결판)
> 대상 리포지토리: `kalkin7/obsidian-vault-search` (`main@f67ec52`, 코드 변경 없음)
> 조사 기준: 2026-08-13, 백엔드 0.1.3 / 플러그인 0.1.3 / K_Notes 볼트
> 상태: **완결판** — v1 초안의 각 주장을 실제 코드·설정·실측 데이터와 대조해 수정·보완함
> 승인 단위: **P0 → P1-가용성 → P1-검색 품질 → P2**

---

## 1. 요약

### 1.1 문제 진술

현재 K_Notes에서 Vault Search의 구성 요소는 대부분 구현되어 있지만, 다음 세 문제가 겹쳐 “CLI 에이전트가 필요할 때 안정적으로 하이브리드 검색을 사용한다”는 목표를 달성하지 못하고 있습니다.

1. **현 인덱스가 검색 호환성 검사에서 차단됩니다.**
   - 현재 설정은 ONNX/CPU이지만 인덱스는 ONNX 도입 전인 backend `0.1.0`에서 생성되었습니다.
   - `engine`, `provider`, `effective_provider` 메타데이터가 없어 `INDEX_REBUILD_REQUIRED`가 발생합니다.
2. **CLI는 실행 중인 플러그인 sidecar에만 접속합니다.**
   - `cli.py::call_runtime()`은 서비스가 없으면 즉시 종료하며 자동 시작 경로가 없습니다.
   - 서버는 stdin, 부모 PID, heartbeat에 의해 Obsidian 수명에 종속됩니다.
3. **검색 후보 풀이 좁고 에이전트 워크플로우가 이를 보완하지 못했습니다.**
   - broad query에서 `Top 100` 요청에도 57개만 반환되었습니다(고정 상수가 아니라 해당 쿼리의 중복·coalescing 결과).
   - 회의록·QA·status·2차 업체 엔티티가 후보 풀에 진입하지 못했습니다.
   - 대상 에이전트 세션은 Hybrid Search를 호출하지 않았습니다.

### 1.2 확인된 사실 (실측·코드 대조)

| 항목 | 확인 결과 |
|---|---|
| 현재 저장소 | `main@f67ec52`, v1 계획 문서만 untracked, 코드 변경 없음 |
| 플러그인/백엔드 | 소스와 설치된 backend 모두 `0.1.3` |
| 현재 설정 | `engine=onnx`, `provider=auto`, `device=auto`, `loadPolicy=first-search`, 모델 유휴 해제 300초 |
| 서비스 config | 최근 `lazyModel=false` 기록 — `BackendManager.start(false)` 계열 실행 시 기록된 override (저장 설정 아님) |
| 실제 런타임 | `runtime.json`은 시작 시 1회 기록하는 시작 레코드이며 **실시간 상태 파일이 아님**. 최신 backend.log상 서비스는 ready 후 300초에 모델 unload → idle |
| 모델 시작 | ONNX/CPU 최신 로그에서 모델 로드 약 1.3초. 과거 PyTorch의 9~30초와 구분 필요 |
| 인덱스 | 2,868파일 / 8,422청크·벡터, `vectors.usearch` 27,540,112바이트 |
| 차단 원인 | `metadata.json` **그리고 SQLite `index_metadata` 양쪽에** `engine`/`provider`/`effective_provider` 부재 (read-only 재확인 완료). `backend_version=0.1.0` 자체는 검증 대상이 아님 |
| SQLite 재확인 | `chunks.db` URI mode=ro 조회: `user_version=2`, `index_generation=966bfd…` — JSON과 일치. 파일 2,868 / 청크 8,422 / chunks_fts 8,422. → JSON-SQLite 불일치 없음, `rebuild_vectors` 정상 해법 |
| 후보 파이프라인 | body·heading·file·vector 4채널. 각각 최대 30. 이론상 최대 ~120이나 중복·coalescing으로 해당 쿼리 57개 |
| `maxChunksPerFile` | 후보 수집이 아닌 최종 다양성 선택 단계에만 적용 → recall 병목의 1차 원인 아님 |
| lazy load | first-search → `MODEL_LOADING` → 상태 폴링 → 재요청 경로 구현됨. 다만 lifecycle 테스트는 로드 후 **검색 성공 재시도까지 검증하지 않음** |
| 기존 복구 수단 | `rebuild_vectors`는 구조 필드가 맞으면 구 인덱스에서 벡터와 metadata를 다시 생성. 전체 재청킹 불필요 |
| 현 benchmark | 외부 gold set 12건/39 expected path, baseline은 backend 0.1.0, recall@40 0.65. P0 해제 후 새 baseline 필요 |

### 1.3 v1 초안과 다른 검증 결과 (중요)

1. **자동 메타데이터 백필은 채택하지 않습니다.** v1은 누락 키를 현재 ONNX/CPU 값으로 기록하자고 했으나 이는 “인덱스가 해당 엔진으로 생성됐다”는 거짓 기록입니다. Git 이력상 해당 필드는 의도적으로 호환성 게이트로 추가되었고, 임베딩 parity가 높더라도 메타데이터 계약을 우회하지 않습니다. **결정: 현 인덱스는 `rebuild_vectors`로 정상 변환.**
2. **`backend_version=0.1.0`은 차단 원인이 아닙니다.** `validate_metadata()`는 `backend_version`을 비교하지 않습니다.
3. **lazy 경로가 호환성 검사 전에 완전 차단된다는 설명은 부정확합니다.** 실제 결함은 reconcile 결과가 `index_rebuild_reason`에 안정적으로 캐시·status 노출되지 않는 것입니다.
4. **`runtime.json.state=loading_model`은 현 상태 증거가 아닙니다.** 실시간 상태는 backend.log가 근거입니다.
5. **“finalTopK 20이 AGENTS 권장 16~40과 불일치”는 과장입니다.** 20은 범위 안. 실제 문제는 broad 조사에 40개가 필요한데 CLI와 wrapper 기본값이 20이라는 점입니다.
6. **CLI detached 서버만 추가하면 충분하지 않습니다.** `BackendManager.startInternal()`이 기존 runtime을 무조건 종료하고, `onunload()`도 `stop()`을 호출합니다. → plugin attach/detach 정책을 같은 단계에서 구현해야 합니다.
7. **`--keyword` 직접 DB fallback과 `paths` 채널은 이번 핵심 경로에서 제외합니다.**

### 1.4 열린 질문 2건의 최종 결정

| 질문 | 결정 |
|---|---|
| K_Notes canonical 경로 | **경로는 기기별로 다르므로 단일 경로로 고정하지 않습니다.** `search.ps1`이 이미 스크립트 위치에서 볼트 경로를 파생(`$PSScriptRoot/../../..`)하므로, AGENTS.md의 절대경로 참조 2곳(`Vault Reference` :189, `-ProjectRoot` :204)을 **스크립트 상대 경로/볼트 루트 상대 방식으로 교체**합니다. 하드코딩 금지. |
| SQLite `index_metadata` read-only 재확인 | **실행 완료.** JSON·SQLite generation/카운트 일치 확인. P0-0의 “불일치 시 중단” 조건은 트리거되지 않음. |

---

## 2. 즉시 조치 (P0)

## P0-0. 기존 `rebuild_vectors`로 현 검색 차단 해제

- **우선순위:** P0 / **의존성:** 없음 / **작업량:** 30~60분 (대부분 재임베딩 시간)
- **대상:** 운영 데이터 `%LOCALAPPDATA%\ObsidianVaultSearch\vaults\09c7aeeee0f84007647b\index\`, 함수 `src/main.ts::rebuildVectors`·`service.py::call("rebuild_vectors")`·`indexing.py::rebuild_vectors`
- **변경 방식:** 코드 변경 없음(운영 작업). 재구축 전 metadata·count 기록 → 재구축 실행(전체 재구축 아님) → JSON/SQLite 양쪽에 `engine=onnx`, `provider=auto`, `effective_provider=CPUExecutionProvider`, 동일 `index_generation` 기록 확인. 벡터는 실제 재임베딩되므로 hash/mtime 변경 정상, 청크·파일 수는 유지.
- **검증:**
  ```powershell
  & .\9_System\scripts\vault-search\search.ps1 -Status
  & .\9_System\scripts\vault-search\search.ps1 -Top 5 -Json "전기차 충전소 설치"
  ```
  `INDEX_REBUILD_REQUIRED` 소멸, 결과 반환, 2,868파일/8,422청크 유지.

## P0-1. 인덱스 호환성 상태·복구 권고를 일관되게 캐시

- **우선순위:** P0 / **의존성:** P0-0 / **작업량:** 1~1.5일
- **대상:** `index_metadata.py`(`validate_metadata`/`validate_index_files`/신규 `classify_index_problems`), `service.py`(`__init__`/`initialize`/`status`/`call`/`_reconcile`/`_run_index_operation`/신규 `_rebuild_vectors`), `backend/tests/test_metadata.py`, `test_lifecycle.py`, `src/types.ts::BackendStatus`, `settings-tab.ts::display`, `main.ts::completeStartup`, `cli.py::main`
- **변경 방식:**
  1. 호환성 문제를 구조로 관리: `index_validation_state: pending|compatible|incompatible`, `index_rebuild_required: bool`, `index_problems: string[]`, `recommended_action: rebuild_vectors|rebuild_all|null`.
  2. 분류 기준 — `rebuild_vectors`: engine/provider/effective_provider/model_id/dimension/normalize/prefix/벡터 파일 문제. `rebuild_all`: core schema/chunking/tokenizer/scope/SQLite metadata/generation/lexical 문제.
  3. `initialize()`·reconcile 완료 시 캐시. `SearchEngine.search()`의 `IndexCompatibilityError` 발생 시 동일 캐시 갱신.
  4. `rebuild_vectors` 성공 시 캐시 명시적 해제(현재 `rebuild_all`만 해제).
  5. status마다 USEARCH restore 금지 — 검증은 initialization·reconcile·rebuild 경계에서만.
  6. fresh lazy 상태는 `pending`.
  7. `main.ts::completeStartup`은 모든 문제를 “인덱스 없음”으로 표시하지 말고 권고 action 구분.
  8. 설정 화면은 기존 벡터/전체 재구축 버튼 중 권고 버튼 안내(신규 커스텀 버튼 없음).
  9. CLI의 `INDEX_REBUILD_REQUIRED` 출력에 정확한 복구 명령 추가.
- **영향:** status에 optional 필드 추가(protocol 유지). 검색 결과 스키마 불변.
- **검증:** 0.1.0 metadata→`rebuild_vectors`, chunking mismatch→`rebuild_all`, generation mismatch→`rebuild_all`, rebuild 성공 후 compatible, idle이 검증 전 compatible 오판 금지.

## P0-2. lazy 모델 로드 E2E 완성

- **우선순위:** P0 / **의존성:** P0-0, P0-1 / **작업량:** 0.5일
- **대상:** `test_lifecycle.py::test_lazy_model_and_parent_eof`, `test_cli_discovery.py`, `tests/plugin/search-modal.test.ts`
- **변경 방식:** idle 시작 → 첫 검색 `MODEL_LOADING` → ready 대기 → 인덱스 구축 → 동일 검색 재요청 성공 → 모델 유휴 해제 후 재검색 성공 → stdin EOF/runtime 제거 → 비호환 인덱스는 `INDEX_REBUILD_REQUIRED`+status 권고 일치, 까지 검증.

### P0 승인 완료 조건
- 현 K_Notes 검색 차단 해제. 메타데이터 허위 백필 없음. status/설정/CLI가 동일 복구 안내. true lazy 첫 검색·idle 후 재검색 자동 재시도 성공.

---

## 3. 중기 작업 (P1)

### 3.1 가용성: Obsidian 없이 CLI 검색 가능 (standalone sidecar)

| 옵션 | 평가 | 결정 |
|---|---|---|
| A. 플러그인 종속 유지 | 원래 목표 미달성 | 기각 |
| B. CLI가 매 검색마다 foreground 실행 | 콜드 스타트·중복 모델 | 기각 |
| **C. CLI standalone sidecar + 플러그인 attach** | hybrid 전체, 단일 writer | **권장** |
| D. CLI가 SQLite 직접 읽는 lexical fallback | 검색 로직 중복·vector 상실 | P2 이후 재평가 |

- **우선순위:** P1 / **의존성:** P0 / **작업량:** 3~4일
- **대상:** `server.py`(`build_parser`/`run_server`/heartbeat watcher/신규 standalone idle watcher), `cli.py`(`main`/`call_runtime`/신규 `_ensure_search_runtime`·`_spawn_standalone`·`_wait_for_runtime`), `runtime.py`, `backend/tests/test_lifecycle.py`, `test_cli_discovery.py`, `src/backend-manager.ts`(`startInternal`/`stopStaleRuntime`/`stop`/신규 `attachRuntime`/`detach`), `src/main.ts::onunload`, `src/types.ts::RuntimeInfo`, 관련 plugin 테스트, docs
- **변경 방식:**
  1. 서버 인자: `--owner plugin|standalone`, `--idle-exit-seconds 1800`, `--lazy-model`. runtime에 `owner` 기록.
  2. standalone: stdin·parent PID 감시·heartbeat-timeout 종료 미사용. 마지막 활동 후 기본 1,800초 종료. loading·rebuild·sync 중 미종료. 모델은 기존 300초 정책으로 선언로드 해제.
  3. CLI `search`만 자동 시작. `status`는 미시작. runtime 유효 시 attach, 없으면 machine.json·config 검증 후 standalone spawn→runtime 폴링→재요청. 동시 spawn은 `ServiceLock` 승자 attach. `--no-start`로 기존 동작 보존.
  4. Windows spawn은 프로세스 트리 분리 + stdout/stderr를 backend.log로. pipe 방치 금지.
  5. 플러그인은 시작 시 기존 runtime을 무조건 종료하지 않음. 같은 vault/protocol/version의 healthy standalone이면 attach. stale·불일치만 종료.
  6. 소유권 enum `none|child|attached`. plugin child는 onunload 종료, attached standalone은 heartbeat만 중단(daemon 유지), 명시적 중지는 무관하게 종료.
  7. 설정 변경 restart/rebuild 시 attached도 명시 종료 후 새 설정 시작.
- **영향:** backend lifecycle·runtime schema optional 확장. protocol 버전 유지. writer는 ServiceLock으로 1개.
- **검증:** Obsidian 종료 상태에서 CLI 첫 검색 자동 시작. 동시 CLI 2개→backend 1개. Obsidian이 standalone attach·증분 sync. plugin reload가 standalone을 죽이지 않음. explicit stop은 종료. heartbeat 중단 후 모델 300s·프로세스 1,800s 종료. stale 처리. token 평문 로그 금지.
- **리스크:** standalone 장기 생존으로 token 노출 시간 증가 → 시작마다 token 회전. 소유권은 boolean이 아닌 enum.

### 3.2 후보 풀·기본 반환 수 확장

- **우선순위:** P1 / **의존성:** P0 후 새 baseline / **작업량:** 1~1.5일
- **권장안:**
  1. `bm25TopK/vectorTopK` 60/80/100 hot-apply benchmark. gate(기존 recall·MRR 비회귀, 신규 EV expected path +2, forbidden 증가 없음, p95 증가 <25%) 통과 최소값 채택. 초기 권고 80/80이나 benchmark가 최종.
  2. `finalTopK`는 broad workflow에 맞춰 **40**으로. `maxChunksPerFile=1`, `rrfK=60` 유지.
  3. `settingsVersion` migration — version 부재 + 정확히 legacy 기본값(30/30/20)이면 신규값으로 마이그레이션, 사용자 변경 값은 보존.
  4. CLI `--top` 기본 `None`(미지정 시 service `finalTopK`). K_Notes wrapper 기본 40.
- **신규 benchmark 사례:** EV broad(`5_Wiki/status/진행중_업무.md`, 주차면수 QA, 행위신고요청 원본, 2026-07 회의록), 2차 업체(위쥬테크·넥스파·브리츠테크놀로지), 회의록 장문, QA/status 문서군.

### 3.3 쿼리 변형 — 조건부 2단계

- 후보 풀 확장만으로 목표 case 통과 시 구현 안 함. 부족할 때만 설정 gate(false 기본) 아래: 3+ lexical token이면 마지막 token 제거 변형 1개, 원 순위 우선·변형 후보 append, 이중 가중 금지. 동의어 사전은 이번 범위 제외.

### 3.4 에이전트 진입점 정합

- **대상:** K_Notes `AGENTS.md`, `9_System/scripts/vault-search/search.ps1`, `docs/benchmark-guide.md`
- exact literal은 rg 우선 유지. broad/topic/concept/exhaustive는 **Wiki → rg broad → Hybrid Top 40 → 2차 엔티티 → 원문 독해** 필수 체크리스트.
- **경로 처리(결정 반영):** 절대경로(`E:\...`, `C:\...`)로 고정하지 않고 볼트 루트를 스크립트 상대 경로로 파생하는 기존 `search.ps1` 방식을 AGENTS.md에 그대로 안내. `Vault Reference`는 “이 AGENTS.md가 위치한 볼트 루트”로, `-ProjectRoot` 예시는 상대 경로로 교체. 기기별 경로 독립.
- “Obsidian을 열어야 함” 문구를 CLI 자동 시작 설명으로 교체. Hybrid는 rg 대체가 아닌 필수 semantic supplement로 유지.

---

## 4. 정밀도·문서 (P2)

- **P2-1 후보 풀 진단**: `SearchOutcome`(candidate_pool_size/requested_top_k/returned_count). 서비스 응답 optional top-level diagnostics. CLI JSON stdout은 그대로, pool < requested일 때만 stderr 경고.
- **P2-2 잡음 억제**: 볼트 전용 pathBoost/noisePath는 기본 기능 아님. offline benchmark rerank로 lexical coverage·heading/basename exact phrase·channel count 일반 신호만 비교, 효과 있으면 채택.
- **P2-3 3-way 재현 도구·문서**: `scripts/compare-search-coverage.py`(세션 경로 vs 플러그인 결과 vs rg path 교집합·누락·허위). 역사 문서(2026-08-11 2건)에 “당시 기준” 표식. architecture를 plugin-only → plugin-owned|standalone-attached 구조로 갱신.
- **P2-4 릴리스**: `manifest.json`/`package.json`/`versions.json`/`BACKEND_VERSION`/`pyproject.toml`/`__init__.py`를 하나의 `0.1.4`로 정합, backend 포함 zip, BRAT provisioning 검증.

---

## 5. 검증 계획

1. **P0 데이터 안전성**: 재구축 전 metadata·hash·count 기록 → rebuild → generation 일치/새 필드/DB 청크 유지/벡터 hash 변경/검색 정상.
2. **backend**: `python -X utf8 -m pytest backend/tests -q`. 필수 신규 케이스 — legacy metadata→vector rebuild 권고, structural→full rebuild 권고, rebuild 성공 후 status clear, lazy first search→load→retry 성공, standalone idle exit, CLI 동시 spawn/ServiceLock attach, stale runtime, plugin heartbeat 중 standalone 유지.
3. **frontend**: `npm run test`, `npm run build`. 필수 — index 상태/권고 렌더링, legacy 설정 migration, custom 설정 보존, attach 후 unload가 shutdown 안 함, explicit stop은 shutdown, 모달 lazy 재시도.
4. **benchmark**: P0 직후 `scripts/benchmark-search.py` 새 baseline, P1 후 비교. gate — 기존 recall@40/complete recall/MRR@10 감소 없음, forbidden@20/40 증가 없음, p95 <25%, 신규 EV +2, 동일 인덱스에서 결정적.
5. **운영 E2E**: Obsidian 실행 검색 → 완전 종료 → CLI standalone 자동 시작 → 같은 PID 재사용 → Obsidian 재실행 attach → reload 후 PID 유지 → 증분 반영 → 300s/1800s 종료 → runtime 제거 → 새 token/PID 재시작.
6. **정적**: `git diff --check`, `git status --short`.

---

## 6. 구현 순서 체크리스트

## P0 승인 단위
- [x] SQLite `index_metadata` read-only 재확인 (JSON과 일치 확인)
- [ ] 현 DB/벡터/metadata hash·count 기록
- [ ] 기존 `rebuild_vectors`로 K_Notes 차단 해제
- [ ] metadata JSON/SQLite의 engine/provider/effective provider 확인
- [ ] `Top 5` 검색 성공 확인
- [ ] 호환성 문제 분류(`classify_index_problems`)와 status 캐시 구현
- [ ] reconcile/search/rebuild 결과가 동일 캐시 갱신
- [ ] CLI·설정 UI·startup Notice의 복구 안내 일치
- [ ] lazy load E2E를 검색 성공까지 확장
- [ ] backend/frontend 전체 회귀
- [ ] post-P0 benchmark baseline

## P1-가용성 승인 단위
- [ ] standalone owner/runtime 필드
- [ ] heartbeat 대신 30분 process idle-exit
- [ ] CLI search 자동 spawn·poll·attach
- [ ] 동시 spawn을 ServiceLock winner attach로 처리
- [ ] plugin `child/attached/none` ownership
- [ ] plugin reload가 standalone을 종료하지 않음
- [ ] explicit stop·설정 restart는 정상 종료
- [ ] Obsidian 없는 E2E·idle exit 검증

## P1-검색 품질 승인 단위
- [ ] gold set에 회의록·QA·status·2차 업체 사례 추가
- [ ] 60/80/100 후보 한도 비교·gate 통과 최소값 선택
- [ ] `finalTopK=40` 및 설정 version migration
- [ ] CLI/wrapper 기본 top 동작 정합
- [ ] 후보 확장만으로 부족할 때만 queryVariants
- [ ] K_Notes AGENTS/search wrapper를 새 lifecycle·경로 처리에 맞춤

## P2 승인 단위
- [ ] candidate pool diagnostics + CLI 경고
- [ ] coverage/phrase 신호 offline benchmark
- [ ] 3-way coverage 비교 스크립트
- [ ] architecture/settings/protocol/benchmark 문서 갱신
- [ ] 역사 문서 기준일 표시
- [ ] 버전 정합·release zip·BRAT provisioning
- [ ] 최종 전체 회귀·K_Notes 운영 E2E

---

## 7. 리스크·열린 질문 (결정 명시)

| 항목 | 결정 / 필요 정보 |
|---|---|
| 구 인덱스 metadata 백필 | **기각.** `rebuild_vectors`로 실제 ONNX 세대 생성 |
| 전체 재구축 여부 | vector-compatible mismatch이므로 **벡터 재구축**. 구조 문제 추가 발견 시만 전체 |
| SQLite metadata 재확인 | **완료.** 불일치 없음 → P0-0 진행 |
| lazy 로드 | 구현 유지. 테스트만 성공 재시도까지 보강 |
| standalone idle 정책 | **모델 300s + 프로세스 1,800s.** env override 허용 |
| plugin reload와 standalone | 문서 우회가 아니라 **P1 가용성 범위에 포함** |
| 이중 모델 | ServiceLock으로 1개, plugin은 기존 standalone attach |
| 후보 기본값 | 80 즉시 확정 안 함. **60/80/100 gate 통과 최소값** |
| 기존 볼트 전파 | `settingsVersion` migration, legacy 기본값만 변경, custom 보존 |
| finalTopK | broad workflow 기본 40. 사용자 저장 custom 보존 |
| `maxChunksPerFile` | 1 유지. 풀 병목 해결책 아님 |
| query variants | 후보 확장 후 미달 시에만, 기본 off |
| 사용자 동의어 | 이번 범위 제외. AGENTS rg 변형 유지 |
| protocol `paths` 채널 | 보류. standalone+pool 후 잔여 recall 재측정 후 별도 RFC |
| `--keyword` direct fallback | 보류. rg가 degraded lexical 역할 |
| path boost/noise glob | 볼트 특화라 기본 기능 미채택 |
| 보안 | loopback+token 유지, standalone 시작마다 token 회전. runtime ACL 강화는 별도 작업 후보 |
| baseline 신뢰성 | 기존 baseline은 0.1.0 기반이므로 P0 후 새 baseline 필수 |
| K_Notes 경로 | **기기별 경로 유지·하드코딩 금지.** AGENTS.md를 스크립트 상대 경로 방식으로 교체 |
| 릴리스 | 구현 완료 후 backend 포함 `0.1.4` zip/BRAT. 실제 게시는 사용자 승인 필요 |

### 총 예상 작업량
- **P0:** 2~2.5일 / **P1 가용성:** 3~4일 / **P1 검색 품질:** 2~3일 / **P2:** 2~3일 / **총계:** 약 9~12.5일
- 승인 순서: **P0 차단 해제·상태 정합 → P1 standalone 가용성 → P1 후보 풀 검증 → P2 정밀도·문서·릴리스**
