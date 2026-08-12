# ONNX / TensorRT embedding engine

`engine=onnx` replaces the default Sentence Transformers (PyTorch) embedding
backend with a direct ONNX Runtime path for `intfloat/multilingual-e5-base`.
Mean pooling and L2 normalization run inside the ONNX graph, so only the
`[N, 768]` sentence vectors leave the GPU.

With `provider=auto`, the ONNX engine prefers the **TensorRT** execution
provider when the TensorRT runtime is installed; otherwise it falls back to
the CUDA execution provider. On an NVIDIA GPU with TensorRT installed this
speeds up indexing by roughly **3.6×** over the CUDA EP (see Performance).

## Settings

- `engine`: `pytorch` (default) | `onnx`
  - `onnx` requires `device=cuda` and model `intfloat/multilingual-e5-base`.
  - The derived pooled graph must exist in the local snapshot
    (`onnx/model-pooled-normalized.onnx`).
- `provider` (used only when `engine=onnx`): `auto` (default) | `cuda` | `tensorrt`
  - `auto` resolves to TensorRT when it is actually usable, otherwise CUDA.
  - `cuda` forces the CUDA execution provider.
  - `tensorrt` requires TensorRT; errors are surfaced instead of falling back.

Changing `engine`, `provider`, the resolved (`effective_provider`), model,
prefixes, or normalization invalidates the index and triggers an atomic vector
rebuild. The effective provider is recorded in `index/metadata.json`, so an
environment change (e.g. TensorRT becomes unavailable) also invalidates the
index even when the config still says `provider=auto`.

## TensorRT installation

TensorRT is an **optional** dependency. The CUDA runtime setup tries to install
`requirements-optional-tensorrt.txt` best-effort; a failed install only warns
and the CUDA execution provider remains the `engine=onnx` fallback. An
existing managed runtime picks the new dependency up after the next runtime
regeneration (backend version 0.1.1 records a `deps_hash` in
`.complete.json` and rebuilds when the requirements change).

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

Measured on an RTX 5060 Ti (Blackwell sm_120, 16 GB), `onnxruntime-gpu 1.25.1`
+ `tensorrt 10.16.1.11`, real corpus of 8,420 chunks (avg ~290 chars):

| Engine | Indexing cps (batch 32) | Quality vs CUDA FP32 |
|---|---:|---:|
| CUDA FP32 (unfused) | 122 | baseline |
| TensorRT FP32 | 413–437 | cosine ≥ 0.99998, recall@40 22/39 unchanged |
| TensorRT FP16 | ~1,549 | cosine ~0.997 (not the default) |

`bf16` was evaluated and rejected: ORT 1.25 CUDA lacks bf16 kernels for the
attention/layer-norm/embedding ops.

## Validation

- `verify-onnx.py`: device=cuda, 2,866 files / 8,420 chunks, search returns
  expected results.
- `verify-idle-unload.py`: ready → idle → reload, including the TRT session
  VRAM release.
- Backend pytest suite covers provider resolution, silent-fallback handling,
  CUDA primary enforcement, cache keying/quota, and metadata rebuild gates.
