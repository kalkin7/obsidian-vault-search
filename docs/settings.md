# Settings

Portable settings are stored in plugin `data.json`. The Python executable is machine-local and stored in `%LOCALAPPDATA%/ObsidianVaultSearch/vaults/<vault-id>/machine.json`.

- Search top-k, RRF, `maxChunksPerFile`, `titleRrfWeight`, and `prefixFallback` changes are hot-applied.
- `maxChunksPerFile` defaults to 1 to maximize distinct-file coverage for agent retrieval.
- `titleRrfWeight` is the independent title retrieval channel weight; 0 disables the channel so only body/vector candidates remain.
- `prefixFallback` retries FTS5 with token prefixes only when exact BM25 returns no results.
- Include/exclude changes are hot-applied and reconciled.
- Model, device, engine, provider, prefixes, and normalization trigger an atomic vector rebuild.
- `engine` selects the embedding backend: `onnx` (default) or `pytorch`. `onnx` is a direct ONNX Runtime path for the `intfloat/multilingual-e5-base` model and runs on CPU or CUDA; see [ONNX / TensorRT engine](onnx-tensorrt-engine.md).
- `device` is `auto` (default), `cpu`, or `cuda`. With `engine=onnx`, `auto` uses CUDA when a CUDA-capable execution provider exists and CPU otherwise.
- `provider` (used only when `engine=onnx` and `device=cuda`) is `auto` (default), `cuda`, or `tensorrt`. `auto` prefers TensorRT when installed and falls back to the CUDA EP. The plugin exposes only the provider options the running runtime reports as usable (status `capabilities`). See [ONNX / TensorRT engine](onnx-tensorrt-engine.md).
- `chunkingStrategy` defaults to `paragraph-v1`, which preserves the original paragraph chunker.
- `markdown-v2` keeps Markdown headings as embedding breadcrumbs and groups fences, tables, lists, and callouts at atom boundaries.
- Changing the chunking strategy, chunk size, or overlap triggers an atomic complete rebuild.
- Failed rebuilds restore the previous settings and index.
- Startup reconciliation uses fast mode: unchanged path, size, and nanosecond mtime tuples do not cause body reads.
- The manual **정밀 대조** action uses strict mode and hashes every current file.
- Interrupted incremental updates are replayed from the local pending-path journal when the backend starts.
- Only one backend may own a vault data directory. Startup waits for the prior managed process to stop and refuses a duplicate writer.

Paths are vault-relative POSIX-style globs. Absolute paths and traversal are rejected by the backend.
