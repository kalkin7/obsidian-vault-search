# Search Quality Benchmark

이 하네스는 `obsidian-vault-search`의 검색 품질·성능을 같은 조건에서 반복 측정하기 위한
재현 가능한 평가 도구다. 랭킹 상수, 청킹, fusion 변경을 merge하기 전에 이 하네스로
기준선 대비 회귀가 없음을 확인해야 한다.

## 파일 구성

```text
benchmarks/
  relevance-cases.schema.json   # case JSON의 JSON Schema
  relevance-cases.example.json  # 예시 (저장소에 넣어도 되는 경로만 사용)
scripts/
  benchmark-search.py           # 하네스 본체 (sidecar에 protocol search 요청)
backend/tests/
  test_benchmark_schema.py      # schema 검증·지표 계산 단위 테스트
```

실제 개인 볼트의 gold set에 민감한 경로나 문구가 있으면 저장소에 넣지 않는다.
`--cases` 인수로 외부 JSON 경로를 받는다.

## case JSON 형식

```json
{
  "schema_version": 1,
  "vault": "K_Notes",
  "cases": [
    {
      "id": "ev-charger-timeline",
      "query": "전기차 충전기 설치 경과",
      "intent": "timeline",
      "expected_paths": ["5_Wiki/issues/apt/전기차_충전시설_설치_및_관리.md"],
      "acceptable_paths": [],
      "forbidden_paths": [],
      "top_k": 40
    }
  ]
}
```

- `id`: 파일 안에서 유일한 ASCII kebab-case
- `intent`: `exact` | `known-item` | `topic` | `timeline` | `value` | `korean-morphology`
- `expected_paths`: 반드시 찾아야 하는 경로
- `acceptable_paths`: 관련 있지만 필수는 아닌 경로
- `forbidden_paths`: 상위 결과에 나오면 명백한 회귀인 경로
- `top_k`: 기본 40, 최소 1, 최대 200
- expected/acceptable/forbidden이 **모두** 비어 있으면 거부된다.

## 실행

```powershell
# K_Notes sidecar가 Obsidian 플러그인으로 실행 중이어야 한다.
python -X utf8 scripts/benchmark-search.py `
  --vault "C:\Users\manager\Documents\Obsidian\K_Notes" `
  --cases "C:\...\goldset.vault-search.json" `
  --output "C:\...\benchmark-2026-08-11.json"
```

`--baseline`으로 이전 결과를 주면 지표 차이를 출력하고 품질 gate를 검사한다.

```powershell
python -X utf8 scripts/benchmark-search.py `
  --vault "C:\Users\manager\Documents\Obsidian\K_Notes" `
  --cases "C:\...\goldset.vault-search.json" `
  --output "C:\...\benchmark-after.json" `
  --baseline "C:\...\benchmark-2026-08-11.json"
```

각 쿼리는 warm-up 1회 후 5회 측정한다. 품질 지표는 첫 측정 결과로 계산하고,
case latency는 5회의 median을 사용한다.

## 지표

- file recall@20 / recall@40: expected path 중 상위 K 안에 들어온 비율
- success rate: expected path를 하나 이상 찾은 case 비율
- complete recall: expected path를 모두 찾은 case 비율
- MRR@10: 첫 expected path 기준 reciprocal rank
- unique path count@20: 상위 20 결과의 서로 다른 파일 수 (case 평균)
- forbidden path count@20: 상위 20 결과에 포함된 forbidden 경로 수 (전체 합)
- latency p50/p95: case median latency의 분포
- channels_present: 쿼리별 body/vector/title 후보 채널 포함 여부 (verbose 기준)

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 실행 성공, gate 통과 |
| 1 | 실행 성공, 품질 gate 실패 |
| 2 | 입력 schema 오류 |
| 3 | sidecar unavailable |
| 4 | 검색 요청 실패 |

## 기본 품질 gate

`--baseline`을 주면 다음을 검사한다.

- recall@40이 baseline보다 낮으면 실패
- complete recall이 한 case라도 감소하면 실패
- forbidden path count가 증가하면 실패
- latency p95가 25% 이상 증가하면 실패
- 새 기능 목표 case는 단계 문서에 정한 최소 개선폭을 만족해야 한다

## 완료 조건

- 같은 인덱스에서 두 번 실행 시 품질 지표가 동일하다.
- latency를 제외한 결과 JSON이 deterministic하다.
- 최소 12개 K_Notes case와 39개 expected path를 외부 gold set으로 재현한다.
- baseline JSON에 git commit hash와 backend version을 기록한다.
