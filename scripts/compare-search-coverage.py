"""3-way search coverage comparison.

Compares the candidate paths produced by a CLI agent session against the
plugin's Hybrid Search results and an rg keyword sweep for the same query, then
reports intersection, missing, and false-positive paths.

Usage:
  python -X utf8 scripts/compare-search-coverage.py ^
    --session <paths.json or .txt> --rg <paths.json or .txt> ^
    --hybrid <search results json> --query "..." --top 40

Input formats:
  --session/--rg : JSON array of relative paths, or a plain-text file with one
                   path per line.
  --hybrid       : raw `search.ps1 -Json` output (JSON array of result objects)
                   or a JSON object with a "results" key.

Gold sets for a private vault must stay outside this repository
(see docs/benchmark-guide.md).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _normalize(path: str) -> str:
    return path.strip().replace("\\", "/").lstrip("./")


def _load_paths(path: Path) -> set[str]:
    raw = path.read_text(encoding="utf-8-sig")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {_normalize(line) for line in raw.splitlines() if line.strip()}
    if isinstance(payload, list):
        return {_normalize(str(item)) for item in payload if isinstance(item, str)}
    return {_normalize(str(item)) for item in payload if isinstance(item, str)}


def _load_hybrid(path: Path, top: int) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        payload = payload["results"]
    return {_normalize(str(item.get("file_path", ""))) for item in payload
            if isinstance(item, dict) and item.get("file_path")} if top <= 0 else {
        _normalize(str(item.get("file_path", ""))) for item in payload[:top]
        if isinstance(item, dict) and item.get("file_path")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", required=True, type=Path,
                        help="Agent session candidate paths (JSON array or line list)")
    parser.add_argument("--rg", required=True, type=Path,
                        help="rg sweep result paths (JSON array or line list)")
    parser.add_argument("--hybrid", required=True, type=Path,
                        help="Hybrid Search result JSON (search.ps1 -Json output)")
    parser.add_argument("--top", type=int, default=40,
                        help="Number of hybrid results to consider (default 40)")
    parser.add_argument("--query", default="")
    args = parser.parse_args()

    session = _load_paths(args.session)
    rg = _load_paths(args.rg)
    hybrid = _load_hybrid(args.hybrid, args.top)

    union = session | rg | hybrid
    in_all = session & rg & hybrid
    only_session = session - rg - hybrid
    only_rg = rg - session - hybrid
    only_hybrid = hybrid - session - rg
    print(f"query: {args.query or '(unspecified)'}")
    print(f"session={len(session)} rg={len(rg)} hybrid(top {args.top})={len(hybrid)} "
          f"union={len(union)}")
    print(f"\nIn all three ({len(in_all)}):")
    for path in sorted(in_all):
        print(f"  {path}")
    print(f"\nOnly in session ({len(only_session)}):")
    for path in sorted(only_session):
        print(f"  {path}")
    print(f"\nOnly in rg ({len(only_rg)}):")
    for path in sorted(only_rg):
        print(f"  {path}")
    print(f"\nOnly in hybrid ({len(only_hybrid)}):")
    for path in sorted(only_hybrid):
        print(f"  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
