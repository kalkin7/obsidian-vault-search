# Production-identical expansion evaluation (2026-08-12)

## Decision

Reject the proposed timeline tail expansion. Production search, protocol, CLI, and UI changes were
removed because measured p95 overhead exceeded the 10% adoption gate. No deployment or commit was made.

## Fixed configuration

- Explicit `intent=timeline` plus the production conservative complex-query regex
- One direct semantic request with `top_k=100`
- Preserve 30 direct unique paths; skip expansion below 30 unique direct paths
- Five deterministic Kiwi lexical aspects
- Existing SQLite body, heading, and file FTS only
- Top five direct Wiki issue/entity/decision notes, one-hop YAML `sources` and body wikilinks
- Five lexical plus five graph candidates, deduplicated; maximum ten additions in ranks 31-40
- Five measured repetitions per case; all path orders were deterministic

The evaluator used the production implementation functions directly. The detailed private-vault report
is outside the repository at
`%LOCALAPPDATA%\Temp\opencode\production-identical-expansion-report.json`.

## Gold correction

The external gold file was not modified. The temporary corrected copy replaced only:

- stale: `2_Area/apt/입주자대표회의/2023년 03월 입주자대표회의 정기 회의.md`
- canonical: `2_Area/apt/입주자대표회의/2023년 03월 입주자대표회의 정기 회의 (3기 13차).md`

No other expected path was stale after that correction.

## Results

Corrected and original-gold continuity metrics were numerically identical because the corrected CCTV
path was not retrieved by either ranking.

| Metric | Baseline | Experiment |
|---|---:|---:|
| Expected paths at 40 | 29/39 | 31/39 |
| Micro recall at 40 | 74.3590% | 79.4872% |
| Macro recall at 40 | 79.0278% | 82.7778% |
| Recall at 20 | 71.5278% | 71.5278% |
| MRR at 10 | 0.819444 | 0.819444 |
| Complete cases | 5/12 | 6/12 |
| Forbidden at 20 | 0 | 0 |
| Unique paths at 40 | 480 | 480 |
| p95 latency | 175.025 ms | 208.287 ms |
| p95 overhead | - | 33.262 ms / 19.004% |

The quality gate passed, but the latency gate failed (`<=250 ms` passed; `<=10%` overhead failed).

## Recovered and lost

Recovered:

- `relationship-db-insurance-incidents`: `2_Area/journals/daily/2019-10-21.md` via the explicit
  `sources` list in `5_Wiki/entities/업체_DB손해보험.md`
- `relationship-db-insurance-incidents`: `2_Area/journals/daily/2019-10-29.md` via the same explicit
  Wiki source relation
- `relationship-parking-access-control`: `5_Wiki/issues/apt/정문_차단기_공사_2019.md` via lexical
  aspects `cctv 차단기` and `차단기 출입`

Lost:

- `relationship-action-permit-patterns`:
  `2_Area/apt/행정/행위허가, 신고 후 절차 관련 질의응답.md`

The net gain was two expected paths and one complete case, but it did not justify the measured latency
regression under the agreed safety envelope.
