# Adaptive Rescue Offline Experiment (2026-08-12)

## Decision

Roadmap Step 6 adaptive rescue was rejected. No production search code or constants were
retained because the sweep did not gain the required two expected paths at recall@40.

## Inputs and method

- Gold set: 12 K_Notes cases and 39 expected paths, read externally from the vault benchmark
  directory without modifying or deploying the vault.
- Baseline: the existing post-Step-4 benchmark result. The ranking is also representative of
  Steps 5 and 6 because Step 5 changed reconciliation reliability, not search ranking.
- Index data: the current sidecar SQLite index was opened in read-only mode.
- Query classes: `structured`, `short-korean`, `mixed-technical`, and `general`.
- Rescue eligibility required every roadmap condition: class was `short-korean` or
  `mixed-technical`, a lexical body/title/heading/file candidate existed, the fused top result
  had at most one channel or the top score gap was within the swept threshold, and the query
  was not structured.
- Candidate limit: 3.
- Structure signals: full phrase in basename, full phrase in heading, token coverage, token
  proximity within one chunk/heading, and exact alias match.
- Sweep: each signal weight in `{0, 1, 2}`, score-gap threshold in
  `{0, 0.0005, 0.001, 0.002, 0.005}`, and union insertion rank in
  `{11, 16, 21, 26, 31, 36}`. No production constants were introduced.
- Latency estimate: read-only rescue preprocessing was timed only for queries that could pass
  the class and maximum-gap guards, then added to the measured baseline p95. This is a
  conservative offline projection rather than production request timing.

The detailed report remains outside the repository at
`%LOCALAPPDATA%\Temp\opencode\step6-adaptive-rescue.json`; it contains private vault paths and
must not be committed.

## Results

| Criterion | Baseline | Best sweep | Delta | Required | Result |
|---|---:|---:|---:|---:|---|
| Expected paths found at 40 | 29/39 | 29/39 | 0 paths | at least +2 paths | Fail |
| Micro recall@40 | 74.3590% | 74.3590% | 0 pp | implied by +2 paths | Fail |
| Benchmark macro recall@40 | 79.0278% | 79.0278% | 0 pp | at least +2 paths | Fail |
| Complete recall | 5/12 (41.6667%) | 5/12 (41.6667%) | 0 cases | no decrease | Pass |
| Forbidden count@20 | 0 | 0 | 0 | no increase | Pass |
| Known-item MRR@10 | 1.0000 | 1.0000 | 0 | no decrease | Pass |
| Projected p95 | 136.819 ms | 146.335 ms | +9.516 ms (+6.9550%) | at most +10% | Pass |

At the largest swept gap threshold, three `mixed-technical` cases reached lexical candidate
evaluation. No `short-korean` case met the uncertainty guard. Across the full sweep, no
eligible rescue candidate added an expected path to the top 40.

## Outcome

The primary adoption criterion failed, so guarded rescue, explain output, production tests,
and the recommended `feat: add guarded Korean candidate rescue` commit were not implemented.
The existing production ranking remains unchanged.
