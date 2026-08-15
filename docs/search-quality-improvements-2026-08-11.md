# 검색 품질 개선 및 Omnisearch 라이브 대조 — 2026-08-11

> **기준일 주의 (2026-08-13)**: 이 문서는 2026-08-11 당시의 구조를 기록한 역사 문서다.
> §2의 `file_titles`/`titles_fts` 테이블은 이후 `file_fields`/`file_fields_fts`
> (`basename_tokens`·`directory_tokens`·`alias_tokens`·`tag_tokens`·`property_tokens`) 구조로
> 대체됐다. `titleRrfWeight`로 가중된 “file” 채널이 제목 신호를 흡수한다. 아래 내용은 당시 기준으로 읽어야 한다.

## 결론

Obsidian Omnisearch와 Vault Search Service는 대체 관계가 아니라 용도가 다른 보완 관계다.

- Omnisearch: Obsidian UI에서 파일명·헤딩·정확 키워드로 빠르게 파일을 찾는 검색기
- Vault Search Service: AI 에이전트와 CLI에서 사용하는 한국어 형태소 + BM25 + 임베딩 하이브리드 검색기

Omnisearch의 강점 중 검색 품질에 직접 도움이 되는 세 가지를 Vault Search Service에 적용했다.

1. 파일별 결과 수 제한으로 청크 중복 억제
2. 파일명·경로·H1~H3 전용 FTS5 보조 인덱스와 가중 순위
3. 정확 BM25 결과가 없을 때 접두사 검색 폴백

## 구현

### 1. 파일별 결과 다양성

RRF 융합과 제목 가중치 적용 후 최종 결과를 선택할 때 파일별 청크 수를 제한한다.

- 설정: `maxChunksPerFile`
- 기본값: `1`
- 적용 위치: `backend/vault_search/search.py`

동일 파일의 여러 청크가 상위 결과를 차지하더라도 첫 청크만 유지하고 다음 순위의 다른 파일로 채운다. 에이전트 검색은 후보 파일을 찾은 뒤 원문 전체를 읽으므로 기본값 1이 수집 범위에 유리하다.

### 2. 파일명·경로·헤딩 가중치

기존 `chunks_fts`와 별도로 파일 단위 보조 인덱스를 추가했다.

- 일반 테이블: `file_titles`
- FTS5 테이블: `titles_fts`
- 필드 가중치:
  - 파일명: `10`
  - 디렉터리: `7`
  - H1~H3 헤딩: `5`
- 제목 순위 결합 방식: RRF의 세 번째 채널
- 설정: `titleRrfWeight`
- 기본값: `1.0`

제목 매치 파일의 모든 후보 청크에 다음 보너스를 더한다.

```text
titleRrfWeight / (rrfK + titleRank)
```

별도 제목 채널을 사용하므로 벡터·본문 BM25의 강점을 유지하면서 파일명·헤딩이 명확한 문서를 끌어올린다.

### 3. 접두사 BM25 폴백

정확 BM25 결과가 0건일 때만 FTS5 접두사 표현으로 한 번 더 검색한다.

```text
정확: "하자보"
폴백: "하자보"*
```

- 설정: `prefixFallback`
- 기본값: `true`
- 본문 FTS와 제목 FTS에 모두 적용

정확 검색 결과가 있을 때는 접두사 후보를 섞지 않아 잡음을 억제한다.

## 무재임베딩 마이그레이션

제목 보조 인덱스는 임베딩 모델과 무관하므로 기존 벡터를 다시 만들지 않는다.

1. 서비스 시작 시 `title_index_version`과 `file_titles`/`file_state` 개수를 검사한다.
2. 누락되거나 버전이 다르면 기존 볼트 파일에서 파일명·경로·H1~H3만 읽는다.
3. Kiwi 토큰화 후 `file_titles`와 `titles_fts`를 생성한다.
4. `index_metadata.title_index_version = 1`을 기록한다.
5. 이후 create/modify/rename/delete 증분 동기화에 제목 인덱스도 함께 반영한다.

K_Notes 적용 결과:

```json
{"titles": 2865, "files": 2865, "title_version": 1}
```

기존 8,537개 USEARCH 벡터는 유지했다.

## 개선 전후 실측

### 결과 다양성

쿼리: `충전시설`

- 개선 전: 상위 5개 중 동일 파일이 3개 청크를 차지
- 개선 후: 상위 8개가 모두 서로 다른 파일

개선 후 상위 5개:

1. `2_Area/apt/시설/전기자동차 충전시설 설치.md`
2. `+/전기차 충전시설(충전기) 사고배상책임보험.md`
3. `5_Wiki/decisions/2019_전기차_충전시설_설치.md`
4. `5_Wiki/issues/apt/전기차_충전시설_설치_및_관리.md`
5. `2_Area/apt/시설/전기차 충전소 관련 법령 모음.md`

### 제목 가중치

쿼리: `하자보수 공사`

`5_Wiki/issues/apt/프로젝트창_하자보수_공사.md`가 제목 채널 1위(`title_rank=1`)로 추가 가중되어 개선 전 상위 5개 밖에서 개선 후 3위로 상승했다.

### 접두사 폴백

실제 FTS에서 `하자보`를 측정한 결과:

```text
exact=0
prefix=2
```

CLI 검색에서는 접두사로 발견한 두 저널 청크에 `bm25_rank=1,2`가 부여됐다.

## Omnisearch 라이브 대조

### 최초 실행에서 발생한 운영 실수 — 반복 금지

최초 라이브 대조에서는 Omnisearch 1.30.1의 HTTP API를 켜기 위해 `data.json`을 수정하고 플러그인을 리로드했다. 이 절차는 불필요했고 다시 사용하면 안 된다.

Omnisearch의 production `onunload()`는 검색 캐시를 삭제한다. 따라서 `obsidian plugin:reload id=omnisearch`를 실행하면 다음 로드에서 전체 인덱스를 다시 만든다. K_Notes는 PDF·Office·이미지 인덱싱이 켜져 있고 `hideExcluded=false`이므로 캐시가 없을 때 `9_System/attachments`와 벤치마크 파일을 포함한 약 7,946개 파일을 스캔한다. 인덱싱이 끝나기 전에 다시 리로드하면 이전 `populateIndex()`와 새 인덱싱이 겹칠 수도 있다.

이 과정에서 실제로 전체 인덱싱이 반복되고 이전 HTTP 서버가 뒤늦게 열리는 레이스가 발생했다. 테스트 종료 후 `httpApiEnabled=false`로 복구하고 Obsidian을 재시작해 51361 포트가 닫힌 것을 확인했다.

### 향후 라이브 대조 표준 절차

Omnisearch는 `globalThis.omnisearch.search()` 공개 API를 이미 제공한다. 이후에는 설정 변경이나 리로드 없이 Obsidian CLI의 `eval`로만 호출한다.

```powershell
$Query = "층간소음"
obsidian eval code="(async () => JSON.stringify((await globalThis.omnisearch.search('$Query')).slice(0,20).map(x => ({path:x.path, score:x.score}))))()"
```

이 방식은 현재 메모리에 로드된 실제 Omnisearch 인덱스를 사용하면서 다음 문제를 모두 피한다.

- Omnisearch 캐시 삭제
- 7,946개 파일 전체 재인덱싱
- 이전·새 비동기 인덱싱 중첩
- 무인증 HTTP 포트 개방
- 플러그인 리로드

라이브 대조 시 다음 규칙을 적용한다.

1. Omnisearch 정상 인덱싱 완료를 먼저 확인한다.
2. `obsidian eval`과 `globalThis.omnisearch.search()`만 사용한다.
3. `httpApiEnabled`를 변경하지 않는다.
4. `plugin:reload id=omnisearch`를 실행하지 않는다.
5. 결과 경로만 저장해 Vault Search 결과와 오프라인 비교한다.

### 하네스 대조와 달라진 점

초기 재현 하네스는 Vault Search와 동일한 범위를 맞추기 위해 `9_System`과 비문서 파일을 제외했다. 실제 Omnisearch는 설정상 PDF·Office·이미지 인덱싱이 켜져 있어 `9_System/attachments`와 검색 벤치마크까지 포함했다. 이 범위 차이가 라이브 결과에 큰 영향을 주었다.

### 대표 결과

| 쿼리 | Omnisearch 라이브 | 개선된 Vault Search |
|---|---|---|
| `층간소음` | 위키 이슈 8건이 상위권. 매우 우수 | 민원·일지·위키를 함께 발견 |
| `하자보수 공사` | 첨부 PDF가 1위, 프로젝트 위키가 2위 | 범위 밖 첨부를 제외하고 프로젝트 위키가 3위·제목 1위 |
| `전기차 충전기 설치 경과` | 상위 8개가 계약서·민원 PDF/XLSX 등 첨부 중심 | 전기차 이슈 위키 1위, 보험·업체·저널을 다양하게 반환 |
| `EV 충전기` | 관련 위키 2건 뒤 검색 벤치마크 파일이 3~8위 | 업체·전기차 이슈·저널을 반환 |
| `하자보수의` | 조사 포함 문자열이 있는 문서 중심, 점수 저하 | Kiwi가 `하자보수`로 분석해 관련 문서를 폭넓게 반환 |
| `충전시설` | 핵심 문서 4건 이후 시스템 파일·첨부 혼입 | 핵심 마크다운 문서를 서로 다른 파일로 반환 |
| `재건축` | 첨부 PDF와 뉴스 요약 중심 | 의미상 연관된 건축·해체 검토 노트도 발견 |

### 해석

Omnisearch의 정확 키워드·파일명 검색 품질은 높다. 그러나 현재 K_Notes 설정에서는 다음 한계가 확인됐다.

- `9_System/attachments`와 벤치마크 문서까지 인덱싱해 에이전트 검색에는 잡음이 많다.
- 한국어 형태소 분석이 없어 조사·어미 변형에 취약하다.
- 의미가 같지만 표현이 다른 문서를 찾지 못한다.
- 외부 HTTP API는 인증이 없고 단일 BM25 검색 엔드포인트만 제공한다.

Vault Search는 명시적 include/exclude 범위, Kiwi, 임베딩, 인증된 per-vault 런타임과 CLI를 제공하므로 에이전트 검색 경로로 유지할 가치가 있다.

## 추가 안정성 수정

라이브 적용 중 플러그인 리로드 시 이전 인스턴스의 비동기 `stop()`이 새 인스턴스의 `runtime.json`을 지울 수 있는 레이스를 발견했다.

수정 후에는 종료 대상 PID와 현재 runtime PID가 같은 경우에만 runtime 파일을 삭제한다. 실제 `obsidian plugin:reload id=obsidian-vault-search` 후 CLI가 `ready` 상태로 재연결되는 것을 확인했다.

## 검증

- TypeScript: 3개 파일, 5개 테스트 통과
- Python: 19개 테스트 통과(신규 검색 테스트 5개 포함)
- `npm run build` 통과
- smoke test 통과
- 제목 인덱스: 2,865/2,865파일 일치
- 기존 청크: 8,537개 유지
- 플러그인 리로드 후 runtime/CLI 복구 확인
- Omnisearch API: 테스트 후 비활성화 및 51361 포트 종료 확인
