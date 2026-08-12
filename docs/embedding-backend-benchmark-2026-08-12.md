# Embedding Backend Benchmark (2026-08-12)

## Purpose

Evaluate whether either of these changes improves Vault Search without reducing retrieval quality:

1. Prefer a locally cached `intfloat/multilingual-e5-base` model over a Hugging Face Hub revision check.
2. Replace the PyTorch FP32 backend with the published FP32 ONNX model.

The production runtime and index were not modified during the ONNX experiment.

## Environment

- OS: Windows 11
- Python: 3.13
- Model: `intfloat/multilingual-e5-base`
- Model dimension: 768
- Production backend:
  - `sentence-transformers 5.4.1`
  - `transformers 5.6.2`
  - `torch 2.11.0+cpu`
  - `huggingface_hub 1.27.0`
- Isolated ONNX experiment:
  - `sentence-transformers 5.4.1`
  - `transformers 4.57.6`
  - `optimum 2.1.0`
  - `onnxruntime 1.25.1`
- Corpus at measurement time: 2,865 files and 8,419 vector chunks
- Gold set: 12 K_Notes queries and 39 expected files
- Model files:
  - `model.safetensors`: 1,112,201,288 bytes (1,060.7 MiB)
  - `onnx/model.onnx`: 1,110,059,084 bytes (1,058.6 MiB)

All model inputs used the E5 retrieval prefixes and normalized embeddings:

- Query: `query: `
- Document: `passage: `
- `normalize_embeddings=True`

## Cached PyTorch Loading

The original cached-model load still performed a Hub revision check. Direct measurements were:

| Mode | Total import and model load |
|---|---:|
| Normal Hub behavior | 9.37-9.97 s |
| `HF_HUB_OFFLINE=1` | 4.85-4.89 s |
| `local_files_only=True` | 4.62-4.65 s |

Vault Search now attempts `local_files_only=True` first and retries online only when the exception chain contains `LocalEntryNotFoundError`. It does not retry unrelated model, CUDA, or configuration errors.

After deployment, observed service `model_load_seconds` values were 6.642 s, 6.522 s, and 6.446 s. The difference from the direct constructor measurement is explained by the service timing boundary and Windows import variance described below.

## PyTorch vs FP32 ONNX

Both backends independently encoded all 8,419 stored chunk texts and the same 12 benchmark queries. Retrieval comparison used exact cosine ranking over all generated vectors and unique file paths.

### Performance

| Measurement | PyTorch FP32 | ONNX FP32 | ONNX change |
|---|---:|---:|---:|
| Cold process through first encode | 4.73-4.85 s | 7.78-8.07 s | Slower by about 3.1 s |
| Cold process, ONNX local snapshot path | N/A | 6.87-7.29 s | Still slower |
| Encode 8,419 chunks, batch 32 | 371.754 s | 279.208 s | 24.9% faster |
| Encode 12 queries, batch 1 | 0.167 s | 0.120 s | 28.1% faster |

The first ONNX load, including the one-time model download, took 77.258 seconds. This value is not included in cached startup comparisons.

### Numerical and Retrieval Parity

| Metric | Result |
|---|---:|
| Mean document embedding cosine similarity | 1.0 |
| Minimum document embedding cosine similarity | 0.99999976 |
| Mean query embedding cosine similarity | 1.0 |
| Minimum query embedding cosine similarity | 1.0 |
| Mean top-10 unique-file overlap | 99.17% |
| Mean top-40 unique-file overlap | 99.79% |
| PyTorch pure-vector recall@40 | 22/39 |
| ONNX pure-vector recall@40 | 22/39 |

The recall figure is for the isolated vector channel, not the complete BM25/title/vector RRF pipeline. It is intended to compare backend parity rather than replace the standard hybrid benchmark.

Only two rank-boundary differences occurred:

- `concept-noise-complaint`: 97.5% top-40 overlap, with the same 3/3 gold hits.
- `broad-ev-charger-timeline`: 90% top-10 overlap and 100% top-40 overlap, with the same 1/4 gold hits.

The FP32 ONNX backend therefore produced effectively identical embeddings and retrieval quality in this corpus.

## Cold Startup Breakdown

The production-equivalent `ModelManager.load()` boundary includes imports performed inside the method. Typical measurements were:

| Stage | Typical time |
|---|---:|
| Import PyTorch | about 0.9 s |
| Import Sentence Transformers and dependencies | about 2.5 s |
| Construct tokenizer and PyTorch model | about 1.25-1.30 s |
| First query encode | about 0.06 s |
| Total | about 4.7 s |

Five sequential measurements were 4.678 s, 4.718 s, 4.723 s, 6.502 s, and 4.742 s. In the 6.502-second outlier, PyTorch import increased from about 0.9 seconds to 2.47 seconds while model construction remained about 1.27 seconds. The long tail is therefore primarily Windows DLL and package file-loading variance, potentially affected by filesystem cache, antivirus scanning, or concurrent disk activity.

Additional service startup work was small:

| Stage | Time |
|---|---:|
| Backend module import | about 0.1 s |
| Kiwi initialization | about 0.53 s |
| Index schema, lexical fast path, and count checks | about 0.05 s |

### Import Cost

`python -X importtime` measured about 3.67 seconds for importing Sentence Transformers. The import graph includes PyTorch, Transformers, SciPy, scikit-learn, Joblib, SymPy, training, evaluation, and CrossEncoder modules even though the service only needs embedding inference.

Constructor profiling showed that tokenizer loading and conversion were a substantial part of the remaining model construction time. Loading the 1.06 GiB safetensors file was not the dominant cost once the OS file cache was warm.

### Hugging Face Agent Registry Request

`huggingface_hub 1.27.0` can request `/api/agent-harnesses` while constructing the HTTP user agent. The response is cached for 24 hours. A stale or missing cache added about 0.6 seconds in one profile; after refresh, normal and offline startup both measured about 4.73-4.82 seconds.

This is separate from the model revision check already avoided by `local_files_only=True`. It is intermittent and is not currently worth forcing process-wide offline mode, which would break first-time model downloads and model changes.

## Why ONNX Starts More Slowly

The Sentence Transformers ONNX path does not remove PyTorch from this environment. Sentence Transformers and Optimum still import PyTorch and the same broad Python dependency graph, then add ONNX Runtime work.

Direct ONNX Runtime measurements showed:

- ONNX Runtime import: about 0.15 s
- FP32 model session creation: about 0.93-1.07 s
- Graph optimization level (`disabled`, `basic`, `extended`, or `all`) did not materially change session creation time.

When a Hugging Face repository ID was passed, Sentence Transformers also queried the repository file list to determine the ONNX export state. Passing the local cached snapshot path reduced total ONNX startup from 7.78-8.07 seconds to 6.87-7.29 seconds, but it remained slower than PyTorch.

## Decision

Keep the PyTorch FP32 backend as the production default.

- FP32 ONNX quality is effectively identical.
- ONNX improves full reindex throughput by about 25%.
- Warm query embedding is faster, but end-to-end warm search is already about 0.12 seconds, so the user-visible gain is small.
- ONNX increases cold startup by roughly 2-3 seconds and requires Optimum, ONNX Runtime, and an additional 1.06 GiB model file.

If startup must be reduced further, converting the same model to ONNX through Sentence Transformers is not the appropriate lever. A materially lighter path would need to avoid importing Sentence Transformers and PyTorch entirely, for example by using ONNX Runtime and Tokenizers directly while reproducing E5 pooling, prefixing, and normalization. That is a larger implementation requiring a full parity benchmark before adoption.

## Limitations

- Results are machine-specific and were measured on Windows with a CPU-only PyTorch runtime.
- The ONNX experiment used an isolated dependency set with `transformers 4.57.6`, while production used `transformers 5.6.2`.
- Windows filesystem cache and real-time scanning caused measurable run-to-run variation.
- The ONNX quality comparison covered the vector channel. Full hybrid behavior was inferred to remain stable because vector rankings were nearly identical, but the production hybrid index was not replaced during this experiment.
- CUDA ONNX Runtime was not evaluated.
