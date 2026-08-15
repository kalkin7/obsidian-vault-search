# ONNX / TensorRT embedding engine

`engine=onnx` replaces the default Sentence Transformers (PyTorch) embedding
backend with a direct ONNX Runtime path for `intfloat/multilingual-e5-base`.
Mean pooling and L2 normalization run inside the ONNX graph, so only the
`[N, 768]` sentence vectors leave the runtime (GPU or CPU).

On CUDA, `provider=auto` prefers the **TensorRT** execution provider when the
TensorRT runtime is installed; otherwise it falls back to the CUDA execution
provider. On an NVIDIA GPU with TensorRT installed this speeds up indexing by
roughly **3.6×** over the CUDA EP (see Performance). On CPU the provider
setting is ignored and the **CPU execution provider** is always used, which
gives a ~1.3–1.8 s cold start on the prototype machine.

`engine=onnx` is the default backend in 0.1.2. The plugin exposes the
TensorRT/CUDA provider options only when the running runtime actually reports
them as usable (status `capabilities`), so a CPU-only machine never shows
options it cannot run.

## Settings

- `engine`: `onnx` (default) | `pytorch`
  - `onnx` requires model `intfloat/multilingual-e5-base` and the derived
    pooled graph in the local snapshot (`onnx/model-pooled-normalized.onnx`).
  - `device=auto` resolves to CUDA when a CUDA-capable execution provider is
    available, otherwise CPU. `device=cpu` forces CPU; `device=cuda` requires
    a CUDA-capable execution provider.
- `provider` (used when `engine=onnx` runs on CUDA — `device=cuda`, or
  `device=auto` resolving to CUDA): `auto` (default) | `cuda` | `tensorrt`
  - `auto` resolves to TensorRT when it is actually usable, otherwise CUDA.
  - `cuda` forces the CUDA execution provider.
  - `tensorrt` requires TensorRT; errors are surfaced instead of falling back.

Changing `engine`, `provider`, the resolved (`effective_provider`), model,
prefixes, or normalization invalidates the index and triggers an atomic vector
rebuild. The effective provider is recorded in `index/metadata.json`, so an
environment change (e.g. TensorRT becomes unavailable) also invalidates the
index even when the config still says `provider=auto`.

Service status exposes `expected_provider` (the pre-load resolution from
config + runtime) and `effective_provider` (the EP the loaded session was
actually built with), so the settings tab shows what is really running rather
than only the configured value; a silent fallback appears as a mismatch
between the two.

## Derived model provisioning

`DirectE5Onnx` loads `onnx/model-pooled-normalized.onnx`, a derived graph that
appends masked mean pooling + L2 normalization to the published raw export.
The plugin's settings tab shows an **ONNX 파생 모델 준비** row with a
**파생 모델 생성** button when `engine=onnx` is selected and the derived graph
is missing (the button calls the backend `provision_onnx` method, which runs
in-process using the `onnx` package in the managed runtime and verifies the
result with onnxruntime). Provisioning is idempotent.

For manual provisioning on a machine without the plugin:

```powershell
python -X utf8 scripts/append_e5_pooling.py --model-dir "<snapshot dir>" --verify
```

The generation logic lives in `backend/vault_search/onnx_provision.py` and is
shared by the script and the plugin. It validates the E5 pooling/tokenizer
contract, requires the raw graph to have a single `last_hidden_state` output,
appends the pooling ops at opset 11, runs an onnxruntime parity check against
explicit numpy pooling (max diff < 1e-5), and atomically replaces the target
after verification. `onnx` and `onnxruntime` must be importable where
provisioning runs; both are part of the managed runtimes.

## TensorRT installation

TensorRT is an **optional** dependency. The CUDA runtime setup tries to install
`requirements-optional-tensorrt.txt` best-effort; a failed install only warns
and the CUDA execution provider remains the `engine=onnx` fallback. An
existing managed runtime picks the new dependency up after the next runtime
regeneration (backend 0.1.1+ records a `deps_hash` in `.complete.json` and
rebuilds when the requirements change).

On Windows, ORT resolves the TRT DLLs through `PATH` (prepended once to the
service process); `os.add_dll_directory` does not work for ORT's TRT loader.
DLL discovery is limited to the interpreter's site-packages.

## Engine cache

TRT engines are cached on disk under `dataDir/trt-cache/<key>/`. The key
includes the ONNX path, ORT and TRT versions, and the batch profile, so a
model snapshot, runtime upgrade, or batch change builds a fresh engine instead
of reusing a stale one. The first build takes ~30 s; cached loads take ~5 s.
The cache is capped at 6 GB (oldest directories are evicted, the active one is
kept).

## Performance

GPU (RTX 5060 Ti, Blackwell sm_120, 16 GB, `onnxruntime-gpu 1.25.1` +
`tensorrt 10.16.1.11`, real corpus of 8,420 chunks, avg ~290 chars):

| Engine | Indexing cps (batch 32) | Quality vs CUDA FP32 |
| --- | ---: | ---: |
| CUDA FP32 (unfused) | 122 | baseline |
| TensorRT FP32 | 413–437 | cosine ≥ 0.99998, recall@40 22/39 unchanged |
| TensorRT FP16 | ~1,549 | cosine ~0.997 (not the default) |

CPU (i7-14700K, `onnxruntime 1.25.1`, measured 2026-08-13):

| Measurement | Value |
| --- | ---: |
| Cold process through first encode | 1.67–1.80 s (median ~1.77 s) |
| Warm query batch-1 encode | ~0.01 s |
| Embedding parity vs PyTorch CPU | cosine 1.00000000 (max abs diff ~2e-7) |

`bf16` was evaluated and rejected: ORT 1.25 CUDA lacks bf16 kernels for the
attention/layer-norm/embedding ops.

## Validation

- `verify-onnx.py`: device=cuda, 2,866 files / 8,420 chunks, search returns
  expected results.
- `verify-idle-unload.py`: ready → idle → reload, including the TRT session
  VRAM release.
- Backend pytest suite covers provider resolution (CPU/CUDA/TRT),
  silent-fallback handling, CUDA primary enforcement, cache keying/quota,
  runtime capabilities reporting, and metadata rebuild gates.
