# Wiki sources expansion evaluation (2026-08-12)

## Decision

Adopt the low-cost Wiki `sources` expansion. It improved tail recall without changing the direct top
30, adding another embedding request, or increasing forbidden results in the evaluated top 40.

## Safety envelope

- Explicit `intent=timeline`, or a conservative relationship/full-history phrase when intent is absent
- Top five direct Wiki issue, entity, or decision notes only
- YAML frontmatter `sources` only; no body wikilinks, backlinks, lexical aspects, or recursive traversal
- Maximum five source results and one hop
- Existing direct top 30 remain unchanged
- With fewer than 30 direct results, sources append after every direct result without replacing one
- Results never exceed the requested `top_k`
- Vault containment, configured scope, existing file, indexed chunk, and 256 KiB Wiki size checks

## K_Notes benchmark

The benchmark used the existing 12-case external gold file without modifying it. Five measured searches
per case followed one warm-up request.

| Metric | Baseline | Wiki sources |
|---|---:|---:|
| Recall at 20 | 71.5278% | 71.5278% |
| Recall at 40 | 79.0278% | 82.3611% |
| Complete cases | 5/12 | 6/12 |
| MRR at 10 | 0.819444 | 0.819444 |
| Forbidden at 20 | 0 | 0 |
| Forbidden at 40 | 0 | 0 |
| Unique paths at 20 | 20.0 | 20.0 |
| Baseline p95 | 163.494 ms | - |
| Final measured p95 | - | 139.482 ms |

The latency samples were collected across separate sidecar restarts, so the lower final p95 is not
claimed as a performance improvement. The relevant result is that no latency regression was observed.

## Recovered expected paths

`relationship-db-insurance-incidents` became complete by recovering:

- `2_Area/journals/daily/2019-10-21.md`
- `2_Area/journals/daily/2019-10-29.md`

Both paths came from the explicit `sources` list in
`5_Wiki/entities/업체_DB손해보험.md`. No expected path or previously complete case was lost.
