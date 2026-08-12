# Direct ONNX Runtime Prototype Plan (2026-08-12)

## 1. Objective

Build and evaluate a CPU-only prototype that runs `intfloat/multilingual-e5-base` directly through `onnxruntime` and `tokenizers`, without importing any of these packages:

- `torch`
- `sentence_transformers`
- `transformers`
- `optimum`

The prototype must answer one question before any production integration begins:

> Can a direct FP32 ONNX path preserve the current PyTorch embedding and retrieval behavior while reducing cold startup time and improving bulk embedding throughput?

The experiment passes only if all mandatory gates below pass:

| Gate | Required result |
|---|---:|
| Minimum cosine similarity to PyTorch | `>= 0.99999` |
| Pure-vector gold recall@40 | `>= 22/39` |
| Mean top-40 unique-file overlap | `>= 99%` |
| Cold process through first encode | Faster than the paired PyTorch baseline |
| Direct runtime imports | No PyTorch, Sentence Transformers, Transformers, or Optimum |

The prototype is exploratory. It must not modify the repository, production backend, plugin settings, managed runtimes, LocalAppData machine configuration, or production vector index. Its results report remains under the temporary root. Copying a reviewed result summary into the repository is a separate follow-up task that requires explicit user approval.

## 2. Why This Experiment Exists

The existing production path is:

```text
Vault Search
  -> ModelManager
  -> Sentence Transformers
  -> Transformers
  -> PyTorch
  -> multilingual-e5-base
```

Cached PyTorch loading is already optimized with `local_files_only=True` and an online retry only for a real Hugging Face cache miss. Typical cold startup through the first query encode is about 4.7 seconds, with occasional 6-7 second runs caused mainly by Windows DLL and package loading variance.

The previous FP32 ONNX experiment used the high-level Sentence Transformers ONNX backend:

```text
Vault Search experiment
  -> Sentence Transformers
  -> Transformers
  -> Optimum
  -> PyTorch import
  -> ONNX Runtime
  -> multilingual-e5-base ONNX
```

That experiment preserved quality and improved throughput, but cold startup became slower because it retained the expensive PyTorch/Sentence Transformers import graph and added ONNX Runtime session creation.

Measured results from that experiment:

| Metric | PyTorch FP32 | Sentence Transformers ONNX FP32 |
|---|---:|---:|
| Cold process through first encode | 4.73-4.85 s | 7.78-8.07 s |
| Encode 8,419 chunks, batch 32 | 371.754 s | 279.208 s |
| Encode 12 queries, batch 1 | 0.167 s | 0.120 s |
| Pure-vector recall@40 | 22/39 | 22/39 |
| Mean top-40 unique-file overlap | N/A | 99.79% vs PyTorch |

Detailed evidence is in `docs/embedding-backend-benchmark-2026-08-12.md`.

The direct prototype removes the high-level packages from the ONNX process so the experiment can test the actual lower bound:

```text
Direct prototype
  -> tokenizers
  -> ONNX Runtime
  -> multilingual-e5-base ONNX
  -> explicit mean pooling
  -> explicit L2 normalization
```

## 3. Current Production Contract

The prototype must reproduce the behavior exposed by `backend/vault_search/model_manager.py`:

```python
class ModelManager:
    def load(self) -> None: ...
    def encode_query(self, query: str) -> np.ndarray: ...
    def encode_documents(self, texts: list[str], show_progress: bool = False) -> np.ndarray: ...
```

Important production behavior:

- Model ID: `intfloat/multilingual-e5-base`
- Embedding dimension: 768
- Query prefix: `query: `
- Document prefix: `passage: `
- Normalization: enabled
- CPU document batch size: 32
- GPU document batch size: 64
- Query result shape: always two-dimensional through `np.atleast_2d`
- Document result dtype: `np.float32`
- The production model and backend remain resident in the sidecar process after Obsidian startup.

The index metadata contract is defined by `backend/vault_search/index_metadata.py`. It currently records model ID, dimension, normalization, prefixes, chunk settings, and tokenizer version, but not the embedding execution backend. This is acceptable for a read-only parity prototype. Production integration must revisit whether an `embedding_implementation` or equivalent metadata field is required.

## 4. Verified E5 Model Contract

Do not infer pooling or tokenization behavior from generic E5 examples. Use the files in the exact cached model snapshot and assert their values before running the benchmark.

Verified model files and values:

### `modules.json`

```text
0: sentence_transformers.models.Transformer
1: sentence_transformers.models.Pooling
2: sentence_transformers.models.Normalize
```

### `1_Pooling/config.json`

```json
{
  "word_embedding_dimension": 768,
  "pooling_mode_cls_token": false,
  "pooling_mode_mean_tokens": true,
  "pooling_mode_max_tokens": false,
  "pooling_mode_mean_sqrt_len_tokens": false
}
```

### `sentence_bert_config.json`

```json
{
  "max_seq_length": 512,
  "do_lower_case": false
}
```

### Tokenizer contract

- Class: XLM-RoBERTa tokenizer
- BOS/CLS token: `<s>`
- EOS/SEP token: `</s>`
- Padding token: `<pad>`
- Unknown token: `<unk>`
- Maximum sequence length: 512 tokens including special tokens
- Lowercasing: disabled

The implementation must load `tokenizer.json` through the Rust-backed `tokenizers` package. It must not import `AutoTokenizer`, Transformers, or Sentence Transformers.

### ONNX model contract

Published FP32 file: `onnx/model.onnx`

Verified inputs:

| Name | Type | Shape |
|---|---|---|
| `input_ids` | `int64` | `[batch_size, sequence_length]` |
| `attention_mask` | `int64` | `[batch_size, sequence_length]` |

Verified output:

| Name | Type | Shape |
|---|---|---|
| `last_hidden_state` | `float32` | `[batch_size, sequence_length, 768]` |

There is no `token_type_ids` input.

### Pooling and normalization contract

For hidden states `H` and attention mask `M`:

```python
mask = attention_mask[..., None].astype(np.float32)
summed = (last_hidden_state * mask).sum(axis=1)
counts = np.clip(mask.sum(axis=1), 1e-9, None)
embeddings = summed / counts
```

When normalization is enabled:

```python
norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
embeddings = embeddings / np.clip(norms, 1e-12, None)
```

Return contiguous `np.float32` arrays. Do not use CLS pooling, max pooling, mean-sqrt-length pooling, or unnormalized vectors.

## 5. Safety Boundaries

### Phase A: prototype boundaries

All prototype code and generated artifacts must live under the approved temporary root:

```text
%LOCALAPPDATA%\Temp\opencode\direct-e5-onnx\
```

The prototype may read during one snapshot-capture step:

- The Hugging Face model cache
- The production `chunks.db`
- `9_System/search-benchmark/cases.local.json`
- `9_System/search-benchmark/goldset.local.json`

The prototype must not write to any of these locations, with no exceptions during this task:

- The repository
- The K_Notes vault
- `.obsidian/plugins/obsidian-vault-search`
- `%LOCALAPPDATA%\ObsidianVaultSearch\runtime`
- `%LOCALAPPDATA%\ObsidianVaultSearch\vaults\...\index`
- `machine.json`, `service-config.json`, or `runtime.json`

Open `chunks.db` read-only using a SQLite URI and force query-only mode:

```python
connection = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
connection.execute("PRAGMA query_only=ON")
```

Do not call plugin commands that rebuild, reconcile, modify settings, or install a runtime during the prototype. After snapshot capture, both backends must consume only that immutable temporary snapshot and must not reopen production `chunks.db`.

### No hidden fallback

The direct prototype must fail rather than silently import or invoke the production stack. At process startup, assert:

```python
for name in ("torch", "sentence_transformers", "transformers", "optimum"):
    assert importlib.util.find_spec(name) is None
```

After inference, also assert those names are absent from `sys.modules`.

Create a normal isolated venv. Do not use `--system-site-packages`, because that can expose user-level PyTorch and invalidate the experiment.

## 6. Deliverables

The prototype phase should create these temporary files:

```text
%LOCALAPPDATA%\Temp\opencode\direct-e5-onnx\
  venv\
  direct_e5_onnx.py
  capture_corpus.py
  capture_backend.py
  benchmark_backend.py
  compare_backends.py
  fixtures.json
  results\
    environment.json
    corpus-manifest.jsonl
    corpus-manifest-metadata.json
    pytorch-fixtures.npz
    direct-fixtures.npz
    pytorch-corpus.npz
    direct-corpus.npz
    startup-pytorch.json
    startup-direct.json
    memory-pytorch.json
    memory-direct.json
    comparison.json
```

After all measurements and safety checks, write the permanent-for-this-experiment report under the temporary root:

```text
%LOCALAPPDATA%\Temp\opencode\direct-e5-onnx\results\final-report.md
```

Do not copy the temporary venv, model files, NPZ files, report, or corpus content into Git. Capture `git status --porcelain` and a repository file manifest before and after the experiment. Both pairs must be byte-for-byte identical. Promoting a reviewed summary to `docs/` is outside this task.

## 7. Phase 0: Preflight and Baseline Capture

### 7.1 Verify the repository and production state

From the repository root:

```powershell
git status --short
git log --oneline -5
$env:PYTHONDONTWRITEBYTECODE = "1"
python -X utf8 -m pytest -p no:cacheprovider backend/tests
npx tsc --noEmit --skipLibCheck
```

Do not run `npm run build` because it rewrites tracked `main.js`. Do not run Vitest in this task unless its cache/output paths are explicitly redirected outside the repository and verified; existing committed results already establish the pre-prototype baseline. Record the current Git commit, exact `git status --porcelain` bytes, and a manifest of every repository file path, size, and last-write timestamp. Do not discard, stage, or edit unrelated worktree changes.

Confirm the plugin is healthy without changing it:

```powershell
obsidian eval code="JSON.stringify(app.plugins.plugins['obsidian-vault-search']?.backend?.status)"
```

Expected state:

- `state` is `ready` or `ready_no_index`
- `model_id` is `intfloat/multilingual-e5-base`
- `dimension` is 768
- file and chunk counts are available

### 7.2 Resolve paths dynamically

Do not hardcode the Hugging Face snapshot hash or vault index hash in implementation code.

Required path inputs:

- `--model-dir`: exact local snapshot directory containing `tokenizer.json`, `modules.json`, `1_Pooling/config.json`, and `onnx/model.onnx`
- `--db`: exact production `chunks.db` path, opened read-only
- `--cases`: K_Notes benchmark cases JSON
- `--gold`: K_Notes gold set JSON
- `--output`: experiment artifact path under the temporary root

For this machine, the snapshot can be discovered under:

```text
%USERPROFILE%\.cache\huggingface\hub\models--intfloat--multilingual-e5-base\snapshots\*
```

If multiple snapshots exist, select the revision referenced by the current `refs/main`, resolve it to one snapshot, and record that revision in `environment.json`.

Fail preflight if any required model file is missing. The direct inference process itself must not download files or call Hugging Face APIs.

Resolve the production managed Python from machine configuration or plugin runtime inspection instead of assuming a path. Use that exact executable to create the direct venv without `--system-site-packages`. This keeps the Python implementation and build equal while isolating installed packages.

### 7.3 Record exact environment

Record at least:

- Timestamp
- OS and architecture
- Python version for each venv
- CPU model and logical processor count
- Total RAM
- Git commit
- Model ID and snapshot revision
- File sizes and SHA-256 hashes for `tokenizer.json`, `onnx/model.onnx`, and `model.safetensors`
- Production package versions
- Direct prototype package versions
- Corpus file and vector chunk counts
- Benchmark case and expected-file counts

Hashes are important. Backend comparisons are invalid if they use different model revisions.

## 8. Phase 1: Isolated Direct Runtime

### 8.1 Create the venv

Verify the temporary parent exists before creating files or directories.

```powershell
Test-Path -LiteralPath "$env:LOCALAPPDATA\Temp\opencode"
& "<production managed python>" -X utf8 -m venv `
  "$env:LOCALAPPDATA\Temp\opencode\direct-e5-onnx\venv"
```

Install only the direct runtime dependencies:

```powershell
& "$env:LOCALAPPDATA\Temp\opencode\direct-e5-onnx\venv\Scripts\python.exe" `
  -X utf8 -m pip install `
  "numpy==2.4.4" `
  "tokenizers==0.22.2" `
  "onnxruntime==1.25.1" `
  "psutil"
```

Do not install Sentence Transformers, Transformers, Optimum, PyTorch, Hugging Face Hub, or the Vault Search backend in this venv.

Verify isolation:

```powershell
& "$env:LOCALAPPDATA\Temp\opencode\direct-e5-onnx\venv\Scripts\python.exe" `
  -X utf8 -c "import importlib.util; print({n: importlib.util.find_spec(n) for n in ['torch','sentence_transformers','transformers','optimum']})"
```

All values must be `None`.

### 8.2 Implement `DirectE5Onnx`

Implement one small class in `direct_e5_onnx.py`:

```python
class DirectE5Onnx:
    def __init__(
        self,
        model_dir: Path,
        provider: str = "CPUExecutionProvider",
        normalize_embeddings: bool = True,
        max_seq_length: int = 512,
    ): ...

    def encode(self, texts: str | list[str], batch_size: int = 32) -> np.ndarray: ...
```

Constructor responsibilities:

1. Validate all required files.
2. Parse and validate `modules.json`, pooling config, and sentence-transformer config.
3. Reject any pooling configuration other than 768-dimensional attention-mask mean pooling followed by normalization.
4. Load `tokenizer.json` with `tokenizers.Tokenizer.from_file()`.
5. Preserve the post-processor embedded in `tokenizer.json` and call encode with `add_special_tokens=True`.
6. Configure right-side truncation to 512 tokens, including special tokens.
7. Configure right-side longest-in-batch padding with the tokenizer's actual `<pad>` ID and token.
8. Create one `onnxruntime.InferenceSession` for `onnx/model.onnx`.
9. Explicitly request `CPUExecutionProvider` for this phase.
10. Validate session input and output names, dtypes, and rank.
11. Expose `dimension = 768` and the active provider list.

Encoding responsibilities:

1. Preserve input order.
2. Accept either one string or a list of strings.
3. Call `encode_batch(..., add_special_tokens=True)` so the tokenizer-defined post-processor adds `<s>` and `</s>`.
4. Right-truncate to 512 tokens including special tokens.
5. Right-pad only to the longest item in each batch, capped at 512, using the actual `<pad>` ID.
6. Build contiguous `np.int64` `input_ids` and `attention_mask` arrays.
7. Run the ONNX session and select `last_hidden_state` by output name rather than assuming output position.
8. Apply masked mean pooling exactly as defined above.
9. Apply L2 normalization when enabled.
10. Return contiguous `np.float32` arrays.
11. Return shape `(1, 768)` for one string and `(N, 768)` for a list. This intentionally matches Vault Search's query-side two-dimensional contract, not Sentence Transformers' one-dimensional single-string convenience return.

Do not add model downloading, caching, revision resolution, CUDA support, index writes, or plugin integration in this phase.

## 9. Phase 2: Small Fixture Parity

Before encoding the entire corpus, prove exact behavioral parity on a diagnostic fixture set.

### 9.1 Fixture categories

Create at least 30 deterministic inputs covering:

- Empty string
- One Korean character
- Short Korean query
- Short Korean document
- English text
- Mixed Korean and English
- Numbers, dates, currency, and legal article notation
- Newlines and repeated whitespace
- Markdown headings, links, tags, and YAML-like text
- Emoji and non-BMP Unicode
- Very long Korean text below 512 tokens
- Text exactly at the 512-token boundary
- Text exceeding 512 tokens
- Duplicate texts in one batch
- Batch sizes 1, 2, 31, 32, and 33

Apply production prefixes before encoding:

- Query fixtures use `query: `
- Document fixtures use `passage: `

### 9.2 Capture the PyTorch reference

Use the production managed Python and its current Sentence Transformers model to create `pytorch-fixtures.npz`. The capture process must:

- Use `local_files_only=True`
- Use CPU
- Load the exact local snapshot with `SentenceTransformer(str(model_dir), device="cpu", local_files_only=True)`; loading by repository ID is not permitted
- Use `normalize_embeddings=True`
- Record token IDs and attention masks from the production tokenizer using the same input order, batch partition, right truncation, right longest-batch padding, 512-token limit, and special-token behavior as the direct implementation
- Record final embeddings as `float32`

Do not import the direct implementation in the reference process.

### 9.3 Compare tokenizer behavior first

Before comparing embeddings, compare:

- Input IDs
- Attention masks
- Effective sequence lengths
- Special token placement
- Truncation result
- Padding token IDs

Use the same deterministic batch partition for both token captures. Compare each sequence after trimming both representations to that item's attention-mask length to verify unpadded token identity, then separately compare the full padded batch arrays. This distinguishes a real tokenizer mismatch from padding caused by different batch composition.

Any tokenizer mismatch must be fixed before evaluating embedding cosine similarity. Do not compensate for a tokenizer mismatch by relaxing the cosine threshold.

### 9.4 Compare embeddings

For every fixture, calculate:

- Cosine similarity
- Maximum absolute element difference
- Mean absolute element difference
- Output norm
- Presence of NaN or infinity

Mandatory fixture gate:

- Minimum cosine similarity `>= 0.99999`
- No NaN or infinity
- Output norm within `1 +/- 1e-5`
- Identical output shape and order

Recommended stronger target for FP32:

- Mean cosine similarity `>= 0.999999`
- Maximum absolute difference documented and stable

Stop if the mandatory gate fails. Do not proceed to corpus benchmarking until the mismatch is explained and corrected.

## 10. Phase 3: Corpus and Retrieval Parity

### 10.1 Capture one immutable corpus snapshot

Read all rows with:

```sql
SELECT id, file_path, embedding_text
FROM chunks
WHERE lexical_only = 0
ORDER BY id
```

At the time of planning, this returned 8,419 rows. Record the actual count at execution time.

Capture the corpus exactly once from one read-only SQLite transaction into a temporary immutable manifest. The manifest must contain:

- Chunk ID
- Path normalized by trimming and replacing `\\` with `/`
- Exact `embedding_text`
- SHA-256 of each `embedding_text`
- Aggregate SHA-256 over ordered `(id, path, text_hash)` records
- SQLite `index_generation` from `index_metadata`
- Chunk count

Read `metadata.json` and SQLite `index_metadata` immediately before and after the transaction. Invalidate the capture if either index generation changes, the two metadata sources disagree, or the chunk count changes. Both PyTorch and direct ONNX processes must consume this same manifest and verify its aggregate hash. They must not independently query `chunks.db`.

Prefix every document with `passage: ` and every benchmark query with `query: `.

### 10.2 Produce independent artifacts

Run PyTorch and direct ONNX in separate processes and write:

- Ordered chunk IDs
- Ordered file paths
- Ordered case IDs
- Document vectors
- Query vectors
- Load time
- First encode time
- Total document encode time
- Total query encode time
- Peak RSS

Never load both 8,419-by-768 vector matrices and both model backends in the same process. Sequential processes reduce memory pressure and avoid contaminating timing measurements.

### 10.3 Exact retrieval comparison

Use normalized dot product over all document vectors. Do not use the production USEARCH index for this parity calculation because approximate-index behavior can hide or amplify tiny backend differences.

For each query:

1. Rank all chunks by descending dot product, breaking exact score ties by chunk ID ascending.
2. Collapse chunk results to unique file paths while preserving first occurrence.
3. Collect top 10 and top 40 unique files.
4. Compare PyTorch and direct ONNX sets and order.
5. Count expected gold files in top 40.

Aggregate metrics:

- Mean and minimum document-vector cosine similarity
- Mean and minimum query-vector cosine similarity
- Mean top-10 unique-file overlap
- Mean top-40 unique-file overlap
- Per-case top-10 and top-40 overlap
- PyTorch and direct ONNX gold recall@40
- Per-case gold hits
- Rank changes for expected files

Metric definitions are fixed:

- Normalize result and gold paths by trimming and replacing `\\` with `/`.
- Unique-file collapse keeps the first ranked chunk for each normalized path.
- Per-case top-10 overlap is `|PyTorch_top10 intersect Direct_top10| / 10`.
- Per-case top-40 overlap is `|PyTorch_top40 intersect Direct_top40| / 40`.
- Mean overlap is the arithmetic mean over all 12 cases.
- Gold recall counts `(case_id, expected_path)` pairs, not globally unique paths. The denominator is the 39 expected-file entries across all cases.
- If fewer than 40 unique files exist, treat the run as invalid instead of changing the denominator.

Mandatory corpus gates:

- Minimum cosine similarity across all document and query vectors `>= 0.99999`
- Mean top-40 unique-file overlap `>= 99%`
- Direct ONNX pure-vector recall@40 `>= 22/39`
- No case loses a gold hit unless another case gains enough to preserve 22/39 and the loss is manually reviewed

The last condition prevents a misleading aggregate pass that silently regresses an important case.

## 11. Phase 4: Performance and Memory Methodology

### 11.1 Cold startup definition

Cold startup means a new Python process from process launch through completion of one normalized query encode. It includes:

- Python interpreter startup
- Package imports
- Tokenizer loading
- Model or ONNX session creation
- First inference

It excludes:

- Model download
- Venv creation
- Package installation
- Index loading or search

Measure wall-clock time from the parent PowerShell process and internal stage times from Python. Record both.

### 11.2 Startup stages

The direct process must report:

- Import NumPy
- Import Tokenizers
- Import ONNX Runtime
- Validate files and configs
- Load tokenizer
- Create inference session
- First encode
- Total

The PyTorch reference must report:

- Import PyTorch
- Import Sentence Transformers
- CUDA availability check, even though the CPU baseline should select CPU
- Construct tokenizer and model
- First encode
- Total

### 11.3 Repetitions and ordering

Run at least 10 successful cold-process measurements per backend.

Alternate backend order to reduce systematic cache bias:

```text
PyTorch, Direct, Direct, PyTorch, PyTorch, Direct, ...
```

Do not run the two model processes concurrently. Parallel execution contaminates CPU, memory, and disk measurements.

Report:

- Median
- p95
- Minimum
- Maximum
- Every raw sample

Windows does not provide a simple portable way to guarantee a true empty filesystem cache without disruptive system operations. Call these measurements new-process cold starts with uncontrolled OS file cache, and document that limitation. Do not attempt destructive cache flushing.

Mandatory startup gate:

- Direct ONNX median total startup must be lower than PyTorch median total startup.

Recommended adoption threshold:

- At least 20% median reduction or at least 1.0 second absolute reduction

A statistically tiny win passes the experiment's mandatory gate but should not justify production complexity.

### 11.4 Warm query latency

After one warmup encode, run at least 100 query encodes in the same process. Report p50 and p95 for:

- Batch size 1
- The 12 benchmark queries

This is supporting evidence, not the primary adoption gate, because production end-to-end warm search is already about 0.12 seconds.

### 11.5 Bulk throughput

Encode the full corpus with batch sizes 1, 8, 16, 32, and 64 if memory permits. Record:

- Total duration
- Chunks per second
- Peak RSS
- Any batch-specific failure

Use batch size 32 for the direct comparison to the current CPU production setting.

### 11.6 Memory

Measure at these points in isolated processes:

1. Immediately after imports
2. After tokenizer load
3. After model/session load
4. After first encode
5. During full-corpus batch encoding
6. After encoding and garbage collection

Use process RSS through `psutil`. On Windows, also record private bytes when available. Do not infer memory from model file size alone.

Report peak and steady-state values. A memory increase is not an automatic failure, but an increase greater than 20% requires explicit justification.

## 12. Phase 5: Result Interpretation

Use this decision matrix:

| Quality | Startup | Throughput | Decision |
|---|---|---|---|
| Pass | Meaningfully faster | Faster or equal | Candidate for production design |
| Pass | Slightly faster | Much faster | Consider only if reindexing benefit justifies complexity |
| Pass | Slower or equal | Faster | Keep PyTorch default; optional bulk-only backend at most |
| Fail | Any | Any | Reject direct implementation and diagnose parity issue |

Do not claim production readiness after a prototype pass. A pass only authorizes a separate production integration plan.

## 13. Phase 6: Production Integration Plan, Only After Prototype Pass

Do not execute this phase in the prototype task. Write a new plan first.

Likely production changes:

### Backend interface

- Add an embedding backend preference such as `pytorch` or `onnx-direct`.
- Keep `ModelManager.encode_query()` and `encode_documents()` stable.
- Put direct ONNX logic in a separate module rather than combining both implementations into one long function.
- Preserve the fake model path used by tests.

### Model provisioning

- Download and validate `tokenizer.json`, pooling config, sentence config, and the exact FP32 ONNX file.
- Pin model revision or record file hashes.
- Use generation-based, completion-marker installation analogous to managed Python runtimes.
- Provide cache-miss download behavior without making the inference process contact the Hub.

### Runtime dependencies

- CPU direct runtime: NumPy, Tokenizers, ONNX Runtime, Kiwi, USEARCH, PyYAML.
- CUDA direct runtime: replace CPU ONNX Runtime with `onnxruntime-gpu` and validate `CUDAExecutionProvider` through actual inference.
- Decide whether PyTorch remains installed for fallback and CUDA DLL reuse or whether direct runtimes become truly PyTorch-free.

### Index compatibility

Even if parity is excellent, add an embedding implementation identifier and model revision/hash to index metadata before allowing backend switching. This avoids silently sharing an index across implementations after a future dependency or export change.

Changing that metadata may require vector rebuilds. Treat it as a persisted-format compatibility decision and review it before implementation.

### Settings and rollback

- Expose the backend only after runtime validation.
- Keep PyTorch as the rollback path.
- Switch settings only after model load and sample encode validation succeed.
- If activation or vector rebuild fails, restore the previous backend, settings, service, and index generation.

### CUDA validation

On a machine with NVIDIA hardware:

- Install `onnxruntime-gpu` compatible with the selected CUDA/cuDNN libraries.
- Require `CUDAExecutionProvider` in the session.
- Run inference with CPU fallback disabled during validation.
- Confirm provider assignment, GPU utilization, and VRAM use.
- Compare PyTorch CUDA FP32, direct ONNX CUDA FP32, and optionally direct ONNX CUDA FP16.
- Repeat quality, startup, throughput, and memory gates.

## 14. Failure Handling

### Token mismatch

If token IDs differ:

1. Compare special-token post-processing.
2. Compare truncation side and maximum length.
3. Compare padding side and pad ID.
4. Compare normalization and pre-tokenization settings from `tokenizer.json`.
5. Compare one minimal failing fixture.

Do not proceed until token IDs match.

### Cosine similarity below threshold

If tokens match but cosine similarity fails:

1. Confirm `last_hidden_state` output selection.
2. Confirm mask broadcasting and denominator.
3. Confirm padding tokens are excluded.
4. Confirm pooling uses float32.
5. Confirm L2 normalization axis and epsilon.
6. Confirm both backends use the same snapshot and FP32 model.

Do not relax `0.99999` without evidence that the official FP32 export itself has a stable, unavoidable deviation.

### Recall or overlap regression

If cosine passes but retrieval gates fail:

1. Check stable tie handling.
2. Compare exact scores around top-10 and top-40 boundaries.
3. Confirm unique-file collapsing is identical.
4. Confirm path normalization.
5. Review every lost expected file.

### Startup not faster

If quality passes but startup does not improve:

1. Profile imports with `-X importtime`.
2. Profile ONNX session creation separately.
3. Confirm no forbidden high-level package was installed or imported.
4. Confirm a local model path is used and no network request occurs.
5. Compare session options only after measuring their default behavior.

If direct ONNX remains slower after those checks, reject it as a startup optimization. Do not add production complexity solely because ONNX is expected to be faster.

### Resource exhaustion

If full-corpus encoding exceeds memory:

- Reduce batch size.
- Stream result batches into a preallocated NumPy memmap or chunked temporary arrays.
- Do not load both backend outputs and both model runtimes simultaneously.
- Record the failure and peak RSS.

## 15. Verification Commands

The exact script names may differ during implementation, but the final prototype must support an equivalent bounded workflow:

```powershell
$Root = "$env:LOCALAPPDATA\Temp\opencode\direct-e5-onnx"
$DirectPython = "$Root\venv\Scripts\python.exe"

& $DirectPython -X utf8 "$Root\direct_e5_onnx.py" `
  --self-check `
  --model-dir "<resolved snapshot path>"

& "<production managed python>" -X utf8 "$Root\capture_backend.py" `
  --backend pytorch `
  --model-dir "<resolved snapshot path>" `
  --fixtures "$Root\fixtures.json" `
  --output "$Root\results\pytorch-fixtures.npz"

& $DirectPython -X utf8 "$Root\capture_backend.py" `
  --backend direct `
  --model-dir "<resolved snapshot path>" `
  --fixtures "$Root\fixtures.json" `
  --output "$Root\results\direct-fixtures.npz"

& $DirectPython -X utf8 "$Root\compare_backends.py" `
  --reference "$Root\results\pytorch-fixtures.npz" `
  --candidate "$Root\results\direct-fixtures.npz" `
  --mode fixtures

& "<production managed python>" -X utf8 "$Root\capture_corpus.py" `
  --db "<read-only chunks.db path>" `
  --metadata "<metadata.json path>" `
  --output "$Root\results\corpus-manifest.jsonl" `
  --output-metadata "$Root\results\corpus-manifest-metadata.json"

& "<production managed python>" -X utf8 "$Root\benchmark_backend.py" `
  --backend pytorch `
  --model-dir "<resolved snapshot path>" `
  --manifest "$Root\results\corpus-manifest.jsonl" `
  --cases "<cases.local.json path>" `
  --output "$Root\results\pytorch-corpus.npz"

& $DirectPython -X utf8 "$Root\benchmark_backend.py" `
  --backend direct `
  --model-dir "<resolved snapshot path>" `
  --manifest "$Root\results\corpus-manifest.jsonl" `
  --cases "<cases.local.json path>" `
  --output "$Root\results\direct-corpus.npz"

& $DirectPython -X utf8 "$Root\compare_backends.py" `
  --reference "$Root\results\pytorch-corpus.npz" `
  --candidate "$Root\results\direct-corpus.npz" `
  --gold "<goldset.local.json path>" `
  --mode corpus `
  --output "$Root\results\comparison.json"
```

All Python invocations that handle Korean text must use `-X utf8`.

## 16. Completion Checklist

The prototype task is complete only when all items are answered with evidence:

- [ ] Isolated venv contains no PyTorch, Sentence Transformers, Transformers, or Optimum.
- [ ] Direct process imports none of those packages.
- [ ] Exact model revision and file hashes are recorded.
- [ ] Repository status after measurement is byte-for-byte identical to preflight status.
- [ ] Repository file manifest after measurement is byte-for-byte identical to preflight manifest.
- [ ] One immutable corpus manifest was captured under read-only and query-only SQLite rules.
- [ ] Both backends consumed the same manifest hash and did not reopen production `chunks.db`.
- [ ] Token IDs and attention masks match on all diagnostic fixtures.
- [ ] Minimum fixture cosine similarity is at least 0.99999.
- [ ] All 8,419 or current corpus chunks are independently encoded by both backends.
- [ ] Minimum corpus cosine similarity is at least 0.99999.
- [ ] Mean top-40 overlap is at least 99%.
- [ ] Direct pure-vector recall@40 is at least 22/39.
- [ ] Every per-case gold regression is reviewed.
- [ ] At least 10 sequential, non-concurrent startup samples per backend are recorded.
- [ ] Direct median startup is faster than PyTorch median startup.
- [ ] Warm query p50/p95 are recorded.
- [ ] Full-corpus throughput and peak RSS are recorded.
- [ ] Production repository, runtime, settings, and index remained unchanged during measurement.
- [ ] The temporary `results/final-report.md` records raw samples, aggregate metrics, limitations, and the final decision.

## 17. Expected Outcome and Decision Discipline

The direct path is expected to remove roughly 3.4 seconds of PyTorch and Sentence Transformers import work, but this is a hypothesis, not a promised result. ONNX Runtime still needs to import its native library, parse a 1.06 GiB graph, create a session, load the tokenizer, and perform the first inference.

Do not begin production integration merely because the direct prototype works. Production integration is justified only if:

1. All quality gates pass.
2. Startup improvement is meaningful, not measurement noise.
3. Throughput or memory results provide additional value.
4. The runtime, model provisioning, metadata, settings, and rollback complexity is acceptable.

If the direct CPU prototype passes, clear context again and use its temporary `results/final-report.md` plus this document to decide whether to promote a reviewed summary into the repository and write separate plans for production CPU support and NVIDIA-machine CUDA ONNX validation.
