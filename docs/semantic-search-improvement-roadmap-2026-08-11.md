# 시맨틱 검색 경쟁 분석 기반 상세 개선 계획 — 2026-08-11

> 이 문서는 구현 경험이 적거나 추론 능력이 낮은 모델도 추가 설계 판단 없이 순서대로 작업할 수 있도록 작성한 실행 계획서다.
>
> 한 번에 여러 단계를 구현하지 않는다. 각 단계는 해당 단계의 테스트와 품질 게이트를 모두 통과한 뒤 별도 커밋으로 종료한다.

## 1. 문서 목적

현재 `obsidian-vault-search`는 다음 기능을 이미 제공한다.

- Obsidian이 감독하는 볼트별 Python sidecar
- Kiwi 형태소 분석 기반 SQLite FTS5 검색
- Sentence Transformers 임베딩과 USEARCH 벡터 검색
- BM25/벡터 RRF 융합
- 파일 생성·수정·이름 변경·삭제 증분 동기화
- 동적 loopback 포트와 실행별 인증 토큰
- Obsidian과 CLI가 같은 프로세스·모델·인덱스를 공유하는 구조
- LocalAppData에 저장되는 볼트 외부 인덱스
- Windows UTF-8, 부모 프로세스 감시, stdin EOF, heartbeat 종료 보호

이 계획의 목적은 이 장점을 유지하면서 다음 프로젝트에서 검증된 아이디어를 선택적으로 도입하는 것이다.

- `conoro/obsidian-zvec-hybrid-search`
- `ryan-manor/Obsidian-Seek`
- `ashwin271/obsidian-vector-search`
- `achekulaev/obsidian-qmd`
- `vlwkaos/ir`
- `jylkim/kqmd`

전체 엔진을 바로 교체하지 않는다. 현재 구조보다 명확히 우수하다고 동일한 K_Notes 평가셋에서 입증된 기능만 작은 단위로 이식한다.

## 2. 최종 결론과 구현 우선순위

### 2.1 유지할 핵심 구조

다음 항목은 변경 금지에 가깝게 취급한다.

1. Obsidian 플러그인이 sidecar 생명주기를 소유한다.
2. CLI가 별도 모델이나 고아 daemon을 시작하지 않는다.
3. 검색과 증분 임베딩이 한 모델 인스턴스를 공유한다.
4. 원문, 쿼리, 임베딩을 외부 서비스로 전송하지 않는다.
5. 인덱스와 runtime 파일은 볼트 밖 LocalAppData에 둔다.
6. 동적 포트와 인증 토큰을 유지한다.
7. Kiwi 한국어 형태소 분석을 lexical 검색의 기본으로 유지한다.
8. include/exclude 범위를 명시적으로 유지한다.
9. 모델·차원·prefix·정규화·청킹·토크나이저 호환성을 검색 전에 검사한다.
10. Windows 한글 경로와 자식 프로세스 트리 종료를 계속 지원한다.

### 2.2 구현 순서

아래 순서를 바꾸지 않는다.

1. 단계 0: 재현 가능한 품질·성능 평가 하네스
2. 단계 1: 제목 검색을 독립 후보 채널로 승격
3. 단계 2: 검색 모드와 verbose explain 확장
4. 단계 3: Markdown 구조 인식 청킹
5. 단계 4: 별칭·태그·속성·헤딩 다중 필드 검색
6. 단계 5: reconcile 및 원자 교체 신뢰성 강화
7. 단계 6: 제한적 adaptive rescue 실험
8. 단계 7: Obsidian 검색 UI
9. 선택 단계: `ir` 백엔드 교체 타당성 실험

단계 0과 단계 1을 최우선으로 한다. 현재 가장 명확한 recall 결함은 `file_titles`가 독립 후보를 만들지 못한다는 점이다.

## 3. 현재 기준선

### 3.1 현재 주요 파일과 심볼

| 영역 | 파일 | 핵심 심볼 |
|---|---|---|
| 검색 | `backend/vault_search/search.py` | `SearchEngine.search`, `rrf_fusion`, `select_diverse`, `_bm25`, `_title_ranks` |
| DB | `backend/vault_search/database.py` | `init_db`, `insert_chunk`, `upsert_file_title`, `delete_files` |
| 청킹 | `backend/vault_search/chunking.py` | `extract_content`, `chunk_text` |
| 인덱싱 | `backend/vault_search/indexing.py` | `IndexManager.rebuild_all`, `reconcile`, `_apply_changes`, `_atomic_replace` |
| 메타데이터 | `backend/vault_search/index_metadata.py` | `SCHEMA_VERSION`, `expected_metadata`, `validate_index_files` |
| 모델 | `backend/vault_search/model_manager.py` | `ModelManager` |
| 서비스 | `backend/vault_search/service.py` | `SearchService.call` |
| 프로토콜 | `backend/vault_search/protocol.py` | `PROTOCOL_VERSION`, `request` |
| CLI | `backend/vault_search/cli.py` | `make_parser`, `call_runtime`, `main` |
| 플러그인 설정 | `src/types.ts`, `src/settings.ts` | `VaultSearchSettings`, `settingsImpact`, `hotConfig` |
| 설정 UI | `src/settings-tab.ts` | `VaultSearchSettingTab` |

### 3.2 현재 검색 흐름

```text
query
  -> Kiwi tokenize
  -> chunks_fts BM25 top-N
  -> query embedding
  -> USEARCH vector top-N
  -> 두 순위의 RRF
  -> 이미 후보가 된 청크에만 file_titles 순위 보너스
  -> 파일당 최대 청크 수 제한
  -> final top-N
```

### 3.3 현재 확인된 결함

1. 제목 검색 결과가 BM25/벡터 후보에 없는 파일을 새 후보로 추가하지 못한다.
2. 청킹이 헤딩 계층, 코드 펜스, 표, 목록, 콜아웃을 이해하지 못한다.
3. 10자 미만 문단은 검색 대상에서 완전히 사라질 수 있다.
4. frontmatter 별칭·태그·속성은 본문 lexical 및 dense 채널에 포함되지 않는다.
5. 제목 FTS는 H1~H3 전체를 파일 단위로 합쳐 저장하므로 어느 청크의 헤딩이 일치했는지 알 수 없다.
6. BM25는 OR 검색만 제공한다.
7. 접두사 검색은 정확 결과가 0건일 때 모든 토큰에만 적용된다.
8. RRF 점수만 반환하므로 채널별 판단 근거를 충분히 설명하지 못한다.
9. `reconcile()`은 시작할 때 모든 파일 본문을 읽고 SHA-256을 계산한다.
10. `_atomic_replace()`가 설치 직후 backup을 삭제하므로 최종 검증 실패 시 자동 복원이 불완전하다.
11. 품질 회귀를 자동 차단하는 고정 gold set과 지표가 저장소에 없다.

## 4. 외부 프로젝트에서 가져올 것과 가져오지 않을 것

### 4.1 ZVec Hybrid Search에서 가져올 것

- 본문, 제목, 벡터를 각각 독립 후보 채널로 검색한 뒤 합집합한다.
- `all`, `any`, `phrase` 키워드 검색을 제공한다.
- `mtime + size`로 변경 후보를 먼저 좁힌다.
- 중단된 증분 작업을 복구할 수 있도록 pending 경로를 기록한다.
- 날짜 필터, 정렬, 결과 grouping을 지원한다.

가져오지 않을 것:

- 기본 `all-MiniLM-L6-v2` 모델
- Kiwi 없는 lexical 검색
- 별도 CLI가 없는 폐쇄형 검색 경로

### 4.2 Seek에서 가져올 것

- fence-aware heading 계층 청킹
- 코드 블록, 표, 콜아웃을 가능한 한 원자 단위로 유지하는 분할
- 제목·별칭·태그·본문·속성·헤딩별 검색 필드
- analyzer/chunker 버전을 인덱스 fingerprint에 포함
- 마지막 쿼리 토큰에만 제한적으로 적용하는 prefix 검색
- 채널 점수의 고정 범위 정규화 실험
- 실제 실패 쿼리를 고정 회귀 케이스로 축적하는 방식

가져오지 않을 것:

- 인덱스를 볼트와 함께 동기화하는 sidecar
- Obsidian renderer 안에서 큰 모델을 직접 유지하는 구조
- 공개 평가 자료 없이 개인 평가 수치만 근거로 한 상수

### 4.3 Obsidian Vector Search에서 가져올 것

- 선택 텍스트를 바로 유사 검색 쿼리로 사용하는 UX만 참고한다.

가져오지 않을 것:

- Ollama 필수 의존성
- JSON 벡터 저장
- 전체 벡터 JavaScript 순회
- 순수 벡터 검색으로의 회귀

### 4.4 Obsidian QMD에서 가져올 것

- 검색 modal/sidebar의 사용자 흐름
- 검색 중 이전 요청 취소
- semantic 실패 시 명확한 오류와 fallback 상태 표시

가져오지 않을 것:

- 셸 문자열을 조립해 `exec()`로 실행하는 방식
- 검색마다 외부 CLI 프로세스를 시작하는 구조
- semantic 우선 후 실패할 때만 BM25를 사용하는 비하이브리드 경로

### 4.5 ir에서 가져올 것

- 충분한 후보 over-fetch
- 강한 신호일 때 비싼 단계를 건너뛰는 tiered retrieval
- content hash 기반 임베딩 재사용 아이디어
- 공개 데이터셋과 재현 가능한 하네스
- rerank window와 미평가 tail을 잘못 비교하지 않는 keep-window 원칙

가져오지 않을 것:

- 자동으로 상주 daemon을 만드는 기본 동작
- 검증 없이 reranker를 기본 활성화하는 것
- 인증 없는 전체 인터페이스 HTTP 서버

### 4.6 K-QMD에서 가져올 것

- 한국어 lexical 후보를 제한적으로 rescue하는 구조
- query class에 따라 rescue를 켜거나 끄는 보수적 정책
- phrase, title, heading, coverage, proximity 신호
- `--explain`으로 후보 추가 이유를 보여주는 방식

가져오지 않을 것:

- 이미 Kiwi가 주 인덱스인 현재 구조에 별도 Kiwi shadow index를 중복 생성하는 것
- 소규모 synthetic benchmark의 100% 수치를 일반 품질 보장으로 해석하는 것

## 5. 구현 공통 규칙

모든 단계에서 아래 규칙을 지킨다.

1. `main.js`를 직접 수정하지 않는다. TypeScript 수정 후 `npm run build`로 생성한다.
2. 설정을 추가하면 `src/types.ts`, `src/constants.ts`, `src/settings.ts`, `src/settings-tab.ts`, `backend/vault_search/config.py`, 관련 문서를 함께 수정한다.
3. hot setting이면 `hotConfig()`와 백엔드 `apply_search_config` 경로를 함께 수정한다.
4. 청킹 또는 DB 필드가 바뀌면 `SCHEMA_VERSION` 또는 별도 version fingerprint를 반드시 올린다.
5. 임베딩 입력 bytes가 바뀌면 전체 벡터 재구축이 필요하다.
6. lexical 필드만 바뀌고 임베딩 입력이 같으면 무재임베딩 migration을 우선 검토한다.
7. public search 결과의 기존 필드 `rank`, `file_path`, `score`, `content`는 유지한다.
8. 새 protocol parameter는 optional로 추가한다. 기존 CLI 호출은 같은 기본 동작을 유지한다.
9. 실패 시 기존 정상 인덱스를 삭제하거나 덮어쓰지 않는다.
10. 한 단계의 구현과 다음 단계의 구현을 같은 커밋에 섞지 않는다.

### 단계별 공통 검증 명령

```powershell
npm run build
npm test
python -X utf8 -m pytest backend/tests
git diff --check
```

인덱싱 구조를 바꾸는 단계에서는 추가로 실제 K_Notes smoke test를 수행한다.

```powershell
vault-search --vault "<K_Notes>" status
vault-search --vault "<K_Notes>" search --top 20 --verbose --json "층간소음"
vault-search --vault "<K_Notes>" search --top 20 --verbose --json "전기차 충전기 설치 경과"
```

## 6. 단계 0 — 품질·성능 평가 하네스

### 6.1 목표

후속 변경이 실제로 좋아졌는지 같은 조건에서 측정한다. 이 단계가 없으면 랭킹 상수나 청킹 변경을 merge하지 않는다.

### 6.2 추가 파일

```text
benchmarks/
  relevance-cases.schema.json
  relevance-cases.example.json
scripts/
  benchmark-search.py
backend/tests/
  test_benchmark_schema.py
docs/
  benchmark-guide.md
```

실제 개인 볼트의 gold set에 민감한 경로나 문구가 있으면 저장소에 넣지 않고 외부 JSON 경로를 인수로 받는다.

### 6.3 입력 JSON 형식

```json
{
  "schema_version": 1,
  "vault": "K_Notes",
  "cases": [
    {
      "id": "ev-charger-timeline",
      "query": "전기차 충전기 설치 경과",
      "intent": "timeline",
      "expected_paths": [
        "5_Wiki/issues/apt/전기차_충전시설_설치_및_관리.md"
      ],
      "acceptable_paths": [],
      "forbidden_paths": [],
      "top_k": 40
    }
  ]
}
```

필드 규칙:

- `id`: 파일 안에서 유일한 ASCII kebab-case 문자열
- `query`: 실제 검색 문자열
- `intent`: `exact`, `known-item`, `topic`, `timeline`, `value`, `korean-morphology` 중 하나
- `expected_paths`: 반드시 찾아야 하는 경로
- `acceptable_paths`: 관련 있지만 필수는 아닌 경로
- `forbidden_paths`: 상위 결과에 나오면 명백한 회귀인 경로
- `top_k`: 기본 40, 최소 1, 최대 200

### 6.4 하네스 동작

`scripts/benchmark-search.py`는 다음을 수행한다.

1. `--vault`, `--cases`, `--output` 인수를 받는다.
2. 실행 중인 sidecar에 protocol `search` 요청을 보낸다.
3. 각 쿼리를 warm-up 1회 후 측정 5회 실행한다.
4. 품질 계산에는 첫 번째 측정 결과를 사용한다.
5. 지연시간은 5회의 median을 case latency로 사용한다.
6. 결과를 JSON으로 저장한다.
7. 이전 결과를 `--baseline`으로 받으면 지표 차이를 출력한다.

### 6.5 필수 지표

- file recall@20
- file recall@40
- success rate: expected path를 하나 이상 찾은 case 비율
- complete recall: expected path를 모두 찾은 case 비율
- MRR@10: 첫 expected path 기준
- unique path count@20
- forbidden path count@20
- latency p50/p95
- 쿼리별 BM25/vector/title 후보 포함 여부

### 6.6 실패 코드

- `0`: 실행 성공, gate 통과
- `1`: 실행 성공, 품질 gate 실패
- `2`: 입력 schema 오류
- `3`: sidecar unavailable
- `4`: 검색 요청 실패

### 6.7 기본 품질 gate

첫 baseline 확정 후 다음 조건을 CI 또는 로컬 release gate로 사용한다.

- recall@40은 baseline보다 낮아지면 안 된다.
- complete recall은 한 case라도 감소하면 안 된다.
- forbidden path count는 증가하면 안 된다.
- latency p95가 25% 이상 증가하면 명시적 승인 없이는 실패다.
- 새 기능 목표 case는 문서에 정한 최소 개선폭을 만족해야 한다.

### 6.8 단위 테스트

1. 잘못된 schema version 거부
2. 중복 case ID 거부
3. 빈 expected/acceptable/forbidden을 허용하되 모두 비어 있으면 거부
4. Windows `\` 경로를 `/`로 정규화
5. recall@K 계산
6. MRR 계산
7. forbidden path 계산
8. baseline 비교 exit code

### 6.9 완료 조건

- 같은 인덱스에서 두 번 실행했을 때 품질 지표가 동일하다.
- latency를 제외한 결과 JSON이 deterministic하다.
- 최소 12개 K_Notes case와 39개 expected path를 외부 gold set으로 재현한다.
- baseline JSON의 git commit hash와 backend version을 기록한다.

### 6.10 권장 커밋

```text
test: add reproducible search quality benchmark
```

## 7. 단계 1 — 제목을 독립 후보 채널로 승격

### 7.1 문제

현재 `SearchEngine.search()`는 body BM25와 vector 후보를 먼저 합친 뒤 해당 후보에만 제목 점수를 더한다. 파일명이 완전히 일치해도 body/vector top-N에 없으면 결과에 들어갈 수 없다.

### 7.2 목표 검색 흐름

```text
body BM25 chunk IDs
title FTS file paths -> representative chunk IDs
vector chunk IDs
  -> 세 채널 weighted RRF 합집합
  -> 결과 다양성 제한
```

### 7.3 수정 파일

- `backend/vault_search/search.py`
- `backend/tests/test_search.py`
- `backend/vault_search/config.py`
- `src/types.ts`
- `src/settings.ts`
- `src/settings-tab.ts`
- `src/constants.ts`
- `docs/settings.md`
- `docs/architecture.md`

### 7.4 `rrf_fusion` 변경

현재 두 list 전용 함수를 다음 개념으로 일반화한다.

```python
def weighted_rrf(
    channels: list[tuple[str, list[int], float]],
    k: int,
) -> tuple[list[tuple[int, float]], dict[int, set[str]]]:
    ...
```

동작 규칙:

1. 각 channel은 `(name, ranked_ids, weight)`다.
2. 같은 채널 안의 중복 ID는 첫 번째 순위만 사용한다.
3. 기여도는 `weight / (k + rank)`이며 rank는 1부터 시작한다.
4. 최종 정렬은 score 내림차순, 동점이면 chunk ID 오름차순이다.
5. verbose explain을 위해 각 chunk가 어느 채널에서 왔는지 기록한다.

### 7.5 제목 file path를 chunk ID로 변환

새 private helper를 추가한다.

```python
def _title_candidate_ids(
    connection: sqlite3.Connection,
    title_rows: list[tuple[str, float]],
    body_ids: list[int],
) -> list[int]:
    ...
```

정확한 선택 규칙:

1. title row 순서를 유지한다.
2. 같은 파일에 body BM25 후보가 있으면 그 파일에서 body 순위가 가장 높은 chunk ID를 사용한다.
3. body 후보가 없으면 `chunks.chunk_index`가 가장 작은 chunk를 사용한다.
4. 청크가 0개인 파일은 이 단계에서는 건너뛴다. 단계 3에서 title-only chunk로 해결한다.
5. 동일 chunk ID를 두 번 반환하지 않는다.

SQL은 title path 수만큼 반복 호출하지 말고 한 번의 `IN (...)` 쿼리로 가져온다.

```sql
SELECT id, file_path, chunk_index
FROM chunks
WHERE file_path IN (?, ...)
ORDER BY file_path, chunk_index
```

### 7.6 설정

기존 `titleRrfWeight`를 그대로 독립 채널 weight로 사용한다. 설정 이름을 다시 바꾸지 않는다.

- `0`: 제목 채널 비활성
- `1.0`: body/vector와 같은 기본 RRF 기여도
- hot apply 가능

기존의 제목 additive boost 코드는 제거한다. 독립 채널과 additive boost를 동시에 적용하면 제목 점수가 두 번 반영된다.

### 7.7 verbose 결과

기존 필드를 유지하고 다음 필드를 추가한다.

```json
{
  "channels": ["title"],
  "bm25_rank": -1,
  "vector_rank": -1,
  "title_rank": 1
}
```

### 7.8 필수 테스트

1. body/vector 후보가 아닌 파일도 제목 1위면 최종 후보에 들어간다.
2. title weight 0이면 현재 body/vector 결과와 같아진다.
3. 제목과 body에 모두 잡힌 파일은 대표 chunk가 중복되지 않는다.
4. 동일 점수 tie-break가 deterministic하다.
5. 파일당 최대 청크 제한이 그대로 적용된다.
6. 제목만 있고 청크가 없는 파일에서 예외가 나지 않는다.
7. 기존 `rank`, `file_path`, `score`, `content` 결과 필드가 유지된다.

### 7.9 품질 gate

- known-item case의 MRR@10이 감소하면 실패한다.
- recall@40이 감소하면 실패한다.
- 현재 title target case가 최소 한 단계 이상 상승하거나 새로 발견되어야 한다.
- p95 증가가 10% 이하여야 한다.

### 7.10 권장 커밋

```text
feat: promote title search to a retrieval channel
```

## 8. 단계 2 — 검색 모드와 explain 확장

### 8.1 목표

정확 키워드, 모든 단어, 일부 단어, 구문 검색을 선택할 수 있게 하고 결과의 후보 출처를 설명한다.

수정 파일:

- `backend/vault_search/search.py`
- `backend/vault_search/service.py`
- `backend/vault_search/cli.py`
- `backend/tests/test_search.py`
- `backend/tests/test_lifecycle.py`
- `docs/protocol.md`
- `docs/development.md`

### 8.2 public parameter

protocol version은 올리지 않고 search params에 optional 필드를 추가한다.

```json
{
  "query": "전기차 충전시설",
  "top_k": 20,
  "verbose": true,
  "match_mode": "any"
}
```

허용값:

- `any`: Kiwi 토큰을 OR 결합. 기존 기본값이다.
- `all`: Kiwi 토큰을 AND 결합한다.
- `phrase`: Kiwi 토큰 순서가 인접하게 나타나는 FTS phrase를 사용한다.

누락 시 `any`로 처리해 기존 CLI와 호환한다.

### 8.3 FTS expression 생성

`_fts_expression()`의 인자를 다음과 같이 바꾼다.

```python
def _fts_expression(
    tokens: list[str],
    match_mode: str,
    prefix_last: bool = False,
) -> str:
    ...
```

규칙:

- `any`: `"token1" OR "token2"`
- `all`: `"token1" AND "token2"`
- `phrase`: `"token1 token2"`
- prefix fallback은 `any`와 `all`에서 마지막 토큰에만 `*`를 붙인다.
- phrase에는 prefix fallback을 적용하지 않는다.
- 빈 토큰은 빈 문자열을 반환한다.
- 따옴표는 기존 방식대로 두 번 써서 escape한다.

현재처럼 정확 결과가 0건일 때만 prefix fallback을 실행한다.

### 8.4 CLI

`backend/vault_search/cli.py`에 추가한다.

```text
vault-search search --match any|all|phrase
```

기본값은 `any`다.

### 8.5 explain schema

`--verbose --json`일 때만 다음을 추가한다.

```json
{
  "query_tokens": ["전기차", "충전", "시설"],
  "match_mode": "all",
  "channels": ["body", "title", "vector"],
  "bm25_rank": 2,
  "title_rank": 1,
  "vector_rank": 8,
  "rrf_contributions": {
    "body": 0.016129,
    "title": 0.016393,
    "vector": 0.014706
  }
}
```

각 결과에 query tokens를 중복 저장하면 응답이 커진다. 구현 시 service response에 top-level `query` metadata를 둘 수 있지만 기존 CLI가 `data.results`만 출력한다. 이 단계에서는 호환성을 위해 결과별 필드로 시작하고, protocol v2 전까지 top-level schema를 바꾸지 않는다.

### 8.6 필수 테스트

1. any는 한 토큰만 일치해도 검색된다.
2. all은 모든 토큰이 있어야 검색된다.
3. phrase는 순서와 인접성이 맞아야 검색된다.
4. 마지막 토큰만 prefix 처리된다.
5. phrase에서 prefix fallback이 실행되지 않는다.
6. 잘못된 match mode는 `INVALID_PARAMS`가 된다.
7. CLI가 `--match`를 protocol params로 전달한다.
8. verbose false일 때 explain 필드를 반환하지 않는다.

### 8.7 품질 gate

- 기본 `any` 결과는 단계 1 baseline과 동일해야 한다.
- exact/known-item case에서 `all` 또는 `phrase`의 MRR이 `any`보다 나빠도 기본값에는 영향이 없어야 한다.
- phrase와 all의 latency p95가 any의 125% 이하여야 한다.

### 8.8 권장 커밋

```text
feat: add lexical match modes and search explanations
```

## 9. 단계 3 — Markdown 구조 인식 청킹

### 9.1 목표

헤딩 문맥을 각 청크에 포함하고 코드·표·목록을 무작위 문자 위치에서 자르지 않는다. 짧은 문단도 사라지지 않게 한다.

### 9.2 전략 분리

청킹을 한 번에 완전히 교체하지 않는다.

- `paragraph-v1`: 현재 `chunk_text()` 동작
- `markdown-v2`: 새 구조 인식 청킹

새 setting:

```text
chunkingStrategy: "paragraph-v1" | "markdown-v2"
```

첫 구현에서는 기본값을 `paragraph-v1`로 둔다. 실제 benchmark를 통과하고 release 시점에만 기본 변경을 별도 결정한다.

### 9.3 새 데이터 구조

`backend/vault_search/chunking.py`에 dataclass를 추가한다.

```python
@dataclass(frozen=True, slots=True)
class DocumentChunk:
    content: str
    embedding_text: str
    heading_path: tuple[str, ...]
    start_line: int
    end_line: int
```

규칙:

- `content`: 사용자에게 보여줄 원문에 가까운 청크
- `embedding_text`: `파일 제목 > H1 > H2\n\ncontent` 형식
- `heading_path`: 현재 섹션의 H1~H6 계층
- `start_line`, `end_line`: frontmatter를 포함한 원본 파일 기준 1-based line

### 9.4 parser 규칙

외부 Markdown AST 라이브러리를 바로 추가하지 않는다. 다음 범위의 작은 state machine을 구현한다.

1. UTF-8 BOM을 제거하되 line offset은 보존한다.
2. 시작 위치의 YAML frontmatter 블록을 감지한다.
3. backtick 또는 tilde 3개 이상의 fenced code 상태를 추적한다.
4. fence 안의 `#`는 heading으로 취급하지 않는다.
5. fence 밖의 `#{1,6} `를 heading으로 취급한다.
6. heading level이 같거나 높아지면 stack을 pop하고 새 heading을 push한다.
7. 연속된 table 행은 하나의 atom으로 취급한다.
8. 연속된 list 항목은 가능한 한 하나의 atom으로 취급한다.
9. callout 시작 `> [!TYPE]`와 이어지는 quote 행은 하나의 atom으로 취급한다.
10. 일반 문단은 빈 줄 경계 atom이다.

### 9.5 짧은 atom 처리

현재 10자 미만 문단 삭제를 제거한다.

새 규칙:

1. 빈 문자열만 버린다.
2. 작은 atom은 다음 정상 atom 앞에 carry한다.
3. 문서 끝의 작은 atom은 이전 청크 뒤에 붙인다.
4. 문서 전체가 짧으면 하나의 실제 content chunk를 만든다.
5. 빈 문서도 파일명으로 검색 가능하도록 lexical-only title chunk를 하나 만든다.

### 9.6 크기 제한

첫 `markdown-v2` 구현은 기존 `chunkChars`와 `chunkOverlap` 설정을 사용하되 atom 경계에서만 자른다.

1. atom 추가 시 `chunkChars`를 넘으면 현재 buffer를 emit한다.
2. atom 하나가 `chunkChars`보다 길면 내부에서 line 경계를 우선 사용한다.
3. line도 너무 길면 마지막 수단으로 Unicode 문자 경계에서 자른다.
4. 코드 fence와 표는 `2 * chunkChars`까지는 하나로 유지한다.
5. 그보다 크면 line 경계에서 나누고 각 조각에 fence/표 문맥을 보존한다.
6. overlap은 이전 청크의 마지막 완전 atom만 사용한다.
7. overlap atom이 `chunkOverlap`보다 크면 overlap하지 않는다.

실제 tokenizer 기반 512-token 분할은 `markdown-v3` 후보로 남긴다. 현재 설정과 임베딩 모델별 tokenizer 차이를 동시에 바꾸지 않는다.

### 9.7 DB schema

`chunks`에 다음 필드가 필요하다.

```sql
heading_path  TEXT NOT NULL
start_line    INTEGER NOT NULL
end_line      INTEGER NOT NULL
embedding_text TEXT NOT NULL
lexical_only  INTEGER NOT NULL DEFAULT 0
```

새 DB를 구축할 때만 이 schema를 사용한다. 기존 DB에 `ALTER TABLE`을 연속 적용하지 않는다.

`backend/vault_search/index_metadata.py`:

- `SCHEMA_VERSION`을 2로 올린다.
- metadata에 `chunking_strategy`와 `chunker_version`을 추가한다.
- `chunker_version`은 `paragraph-v1`이면 1, `markdown-v2`면 2다.

### 9.8 임베딩 입력

`IndexManager.rebuild_all()`과 `_apply_changes()`에서 다음을 구분한다.

- SQLite `chunks.content`: `DocumentChunk.content`
- FTS tokens: `content`와 heading path를 단계 4 전까지는 기존 body 방식으로 유지
- 모델 encode 입력: `DocumentChunk.embedding_text`

`rebuild_vectors()`도 `content`가 아니라 `embedding_text`를 읽어야 한다.

### 9.9 설정 영향

- `chunkingStrategy` 변경은 `SettingsImpact = "all"`
- `chunkChars`, `chunkOverlap`도 계속 `all`
- UI에는 변경 시 전체 재구축 필요 문구를 표시한다.

### 9.10 필수 fixture

```text
backend/tests/fixtures/chunking/
  headings.md
  fenced-heading.md
  table.md
  callout.md
  short-sections.md
  long-line.md
  bom-frontmatter.md
  empty.md
```

### 9.11 필수 테스트

1. H1→H2→H3 breadcrumb 생성
2. 같은 level heading에서 stack 교체
3. code fence 안의 heading 무시
4. table이 임의 문자에서 잘리지 않음
5. callout이 가능한 한 한 atom 유지
6. 10자 미만 중요 문단 보존
7. 빈 문서 title-only chunk 생성
8. BOM + frontmatter line offset 정확성
9. start/end line이 원본 파일과 일치
10. incremental과 full rebuild가 같은 chunk bytes와 순서를 생성
11. `rebuild_vectors()`가 `embedding_text`를 사용
12. schema mismatch가 전체 재구축 필요 오류를 반환

### 9.12 품질 gate

- recall@40이 감소하면 실패한다.
- 긴 문서·헤딩 관련 case의 complete recall이 증가해야 한다.
- 전체 청크 수가 baseline의 0.7배 미만 또는 1.8배 초과면 원인 분석 전 실패다.
- 인덱스 크기가 2배를 넘으면 실패다.
- full rebuild 후 벡터 수와 DB chunk 수가 정확히 같아야 한다.

### 9.13 권장 커밋

```text
feat: add structure-aware markdown chunking
```

## 10. 단계 4 — 다중 필드 lexical 검색

### 10.1 목표

파일명, 경로, 별칭, 태그, 속성, 섹션 헤딩, 본문을 독립 필드로 검색한다. 파일 단위 필드와 청크 단위 필드를 구분해 긴 파일이 과도하게 유리해지는 것을 막는다.

### 10.2 schema 설계

파일 단위:

```sql
CREATE TABLE file_fields (
    file_path         TEXT NOT NULL UNIQUE,
    basename_tokens   TEXT NOT NULL,
    directory_tokens  TEXT NOT NULL,
    alias_tokens      TEXT NOT NULL,
    tag_tokens        TEXT NOT NULL,
    property_tokens   TEXT NOT NULL
);

CREATE VIRTUAL TABLE file_fields_fts USING fts5(
    basename_tokens,
    directory_tokens,
    alias_tokens,
    tag_tokens,
    property_tokens,
    tokenize='ascii'
);
```

청크 단위:

```sql
CREATE VIRTUAL TABLE chunk_headings_fts USING fts5(
    heading_tokens,
    tokenize='ascii'
);
```

기존 `chunks_fts`는 body 전용으로 유지한다. `chunk_headings_fts.rowid == chunks.id`를 보장한다.

단계 3의 core `SCHEMA_VERSION=2`는 유지하고 별도 `LEXICAL_SCHEMA_VERSION=2`를 도입한다. `expected_metadata()`와 SQLite `index_metadata` 양쪽에 `lexical_schema_version`을 기록한다. 검색 시작 전에 `ensure_lexical_index()`가 이 값을 확인하고, 낮은 버전이면 무재임베딩 lexical migration을 수행한 뒤 metadata를 갱신한다. migration 실패 시 이전 DB와 벡터를 그대로 유지하고 `INDEX_REBUILD_REQUIRED`를 반환한다.

새 DB에서는 `file_titles`/`titles_fts`를 만들지 않고 `file_fields`/`file_fields_fts`만 만든다. 기존 DB migration이 성공한 뒤에만 temp DB에서 옛 두 table을 drop한다. 운영 중인 원본 DB에서 먼저 drop하면 안 된다.

### 10.3 frontmatter parsing

직접 만든 불완전 YAML parser를 사용하지 않는다.

1. `PyYAML`을 backend dependency에 추가한다.
2. 실제 설치 테스트에 사용한 exact version을 `requirements.txt`에 pin한다.
3. `yaml.safe_load()`만 사용한다.
4. parse 실패 시 문서 전체 인덱싱을 실패시키지 않고 빈 metadata로 처리한다.
5. parse 오류에는 파일 경로만 로그로 남기고 frontmatter 원문은 로그에 남기지 않는다.

### 10.4 metadata 추출 규칙

별칭 key:

- `alias`
- `aliases`
- key 비교는 case-insensitive

태그:

- frontmatter `tag`, `tags`
- Obsidian inline `#tag`
- leading `#` 제거 후 case-insensitive dedupe

속성:

- scalar string/number/boolean
- scalar list
- depth 5 이하 nested object
- key와 value를 모두 검색 text에 포함
- `position` 등 Obsidian parser 내부 필드는 제외
- 전체 property text는 파일당 12,000자로 제한
- 개별 값은 2,000자로 제한

검색에서 제외할 machinery key 기본 목록:

```text
cssclass, cssclasses, icon, banner, banner_y, position
```

### 10.5 field weights

파일 FTS 내부 시작값:

```text
basename: 10.0
directory: 7.0
aliases: 8.0
tags: 3.0
properties: 2.0
```

이 값은 최종 확정값이 아니라 단계 0 하네스의 첫 sweep 시작점이다. 다음 후보만 비교한다.

```text
A: 10, 7, 8, 3, 2
B: 10, 5, 6, 3, 2
C: 8, 4, 6, 2, 1
```

gold set에서 가장 높은 recall@40을 우선하고 동률이면 MRR@10, 다시 동률이면 낮은 forbidden count를 선택한다. 평가 없이 임의의 새 조합을 만들지 않는다.

### 10.6 retrieval channels

최종 후보 채널은 다음 네 개다.

1. `body`: `chunks_fts`
2. `heading`: `chunk_headings_fts`
3. `file`: `file_fields_fts`
4. `vector`: USEARCH

초기 channel RRF weight는 모두 `1.0`으로 둔다. field 내부 가중치와 channel 가중치를 동시에 크게 조정하지 않는다.

파일 채널 결과를 chunk ID로 변환하는 규칙은 단계 1의 `_title_candidate_ids()`를 일반화해 재사용한다. 이름은 `_file_candidate_ids()`로 바꾼다.

### 10.7 migration

파일·헤딩 lexical 필드 추가는 임베딩 bytes를 바꾸지 않으면 무재임베딩 migration이 가능하다. 하지만 단계 3과 함께 배포하면 schema 2 전체 재구축으로 처리한다.

단계 4를 독립 배포할 경우:

1. temp DB copy를 만든다.
2. 새 FTS table을 temp DB에 구축한다.
3. 모든 file_state 경로를 읽어 metadata와 heading tokens를 생성한다.
4. DB 무결성과 row 수를 검증한다.
5. vectors.usearch는 건드리지 않는다.
6. DB와 metadata generation만 원자 교체한다.

### 10.8 필수 테스트

1. alias로 파일 검색
2. frontmatter tag 검색
3. inline tag 검색
4. nested property key/value 검색
5. list property 검색
6. machinery key 제외
7. 잘못된 YAML이 다른 파일 인덱싱을 중단하지 않음
8. heading match가 해당 heading chunk ID를 후보로 만듦
9. delete/rename 시 모든 file/chunk FTS row 제거
10. incremental update와 full rebuild 결과 일치
11. lexical migration 중 벡터 파일 hash가 변하지 않음

### 10.9 품질 gate

- known-item 및 metadata case의 MRR이 감소하면 실패한다.
- 전체 recall@40이 감소하면 실패한다.
- forbidden path가 증가하면 field weight를 재조정한다.
- DB 크기 증가가 기존 DB 대비 60% 이하여야 한다. 초과 시 중복 필드를 조사한다.

### 10.10 권장 커밋

```text
feat: index markdown metadata and section fields
```

## 11. 단계 5 — reconcile 및 인덱스 교체 신뢰성

### 11.1 빠른 reconcile

`file_state`에 다음 필드를 추가한다.

```sql
file_size    INTEGER NOT NULL
modified_ns  INTEGER NOT NULL
```

이 변경에는 `STATE_SCHEMA_VERSION=2`를 사용한다. 시작 시 `ensure_state_schema()`가 temp DB copy에 `ALTER TABLE`과 `pending_paths` 생성을 적용하고 검증한 뒤 DB만 원자 교체한다. 벡터 bytes와 embedding metadata는 바꾸지 않는다. `SCHEMA_VERSION`을 올려 불필요한 전체 재임베딩을 유발하지 않는다.

reconcile 규칙:

1. 현재 파일 목록과 `stat()`만 먼저 읽는다.
2. path, size, modified_ns가 모두 같으면 본문을 읽지 않는다.
3. 하나라도 다르면 본문을 읽고 SHA-256을 계산한다.
4. hash도 같으면 file_state의 stat만 갱신하고 재임베딩하지 않는다.
5. hash가 다르면 변경 파일로 처리한다.
6. 존재하지 않는 기존 path는 deleted로 처리한다.

mtime 단독 신뢰가 우려되므로 수동 `strict reconcile` 옵션도 추가한다.

```text
reconcile mode: fast | strict
```

- startup 기본: `fast`
- 설정 UI의 수동 정밀 대조: `strict`
- strict는 현재처럼 모든 파일 hash를 계산한다.

protocol `reconcile` params에 optional `mode`를 추가한다. 누락 시 `fast`다. `SearchService.call()`은 `mode`가 `fast|strict`가 아니면 `INVALID_PARAMS`를 반환하고, 정상 값이면 `IndexManager.reconcile(mode=...)`에 전달한다. 설정 UI의 기존 대조 버튼은 `strict`, 자동 startup reconcile은 `fast`를 사용한다.

### 11.2 pending path journal

DB에 다음 table을 추가한다.

```sql
CREATE TABLE pending_paths (
    file_path TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    queued_at REAL NOT NULL
);
```

증분 변경 처리 순서:

1. 변경·삭제 path를 current DB의 `pending_paths`에 먼저 기록하고 commit한다.
2. temp DB/vector에 변경을 적용한다.
3. 새 index 교체가 성공하면 새 DB에서 pending row를 제거한다.
4. 시작 시 pending row가 있으면 해당 path만 다시 sync한다.
5. pending이 1,000개를 넘으면 전체 reconcile로 승격한다.

### 11.3 `_atomic_replace()` 수정

현재 backup 삭제 시점을 최종 검증 뒤로 이동한다.

목표 signature:

```python
def _atomic_replace(
    pairs: list[tuple[Path, Path]],
    validate: Callable[[], list[str] | None],
) -> None:
    ...
```

정확한 순서:

1. 기존 target을 `.backup`으로 이동한다.
2. source를 target으로 이동한다.
3. `validate()`를 호출한다.
4. 오류 list가 비어 있으면 backup을 삭제한다.
5. validate가 예외를 내거나 오류를 반환하면 새 target을 삭제한다.
6. 모든 backup을 원래 target으로 복원한다.
7. 복원 실패는 원래 검증 오류와 함께 로그에 남기고 예외를 다시 낸다.

`rebuild_all()`, `rebuild_vectors()`, `_apply_changes()` 모두 같은 경로를 사용해야 한다.

### 11.4 필수 테스트

1. fast reconcile이 unchanged 파일 본문을 읽지 않음
2. mtime만 바뀌고 hash가 같은 파일은 재임베딩하지 않음
3. strict reconcile은 모든 파일 hash 계산
4. pending path가 정상 완료 후 제거됨
5. 중간 예외 뒤 pending path가 남아 재시작 복구 가능
6. post-install validation 실패 시 backup 복원
7. 세 target 중 두 번째 교체 실패 시 모두 이전 세대로 복원
8. backup cleanup 실패가 정상 index를 손상하지 않음

### 11.5 완료 조건

- 2,000개 이상 파일의 unchanged startup reconcile에서 본문 read 수가 0이다.
- 실제 create/modify/rename/delete smoke test가 모두 통과한다.
- 강제 validation failure test 후 이전 index generation으로 검색된다.

### 11.6 권장 커밋

```text
fix: harden reconciliation and index replacement
```

## 12. 단계 6 — 제한적 adaptive rescue 실험

### 12.1 전제

단계 1~5가 완료되기 전에는 구현하지 않는다. 현재 Kiwi가 이미 주 lexical 채널이므로 K-QMD의 shadow index를 그대로 복제할 필요가 없다.

### 12.2 query class

작은 규칙 기반 classifier만 사용한다.

- `structured`: 따옴표, NOT, 향후 filter operator 포함
- `short-korean`: Hangul 포함, lexical token 1~3개
- `mixed-technical`: Hangul과 Latin/digit가 함께 있음
- `general`: 나머지

### 12.3 rescue 조건

다음 조건을 모두 만족할 때만 rescue를 실행한다.

1. class가 `short-korean` 또는 `mixed-technical`
2. body/title/heading/file lexical 채널 중 하나에 후보가 있음
3. 기본 fused top 결과의 채널 수가 1개 이하이거나 top score gap이 작은 경우
4. structured query가 아님

rescue candidate는 최대 3개다. 최종 결과 전체를 다시 쓰지 말고 기본 후보 뒤에 합집합한 뒤 동일한 diversity selector를 적용한다.

### 12.4 구조 신호

후보 재정렬 실험에 사용할 수 있는 신호:

- 전체 query phrase가 basename에 포함
- 전체 query phrase가 heading에 포함
- query token coverage
- 같은 heading/문단 안의 token proximity
- alias exact match

초기에는 점수 상수를 production에 하드코딩하지 않는다. benchmark script의 offline rerank 모드에서 먼저 sweep한다.

### 12.5 채택 기준

- recall@40이 최소 2 expected path 이상 증가
- complete recall 감소 0
- forbidden path 증가 0
- known-item MRR 감소 0
- p95 증가 10% 이하

조건을 만족하지 못하면 production 구현을 삭제하고 실험 문서만 남긴다.

### 12.6 명시적 비목표

- LLM query expansion
- cross-encoder reranker
- 외부 API
- 사용자 쿼리 로그 자동 수집

### 12.7 권장 커밋

성공 시:

```text
feat: add guarded Korean candidate rescue
```

실패 시 코드 커밋을 만들지 않고 benchmark 결과만 문서화한다.

## 13. 단계 7 — Obsidian 검색 UI

### 13.1 목표

CLI뿐 아니라 Obsidian 사용자가 검색 결과를 열고 정확한 섹션으로 이동할 수 있게 한다.

### 13.2 추가 파일

```text
src/search-modal.ts
src/search-result-view.ts
tests/plugin/search-modal.test.ts
```

### 13.3 명령

- `Vault Search: Open search`
- `Vault Search: Search selected text`

### 13.4 동작

1. 입력 250ms debounce
2. 2자 미만은 검색하지 않음
3. 새 입력이 오면 이전 결과 generation을 폐기
4. backend protocol은 그대로 사용
5. 결과에 파일명, heading path, snippet, channel badge 표시
6. 선택 시 파일을 열고 `start_line`으로 이동
7. backend가 idle이면 모델 로드 상태 표시
8. backend unavailable이면 설정 화면으로 이동하는 버튼 표시

### 13.5 검색 취소

protocol-level cancellation은 별도 복잡도가 크다. 첫 구현에서는 request generation ID로 늦게 도착한 응답을 UI에서 무시한다. 서버 작업 취소는 구현하지 않는다.

### 13.6 모바일

`manifest.json`의 desktop-only를 바꾸지 않는다. 모바일 지원을 위해 Python sidecar 구조를 제거하지 않는다.

### 13.7 필수 테스트

1. debounce 동안 요청 1회
2. 오래된 응답 무시
3. 결과 클릭 시 경로와 line 전달
4. service unavailable 상태 렌더링
5. selected text command가 선택 문자열을 query로 사용

### 13.8 권장 커밋

```text
feat: add native vault search interface
```

## 14. 선택 단계 — ir 백엔드 교체 실험

### 14.1 실험을 시작할 조건

단계 0 평가 하네스가 있고 단계 1 결과가 baseline으로 확정된 뒤에만 시작한다.

### 14.2 main branch에 바로 통합하지 않는다

별도 branch 또는 throwaway adapter에서 다음만 측정한다.

- 동일 K_Notes scope
- 동일 query/gold set
- Kiwi 현재 구현 대 ir Lindera/ko-dic
- 현재 e5-base 대 ir EmbeddingGemma/BGE-M3
- cold/warm latency
- idle RAM
- indexing 시간과 크기
- Windows 설치 및 프로세스 종료

### 14.3 교체 최소 조건

다음을 모두 만족해야 백엔드 교체 RFC를 작성한다.

- recall@40이 현재보다 5 percentage point 이상 높음
- complete recall 감소 없음
- warm p95 250ms 이하
- Windows에서 한국어 preprocessor 설치 자동화 가능
- Obsidian 종료 후 daemon이 남지 않음
- 현재 JSON 결과 schema 제공 가능
- 동적 per-vault endpoint 또는 동등한 격리 제공 가능
- LocalAppData 저장과 include/exclude scope 제공 가능

하나라도 충족하지 못하면 엔진 교체를 중단하고 필요한 기술만 현재 Python 백엔드에 이식한다.

## 15. 하지 말아야 할 구현

다음 변경은 이 계획의 범위에서 금지한다.

1. 현재 sidecar를 Ollama 필수 구조로 교체
2. 벡터를 JSON으로 저장
3. 검색 때마다 모델 프로세스 실행
4. 인덱스를 `.obsidian/plugins` 아래에 저장
5. Kiwi 제거
6. 기본 모델을 영어 중심 MiniLM으로 교체
7. 평가 없이 RRF를 제거
8. 평가 없이 cross-encoder reranker 추가
9. 사용자의 검색어나 노트 제목을 telemetry로 전송
10. 고정 포트의 무인증 HTTP 서버 추가
11. schema version을 올리지 않고 DB 구조 변경
12. 기존 정상 index를 먼저 삭제한 뒤 새 index 구축
13. 한 커밋에 청킹, DB schema, fusion을 동시에 변경

## 16. 단계별 의존 관계

```text
단계 0 benchmark
  -> 단계 1 title candidate union
      -> 단계 2 match modes / explain
          -> 단계 3 markdown chunking
              -> 단계 4 metadata / heading fields
                  -> 단계 5 reliability
                      -> 단계 6 adaptive rescue 실험
                          -> 단계 7 UI
```

단계 5는 단계 3보다 먼저 수행해도 기술적으로 가능하지만, schema 2 작업과 중복 충돌을 줄이기 위해 위 순서를 기본으로 한다.

## 17. 최종 완료 정의

전체 개선 프로젝트는 다음 조건을 모두 만족할 때 완료다.

### 기능

- 제목 일치 파일이 body/vector 후보 밖에서도 검색된다.
- any/all/phrase 검색이 동작한다.
- 헤딩 계층과 line 범위를 가진 구조 인식 청크가 생성된다.
- alias, tag, property, heading이 검색된다.
- CLI verbose 결과에서 후보 채널과 순위를 설명할 수 있다.
- fast/strict reconcile이 구분된다.
- post-build validation 실패 시 이전 index가 복원된다.

### 품질

- K_Notes recall@40이 최초 baseline보다 낮지 않다.
- complete recall이 최초 baseline보다 낮지 않다.
- known-item MRR@10이 낮지 않다.
- forbidden path count가 증가하지 않는다.
- 장문·헤딩·metadata target case가 개선된다.

### 성능

- warm search p95 250ms 이하
- unchanged startup fast reconcile에서 본문 전체 read 없음
- 인덱스 크기 2배 이하
- 모델 메모리 중복 로드 없음

### 신뢰성

- create/modify/rename/delete 증분 smoke 통과
- full rebuild 중 실패해도 이전 index 검색 가능
- 플러그인 reload 후 새 runtime을 이전 인스턴스가 삭제하지 않음
- Obsidian 종료 후 Python 프로세스와 runtime 파일 제거

### 문서

- architecture, settings, protocol, development 문서가 실제 구현과 일치
- benchmark baseline과 실행 방법 기록
- 각 신규 설정의 rebuild 영향 기록
- 채택하지 않은 실험과 이유 기록

## 18. 구현 모델용 체크리스트

각 단계를 시작할 때 다음 순서를 그대로 따른다.

1. 해당 단계의 수정 대상 파일을 모두 읽는다.
2. 관련 테스트를 먼저 읽는다.
3. 단계 0 baseline을 실행한다.
4. 이 문서에 없는 새 설정이나 새 abstraction을 임의로 만들지 않는다.
5. 가장 작은 변경부터 구현한다.
6. unit test를 추가한다.
7. 기존 unit test를 실행한다.
8. build를 실행해 `main.js`를 재생성한다.
9. benchmark를 다시 실행한다.
10. 품질 gate를 확인한다.
11. 실패하면 상수를 임의 조정하기 전에 실패 case의 후보 채널을 확인한다.
12. 같은 원인으로 두 번 실패하면 구현을 더 확장하지 말고 원인을 문서화한다.
13. 성공한 파일만 stage한다.
14. 단계별 권장 메시지로 별도 커밋한다.
15. 다음 단계로 이동하기 전에 `git status`가 clean인지 확인한다.

## 19. 조사 원본

- https://github.com/conoro/obsidian-zvec-hybrid-search
- https://github.com/ryan-manor/Obsidian-Seek
- https://github.com/ashwin271/obsidian-vector-search
- https://github.com/achekulaev/obsidian-qmd
- https://github.com/vlwkaos/ir
- https://github.com/jylkim/kqmd

조사 기준일은 2026-08-11이다. 외부 프로젝트의 구현이나 라이선스가 바뀔 수 있으므로 실제 코드를 이식할 때 해당 commit과 라이선스를 다시 확인한다.
