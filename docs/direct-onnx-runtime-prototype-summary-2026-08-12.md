# Direct ONNX Runtime Prototype Summary (2026-08-12)

## Purpose

Evaluate a CPU-only prototype that runs `intfloat/multilingual-e5-base` directly through `onnxruntime` and `tokenizers` — with explicit masked mean pooling and L2 normalization — and without importing `torch`, `sentence_transformers`, `transformers`, or `optimum`.

The experiment answers: can a direct FP32 ONNX path preserve current PyTorch embedding and retrieval behavior while reducing cold startup time and improving bulk embedding throughput?

Full raw data lives in `%LOCALAPPDATA%\Temp\opencode\direct-e5-onnx\` (temporary root, not in this repository). This document is the reviewed summary.

## Method

- Isolated venv installed only `numpy 2.4.4`, `tokenizers 0.22.2`, `onnxruntime 1.25.1`, `psutil`. No `--system-site-packages`.
- The direct process asserts none of the four high-level packages is importable at startup and not present in `sys.modules` after inference.
- Model snapshot `d128750597153bb5987e10b1c3493a34e5a4502a` (revision pinned by `refs/main`). File hashes recorded in the environment manifest.
- Tokenizer contract asserted from the snapshot: XLM-RoBERTa, `<s>`/`</s>`/`<pad>` = 0/2/1, max 512 tokens, right truncation, longest-batch right padding, lowercasing disabled.
- Pooling contract asserted from `1_Pooling/config.json`: 768-dim attention-mask mean pooling; normalization via L2.
- One immutable corpus manifest (8,419 chunks) was captured from read-only SQLite (`mode=ro`, `PRAGMA query_only=ON`, generation checked before/after). Both backends consumed only that manifest and verified its aggregate hash; production `chunks.db` was never reopened.
- PyTorch and direct ONNX encoded the full corpus independently in separate processes (no concurrent execution).
- Retrieval parity used exact cosine ranking over all vectors with stable tie-breaking, collapsed to unique file paths.

## Results

### Quality gates (all pass)

| Gate | Required | Result |
|---|---:|---:|
| Minimum fixture cosine similarity | >= 0.99999 | 0.999999999997 |
| Token IDs / attention masks match (diagnostic fixtures) | identical | 113/113 items |
| Pure-vector gold recall@40 | >= 22/39 | 22/39 (same as PyTorch) |
| Mean top-40 unique-file overlap | >= 99% | 100.00% |
| Min document cosine (full corpus) | >= 0.99999 | 0.999999806 |
| Min query cosine | >= 0.99999 | 0.999999932 |
| Per-case gold regressions | none | none (per-case hits identical) |

Expected-file ranks were identical between backends for every gold file.

### Performance

| Metric | PyTorch FP32 | Direct ONNX FP32 |
|---|---:|---:|
| Cold median startup (12 samples, alternating) | 4.626 s | 1.726 s (−62.7%) |
| Cold p95 startup | 4.699 s | 1.742 s |
| Warm query batch-1 p50 / p95 | 0.0150 / 0.0175 s | 0.0083 / 0.0097 s |
| Encode 8,419 docs, batch 32 | 402.2 s (20.9 cps) | 339.6 s (24.8 cps) |
| Load time | 4.98 s | 1.54 s |

Bulk throughput (direct, full corpus per batch size): 1 → 5.3, 8 → 8.7, 16 → 22.4, 32 → 22.9, 64 → 22.4 chunks/s. Small batches are dominated by per-call ONNX thread-pool overhead on this hybrid CPU.

### Memory (the trade-off)

| Point | PyTorch | Direct |
|---|---:|---:|
| Steady state during corpus encode | 1.60 GB | 2.23 GB (+39%) |
| Peak during model/session load | 0.83 GB | 2.49 GB (+55%) |

The direct path keeps the full 1.11 GiB FP32 ONNX model resident in the ORT arena plus intermediate buffers, and session creation transiently allocates the graph workspace. This increase exceeds 20% and requires an explicit decision or mitigation before production adoption.

## Safety and integrity

- No repository, vault, plugin, runtime, settings, or index file was written by the experiment. Production plugin remained `ready` with `index_generation` unchanged.
- Pre/post repository manifests were diffed; the experiment produced zero working-tree changes. (The repository was modified externally during the experiment by a separate commit and one new user document — not by this work.)

## Decision

**Candidate for production design.** All mandatory quality gates pass and startup is meaningfully faster (well above the 20%/1.0 s adoption threshold). Adoption still requires a separate production integration plan covering backend preference, model provisioning, runtime dependencies, index metadata compatibility, settings/rollback, and CUDA validation — per the prototype plan §13. The memory increase must be accepted or mitigated first.

## Memory mitigation experiment (session options)

Because the memory increase is the main trade-off, seven ONNX Runtime session-option configurations were measured in isolated processes (2000-chunk encode at batch 32, clean process per config, embedding parity checked against baseline):

| Config | Session create | Peak after create | Steady RSS | Throughput | Min cosine vs baseline |
|---|---:|---:|---:|---:|---:|
| baseline (default) | 1.33 s | 2.226 GB | 1.990 GB | 24.9 cps | 0.999999828 |
| threads1 | 1.27 s | 2.223 GB | 1.988 GB | 3.1 cps | 0.999999828 |
| threads8 | 1.27 s | 2.225 GB | 1.989 GB | 15.6 cps | 0.999999828 |
| no_arena | 1.31 s | 2.227 GB | **1.495 GB** | 14.0 cps | 0.999999828 |
| no_arena + no mem pattern | 1.34 s | 2.227 GB | 1.504 GB | 14.1 cps | 0.999999828 |
| disable_all graph opt | 1.26 s | 2.226 GB | 2.037 GB | 21.0 cps | 0.999999835 |
| enable_basic graph opt | 1.34 s | 2.226 GB | 2.040 GB | 10.8 cps | 0.999999835 |

Findings:

- **The session-creation peak (~2.22 GB) is invariant across every option tested.** It is the floor of loading the 1.11 GiB FP32 weights plus graph workspace; neither thread count, arena, nor graph-optimization level moves it.
- **`enable_cpu_mem_arena=False` is the only effective steady-state lever**: 1.99 GB → 1.50 GB (−25%), which is *below* the PyTorch steady state (1.60 GB). The cost is throughput dropping from 24.9 to 14.0 cps, slower than the PyTorch baseline (20.9 cps).
- Graph-optimization variants neither help memory nor throughput; `threads1` is catastrophic for batch encoding (3.1 cps).
- Every configuration preserves embedding parity (min cosine ≥ 0.9999998).

Recommendation: keep **default session options** for throughput. Treat `no_arena` as a memory-first fallback only if the sidecar is memory-constrained and reindexing is infrequent. The 2.2 GB creation peak is inherent to FP32 weight loading; the structural mitigation (FP16 weights) belongs to the CUDA validation phase, not the CPU session-option space.

## Raw result files (temporary root)

`results/final-report.md` (raw samples, aggregate metrics, limitations), `results/comparison.json`, `results/startup-{pytorch,direct}.json`, `results/throughput-direct-bs{1,8,16,32,64}.json`, `results/memory-{pytorch,direct}.json`, `results/session-options-summary.json`, `results/fixtures-comparison.json`, `results/environment.json`, plus NPZ captures and repo-state manifests.
