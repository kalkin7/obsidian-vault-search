# Direct ONNX Runtime CUDA Validation Plan (2026-08-12)

## 1. Objective

Validate the direct ONNX Runtime embedding path on a machine with NVIDIA hardware, extending the CPU-only prototype (`docs/direct-onnx-runtime-prototype-summary-2026-08-12.md`). The prototype's quality gates already pass on CPU; this plan verifies that the same direct path preserves behavior on a CUDA GPU and quantifies GPU-specific performance, system memory, and VRAM.

Primary comparison: **PyTorch CUDA FP32 vs direct ONNX CUDA FP32**.

Secondary experiment (optional): **direct ONNX CUDA FP16**, to measure the structural VRAM reduction that the CPU session-option experiment identified as the only path below the FP32 weight-load floor.

The validation is a prototype experiment. It must not modify the repository, production backend, plugin settings, managed runtimes, LocalAppData machine configuration, or the production vector index. All artifacts live under the target machine's temporary root.

## 2. CPU prototype context (baseline to beat or preserve)

Measured on the prototype machine (Intel i7-14700K, Windows 11):

| Metric | PyTorch CPU | Direct CPU |
|---|---:|---:|
| Cold median startup | 4.626 s | 1.726 s |
| Warm query batch-1 p50 | 0.0150 s | 0.0083 s |
| Encode 8,419 docs, batch 32 | 20.9 cps | 24.8 cps |
| System RAM steady state | 1.60 GB | 2.23 GB |
| System RAM session-load peak | 0.83 GB | 2.49 GB |
| Min cosine vs reference | — | 0.9999998 |
| Recall@40 | 22/39 | 22/39 |

All CPU quality gates passed (min cosine >= 0.99999, token IDs identical, top-40 overlap 100%, recall >= 22/39). The CUDA plan reuses the same methodology and gates. CUDA cold startup on either backend is expected to be faster than CPU because GPU inference removes the CPU graph execution; the mandatory gate is still **direct CUDA median startup < PyTorch CUDA median startup**.

## 3. Safety boundaries

- All prototype code and artifacts live under the target machine's temporary root (e.g. `%LOCALAPPDATA%\Temp\opencode\direct-e5-cuda\`). Copy the prototype scripts there; do not run them from inside the repository.
- Do not write to: the repository, the K_Notes vault, `.obsidian/plugins/obsidian-vault-search`, `%LOCALAPPDATA%\ObsidianVaultSearch\runtime`, `...\vaults\...\index`, `machine.json`, `service-config.json`, or `runtime.json`.
- Open the target machine's `chunks.db` read-only (`mode=ro` + `PRAGMA query_only=ON`) only during corpus-manifest capture; after capture, both backends consume only the immutable manifest and must not reopen the production DB.
- Do not call plugin commands that rebuild, reconcile, modify settings, or install a runtime.
- The direct process must fail rather than silently import or fall back to CPU: assert `torch`/`sentence_transformers`/`transformers`/`optimum` are not importable, and require `CUDAExecutionProvider` in `session.get_providers()` with CPU fallback disabled during validation runs.
- Do not commit any temporary venv, model, NPZ, report, or corpus content.

## 4. Environment and prerequisites (target NVIDIA machine)

Record everything in an `environment.json` before measuring:

| Item | Required check |
|---|---|
| OS / arch | e.g. Windows 11 or Linux x86_64 |
| GPU | `nvidia-smi` — model, compute capability, total VRAM, driver version |
| CUDA runtime | `nvcc --version` and/or driver-reported CUDA version |
| cuDNN | version compatible with the chosen `onnxruntime-gpu` |
| Python | same 3.13 line as the prototype (or note the delta) |
| `torch` CUDA build | `torch.cuda.is_available()` must be `True` for the PyTorch baseline |
| Model snapshot | `intfloat/multilingual-e5-base` snapshot must exist locally (inference never downloads); record the snapshot revision and file hashes |
| Corpus | capture the target machine's `chunks.db` manifest read-only (8,419 chunks on the prototype machine; record the actual count) |
| Goldset/cases | from `9_System/search-benchmark/` in the K_Notes vault |

### onnxruntime-gpu selection

- The CPU prototype used `onnxruntime 1.25.1`. For CUDA, install `onnxruntime-gpu` whose documented CUDA/cuDNN requirements match the target machine's installed CUDA/cuDNN. If CUDA/cuDNN is installed to match, prefer `onnxruntime-gpu 1.25.1` so behavior stays close to the CPU prototype.
- Preflight fails if `CUDAExecutionProvider` is not available after install.

### System RAM / VRAM tooling

- System RAM: reuse `win_mem.py` on Windows (ctypes, no psutil dependency) or `psutil` on Linux.
- VRAM: use `pynvml` (`nvidia-ml-py`) to sample per-process GPU memory, or `nvidia-smi --query-compute-apps=pid,used_memory --format=csv`. Record both total-GPU used and per-process used where available.

## 5. Mandatory gates

| Gate | Required result |
|---|---|
| Fixture min cosine (direct CUDA vs pytorch CUDA) | >= 0.99999 |
| Fixture token IDs / attention masks | identical |
| Pure-vector gold recall@40 | >= 22/39 |
| Mean top-40 unique-file overlap | >= 99% |
| Direct CUDA median cold startup | faster than PyTorch CUDA median |
| Provider assignment | `CUDAExecutionProvider` actually executes (no CPU fallback; GPU utilization observed during inference) |
| System RAM increase | reported; >20% vs PyTorch CUDA requires explicit justification |
| VRAM | reported for both backends; >20% increase requires explicit justification |

If FP16 is tested, its quality gate is **evidence-based**: report the achieved min cosine vs the FP32 reference; do not relax `0.99999` without a stable, documented deviation from the official FP16 export.

## 6. Setup

Create an isolated venv without `--system-site-packages` and install only:

```text
numpy==2.4.4
tokenizers==0.22.2
onnxruntime-gpu==<compatible>   # 1.25.1 preferred if CUDA/cuDNN match
psutil                          # Linux; optional on Windows
nvidia-ml-py                    # for VRAM sampling
```

Do not install Sentence Transformers, Transformers, Optimum, or Hugging Face Hub. PyTorch is used only as the reference backend in the managed venv and must be a CUDA build.

Verify isolation and provider availability:

```powershell
python -c "import importlib.util; print({n: importlib.util.find_spec(n) for n in ['torch','sentence_transformers','transformers','optimum']})"
python -c "import onnxruntime as ort; print(ort.get_available_providers())"   # must include CUDAExecutionProvider
```

All values for the four forbidden names must be `None`; the provider list must include `CUDAExecutionProvider`.

## 7. Phase A — Provider and runtime validation

1. Build `DirectE5Onnx(model_dir, provider="CUDAExecutionProvider")`.
2. Assert `session.get_providers()` contains `CUDAExecutionProvider` and the session was not created with a CPU fallback chain during validation.
3. Run one inference while sampling `nvidia-smi` GPU utilization; confirm GPU utilization > 0 (proves execution is on GPU, not silent CPU).
4. Record provider list, device name, and used VRAM after inference.

## 8. Phase B — Fixture parity

Reuse the same deterministic `fixtures.json` (18 batches / 113 items, batch sizes 1/2/31/32/33, 512-token boundary and over-512 cases).

1. Capture reference with the managed venv: `SentenceTransformer(str(model_dir), device="cuda", local_files_only=True)`, `normalize_embeddings=True`.
2. Capture candidate with the direct venv: `DirectE5Onnx(..., provider="CUDAExecutionProvider")`.
3. Compare via `compare_backends.py --mode fixtures`: token IDs (padded + trimmed), cosine, max/mean abs diff, norms, NaN/inf.

Mandatory fixture gate: min cosine >= 0.99999, no NaN/inf, identical tokens, identical shapes/order. Stop if it fails; do not proceed to the corpus.

## 9. Phase C — Corpus and retrieval parity

1. Capture one immutable corpus manifest from the target machine's `chunks.db` (read-only, query-only, generation checked before/after, aggregate hash).
2. Both backends encode the full corpus independently in separate processes (never concurrently), GPU batch size **64** (the production GPU setting) in addition to 32.
3. Compute retrieval parity exactly as the CPU prototype: normalized dot product, stable tie-break by chunk id, unique-file collapse, top-10/top-40 overlap, per-case gold hits, rank changes.

Mandatory corpus gates: min cosine >= 0.99999, mean top-40 overlap >= 99%, recall >= 22/39, no per-case gold regression, no case with fewer than 40 unique files.

## 10. Phase D — Cold startup (CUDA)

Cold startup = new process from launch through completion of one normalized query encode, including CUDA context initialization.

- At least 10 sequential, non-concurrent samples per backend, alternating order (PyTorch, Direct, Direct, PyTorch, …).
- Report stage timings: `import torch`, `import sentence_transformers`, `cuda_is_available`, model construction (CUDA), first encode; and for direct: `import onnxruntime-gpu`, tokenizer load, session creation, first encode.
- Report median, p95, min, max, and every raw sample.
- Mandatory gate: direct CUDA median < pytorch CUDA median. Recommend the same adoption threshold as CPU (>= 20% or >= 1.0 s median reduction).
- Document that cold starts use uncontrolled OS file cache.

## 11. Phase E — Warm query latency

After one warmup encode, 100 batch-1 encodes of the 12 benchmark queries in the same process. Report p50/p95 per backend. This is supporting evidence (production end-to-end warm search is already ~0.12 s).

## 12. Phase F — Bulk throughput

Encode the full corpus at batch sizes 1, 8, 16, 32, and **64** (production GPU batch). Record duration, chunks/s, peak system RSS, peak VRAM, and any batch-specific failure per backend. Use batch 64 for the headline GPU comparison; also record batch 32 so results map back to the CPU prototype.

## 13. Phase G — System RAM validation

Measure at these points in isolated processes (one per backend):

1. After imports
2. After tokenizer load
3. After model/session load (record peak here — this is where CPU showed the largest direct-vs-pytorch gap)
4. After first encode
5. During full-corpus batch encoding (peak)
6. After encoding and GC

Use `win_mem.py` (Windows) or `psutil` (Linux): RSS and private bytes. Report peak and steady-state. An increase >20% vs the PyTorch CUDA baseline requires explicit justification. On CUDA, model weights live in VRAM, so the system-RAM gap between backends is expected to shrink relative to the CPU prototype — this is itself a finding to report.

## 14. Phase H — VRAM validation

Sample GPU memory at the same points as Phase G, using `pynvml` per-process and/or `nvidia-smi --query-compute-apps`. Record:

| Point | PyTorch CUDA FP32 | Direct CUDA FP32 | Direct CUDA FP16 (if tested) |
|---|---:|---:|---:|
| After imports | | | |
| After session/model load (peak) | | | |
| After first encode | | | |
| During corpus encode (peak) | | | |
| After GC / released | | | |
| Steady state | | | |

Also record: total VRAM of the GPU, baseline GPU usage from other processes, and whether VRAM is shared with the display. Report peak VRAM for both backends; a >20% increase requires explicit justification. Expected finding to verify: direct ONNX CUDA FP32 and PyTorch CUDA FP32 should hold the same ~1.1 GB of weights in VRAM, so the peak gap should be much smaller than the CPU system-RAM gap; FP16 (if tested) should roughly halve weight VRAM.

## 15. Phase I — Optional FP16 experiment

Structural VRAM reduction was deferred to this phase by the CPU prototype. If performed:

1. Produce an FP16 ONNX model (e.g., `onnxconverter_common.float16` or an official FP16 export) under the temporary root. Record its file hash and revision.
2. Encode the fixture set and a corpus subset; compare to the FP32 CUDA reference.
3. Report min/mean cosine, max abs diff, and recall. Set the quality gate from evidence — do not assume 0.99999 holds for FP16.
4. Measure VRAM and throughput deltas vs FP32 CUDA.
5. Decide separately whether FP16 is acceptable for production (persisted-format and metadata implications).

## 16. Result interpretation

| Quality | Startup | Throughput | VRAM/RAM | Decision |
|---|---|---|---|---|
| Pass | Meaningfully faster | Faster or equal | Acceptable or justified | Candidate for production CUDA design |
| Pass | Slower or equal | Faster | Acceptable | Keep PyTorch CUDA default; optional bulk-only backend at most |
| Fail | Any | Any | Any | Reject direct CUDA and diagnose parity issue |

A pass authorizes a separate production CUDA integration plan; it does not authorize production deployment.

## 17. Deliverables (temporary root)

```text
%LOCALAPPDATA%\Temp\opencode\direct-e5-cuda\   (or equivalent temp root on the target machine)
  venv\
  direct_e5_onnx.py, common.py, win_mem.py
  capture_backend.py, compare_backends.py
  capture_corpus.py, benchmark_backend.py
  startup_benchmark.py, throughput_benchmark.py, memory_profile.py, warm_query.py
  fixtures.json
  results\
    environment.json            # GPU, driver, CUDA, cuDNN, packages, VRAM total, git commit, model hashes
    gpu-provider.json           # provider list, device, utilization evidence
    corpus-manifest.jsonl + corpus-manifest-metadata.json
    pytorch-cuda-fixtures.npz / direct-cuda-fixtures.npz / fixtures-comparison.json
    pytorch-cuda-corpus.npz / direct-cuda-corpus.npz / comparison.json
    startup-pytorch-cuda.json / startup-direct-cuda.json
    warm-query-*.json
    throughput-*.json           # batch 1,8,16,32,64
    memory-pytorch-cuda.json / memory-direct-cuda.json
    vram-pytorch-cuda.json / vram-direct-cuda.json
    fp16-*.json                 # if Phase I runs
    final-report.md
```

After all measurements, capture repository `git status --porcelain` and a file manifest before/after; both pairs must be byte-for-byte identical (allowing only pre-approved user changes, as with the CPU prototype). Do not copy temporary venv, model, NPZ, or corpus content into Git.

## 18. Failure handling

- **Provider unavailable**: reinstall a matching `onnxruntime-gpu` or correct CUDA/cuDNN; do not proceed with CPU fallback.
- **Token mismatch**: compare post-processor, truncation side/length, padding side/pad ID, normalization, and one minimal failing fixture (same checklist as CPU prototype §14).
- **Cosine below threshold**: confirm output selection, mask pooling, float32, L2 axis/epsilon, and that both backends used the same snapshot. Do not relax 0.99999 without evidence.
- **Recall/overlap regression**: check stable tie handling, boundary scores, unique-file collapse, path normalization; review every lost expected file.
- **VRAM exhaustion**: reduce batch size, stream result batches, record the failure and peak VRAM/RSS; do not load both backends concurrently.
- **FP16 quality failure**: fall back to FP32 CUDA; report FP16 as rejected for parity without a documented model-side fix.

## 19. Completion checklist

- [ ] GPU, driver, CUDA, cuDNN, and onnxruntime-gpu compatibility recorded and compatible
- [ ] Direct venv contains no PyTorch, Sentence Transformers, Transformers, Optimum, or Hub
- [ ] `CUDAExecutionProvider` is used for inference (GPU utilization observed, no CPU fallback)
- [ ] Exact model revision and file hashes recorded
- [ ] One immutable corpus manifest captured read-only; both backends consumed the same aggregate hash
- [ ] Fixture tokens identical; min fixture cosine >= 0.99999
- [ ] Full corpus encoded by both backends (batch 64 and 32); min cosine >= 0.99999
- [ ] Mean top-40 overlap >= 99%; direct recall@40 >= 22/39; no per-case regression
- [ ] >= 10 sequential startup samples per backend; direct CUDA median faster than PyTorch CUDA median
- [ ] Warm query p50/p95 recorded
- [ ] System RAM measured at all six points; >20% increase justified
- [ ] VRAM measured at all points for both backends; >20% increase justified; FP16 VRAM delta reported if run
- [ ] Production repository, runtime, settings, and index unchanged (repo manifests byte-for-byte identical)
- [ ] `results/final-report.md` records raw samples, aggregates, limitations, and the decision

## 20. Reference

- CPU prototype plan: `docs/direct-onnx-runtime-prototype-plan-2026-08-12.md`
- CPU prototype summary: `docs/direct-onnx-runtime-prototype-summary-2026-08-12.md`
- Prototype raw data (on the prototype machine): `%LOCALAPPDATA%\Temp\opencode\direct-e5-onnx\`
