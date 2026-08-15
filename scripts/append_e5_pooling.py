"""CLI wrapper for backend/vault_search/onnx_provision.py.

Generates the derived pooled ONNX graph (onnx/model-pooled-normalized.onnx)
that `engine=onnx` loads. Runs the same logic the plugin's "파생 모델 생성"
button calls in-process; this script exists for manual provisioning on a
machine without the plugin (e.g. before first Obsidian use).

Needs `onnx` and `onnxruntime` installed, and the `vault_search` package
importable (install the backend or point PYTHONPATH at `backend/`).

    python -X utf8 scripts/append_e5_pooling.py --model-dir <snapshot dir> [--verify]
"""
from __future__ import annotations

import sys
from pathlib import Path

from vault_search.onnx_provision import provision


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True,
                        help="exact local HF snapshot directory for intfloat/multilingual-e5-base")
    parser.add_argument("--verify", action="store_true",
                        help="run an onnxruntime parity check on the generated graph")
    args = parser.parse_args(argv)

    path = provision(Path(args.model_dir), verify_graph=bool(args.verify))
    print(f"ok: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
