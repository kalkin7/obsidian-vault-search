#!/usr/bin/env python3
"""Reproducible search quality benchmark for the vault-search sidecar.

Usage:
  python scripts/benchmark-search.py --vault <vault> --cases <cases.json> --output <out.json>
  python scripts/benchmark-search.py --vault <vault> --cases <cases.json> --output <out.json> --baseline <baseline.json>

Exit codes:
  0  run succeeded and quality gate passed
  1  run succeeded but quality gate failed
  2  input schema error
  3  sidecar unavailable
  4  search request failed
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from vault_search import __version__ as backend_version  # noqa: E402
from vault_search.cli import ServiceUnavailable, call_runtime  # noqa: E402

SCHEMA_VERSION = 1
ALLOWED_INTENTS = {"exact", "known-item", "topic", "timeline", "value", "korean-morphology"}
DEFAULT_TOP_K = 40
MAX_TOP_K = 200
MEASURE_REPEATS = 5


class SchemaError(ValueError):
    pass


class SearchRequestError(RuntimeError):
    pass


def normalize_path(path: str) -> str:
    return path.strip().replace("\\", "/")


def load_cases(path: str | Path) -> dict[str, Any]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    problems = validate_cases(raw)
    if problems:
        raise SchemaError("; ".join(problems))
    return raw


def validate_cases(data: Any) -> list[str]:
    problems: list[str] = []
    if not isinstance(data, dict):
        return ["cases file must be a JSON object"]
    if data.get("schema_version") != SCHEMA_VERSION:
        problems.append(f"schema_version must be {SCHEMA_VERSION}")
    if not isinstance(data.get("vault"), str) or not data["vault"].strip():
        problems.append("vault must be a non-empty string")
    cases = data.get("cases")
    if not isinstance(cases, list) or not cases:
        problems.append("cases must be a non-empty array")
        return problems
    ids: set[str] = set()
    for index, case in enumerate(cases):
        prefix = f"cases[{index}]"
        if not isinstance(case, dict):
            problems.append(f"{prefix}: must be an object")
            continue
        case_id = case.get("id")
        if not isinstance(case_id, str) or not _is_kebab(case_id):
            problems.append(f"{prefix}: id must be ASCII kebab-case")
        if isinstance(case_id, str):
            if case_id in ids:
                problems.append(f"{prefix}: duplicate id {case_id!r}")
            ids.add(case_id)
        if not isinstance(case.get("query"), str) or not case["query"].strip():
            problems.append(f"{prefix}: query must be a non-empty string")
        intent = case.get("intent")
        if intent not in ALLOWED_INTENTS:
            problems.append(f"{prefix}: intent must be one of {sorted(ALLOWED_INTENTS)}")
        expected = case.get("expected_paths", [])
        acceptable = case.get("acceptable_paths", [])
        forbidden = case.get("forbidden_paths", [])
        for field, value in (("expected_paths", expected), ("acceptable_paths", acceptable),
                             ("forbidden_paths", forbidden)):
            if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
                problems.append(f"{prefix}: {field} must be an array of strings")
        if not expected and not acceptable and not forbidden:
            problems.append(f"{prefix}: expected, acceptable, and forbidden cannot all be empty")
        top_k = case.get("top_k", DEFAULT_TOP_K)
        if not isinstance(top_k, int) or isinstance(top_k, bool) or not 1 <= top_k <= MAX_TOP_K:
            problems.append(f"{prefix}: top_k must be an integer in [1, {MAX_TOP_K}]")
    return problems


def _is_kebab(value: str) -> bool:
    if not value or value[0] == "-" or value[-1] == "-":
        return False
    return all(ch.isascii() and (ch.isalnum() or ch == "-") for ch in value)


def git_commit(repo_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def run_case(vault: Path, case: dict[str, Any], timeout: float) -> tuple[dict[str, Any], list[float]]:
    params: dict[str, Any] = {
        "query": case["query"],
        "top_k": int(case.get("top_k", DEFAULT_TOP_K)),
        "verbose": True,
    }
    warm_up = _search(vault, params, timeout)
    latencies: list[float] = []
    first: dict[str, Any] | None = None
    for _ in range(MEASURE_REPEATS):
        started = time.perf_counter()
        response = _search(vault, params, timeout)
        latencies.append((time.perf_counter() - started) * 1000.0)
        if first is None:
            first = response
    assert first is not None
    return first, latencies


def _search(vault: Path, params: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        response = call_runtime(vault, "search", params, timeout)
    except ServiceUnavailable as exc:
        raise SearchRequestError(str(exc)) from exc
    if not response.get("ok"):
        error = response.get("error") or {}
        raise SearchRequestError(
            f"[{error.get('code', 'ERROR')}] {error.get('message', 'search failed')}")
    data = response.get("data") or {}
    results = data.get("results")
    if not isinstance(results, list):
        raise SearchRequestError("Search response did not contain a results list")
    return results


def metric_paths(results: list[dict[str, Any]], top_k: int) -> list[str]:
    return [normalize_path(str(item["file_path"])) for item in results[:top_k]]


def recall_at(paths: list[str], expected: set[str], k: int) -> float:
    if not expected:
        return 0.0
    found = len(set(paths[:k]) & expected)
    return found / len(expected)


def mrr_at(paths: list[str], expected: set[str], k: int) -> float:
    for rank, path in enumerate(paths[:k], 1):
        if path in expected:
            return 1.0 / rank
    return 0.0


def forbidden_count(paths: list[str], forbidden: set[str], k: int) -> int:
    return sum(1 for path in paths[:k] if path in forbidden)


def summarize_case(case: dict[str, Any], results: list[dict[str, Any]],
                   latencies: list[float]) -> dict[str, Any]:
    expected = {normalize_path(p) for p in case.get("expected_paths", [])}
    acceptable = {normalize_path(p) for p in case.get("acceptable_paths", [])}
    forbidden = {normalize_path(p) for p in case.get("forbidden_paths", [])}
    paths_all = metric_paths(results, MAX_TOP_K)
    channels_present: set[str] = set()
    for item in results:
        if int(item.get("bm25_rank", -1)) > 0:
            channels_present.add("body")
        if int(item.get("vector_rank", -1)) > 0:
            channels_present.add("vector")
        if int(item.get("title_rank", -1)) > 0:
            channels_present.add("title")
    return {
        "id": case["id"],
        "query": case["query"],
        "top_k": int(case.get("top_k", DEFAULT_TOP_K)),
        "latency_median_ms": round(statistics.median(latencies), 3) if latencies else None,
        "results": [
            {
                "rank": int(item["rank"]),
                "file_path": normalize_path(str(item["file_path"])),
                "score": float(item["score"]),
                "channels": sorted({c for c, key in (
                    ("body", "bm25_rank"), ("vector", "vector_rank"), ("title", "title_rank"))
                    if int(item.get(key, -1)) > 0}),
            }
            for item in results
        ],
        "channels_present": sorted(channels_present),
        "recall@20": recall_at(paths_all, expected, 20),
        "recall@40": recall_at(paths_all, expected, 40),
        "has_expected": bool(expected),
        "success": bool(expected) and any(path in expected for path in paths_all[:40]),
        "complete": bool(expected) and expected.issubset(set(paths_all[:40])),
        "acceptable_hit": any(path in acceptable for path in paths_all[:40]),
        "mrr@10": mrr_at(paths_all, expected, 10),
        "unique_path_count@20": len(set(metric_paths(results, 20))),
        "forbidden_count@20": forbidden_count(paths_all, forbidden, 20),
    }


def aggregate_metrics(cases: list[dict[str, Any]], summaries: list[dict[str, Any]]) -> dict[str, Any]:
    latencies = [s["latency_median_ms"] for s in summaries if s["latency_median_ms"] is not None]
    expected_summaries = [s for s in summaries if s["has_expected"]]
    if not expected_summaries:
        raise ValueError("At least one benchmark case must contain expected_paths")
    return {
        "recall@20": round(sum(s["recall@20"] for s in expected_summaries)
                           / len(expected_summaries), 6),
        "recall@40": round(sum(s["recall@40"] for s in expected_summaries)
                           / len(expected_summaries), 6),
        "success_rate": round(sum(1 for s in expected_summaries if s["success"])
                              / len(expected_summaries), 6),
        "complete_recall": round(sum(1 for s in expected_summaries if s["complete"])
                                 / len(expected_summaries), 6),
        "mrr@10": round(sum(s["mrr@10"] for s in expected_summaries)
                        / len(expected_summaries), 6),
        "acceptable_success_rate": round(
            sum(1 for s in summaries if s["acceptable_hit"])
            / sum(1 for case in cases if case.get("acceptable_paths")), 6
        ) if any(case.get("acceptable_paths") for case in cases) else None,
        "unique_path_count@20": round(
            sum(s["unique_path_count@20"] for s in summaries) / len(summaries), 6),
        "forbidden_count@20": sum(s["forbidden_count@20"] for s in summaries),
        "latency_p50_ms": round(statistics.median(latencies), 3) if latencies else None,
        "latency_p95_ms": round(_p95(latencies), 3) if latencies else None,
    }


def _p95(values: list[float]) -> float:
    ordered = sorted(values)
    index = int(0.95 * (len(ordered) - 1))
    return ordered[index]


def compare_baseline(current: dict[str, Any], baseline: dict[str, Any]) -> tuple[bool, list[str]]:
    failures: list[str] = []
    current_metrics = current["metrics"]
    baseline_metrics = baseline["metrics"]
    if current_metrics["recall@40"] < baseline_metrics["recall@40"]:
        failures.append(
            f"recall@40 dropped: {baseline_metrics['recall@40']} -> {current_metrics['recall@40']}")
    baseline_complete = {s["id"]: s["complete"] for s in baseline["cases"]}
    for summary in current["cases"]:
        case_id = summary["id"]
        if baseline_complete.get(case_id) and not summary["complete"]:
            failures.append(f"complete recall regression in case {case_id!r}")
    if current_metrics["forbidden_count@20"] > baseline_metrics["forbidden_count@20"]:
        failures.append(
            "forbidden count increased: "
            f"{baseline_metrics['forbidden_count@20']} -> {current_metrics['forbidden_count@20']}")
    baseline_p95 = baseline_metrics.get("latency_p95_ms")
    current_p95 = current_metrics.get("latency_p95_ms")
    if baseline_p95 and current_p95 and current_p95 > baseline_p95 * 1.25:
        failures.append(f"latency p95 increased >25%: {baseline_p95} -> {current_p95} ms")
    return not failures, failures


def build_report(cases: dict[str, Any], vault: Path, output: Path,
                 summaries: list[dict[str, Any]]) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[1]
    return {
        "schema_version": SCHEMA_VERSION,
        "vault": cases["vault"],
        "backend_version": backend_version,
        "git_commit": git_commit(repo_root),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics": aggregate_metrics(cases["cases"], summaries),
        "cases": summaries,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vault Search quality benchmark")
    parser.add_argument("--vault", required=True, help="Path to the Obsidian vault")
    parser.add_argument("--cases", required=True, help="Path to the relevance cases JSON")
    parser.add_argument("--output", required=True, help="Path to write the benchmark JSON")
    parser.add_argument("--baseline", help="Optional previous benchmark JSON to compare against")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    try:
        cases = load_cases(args.cases)
    except (OSError, json.JSONDecodeError, SchemaError) as exc:
        print(f"[SCHEMA_ERROR] {exc}", file=sys.stderr)
        return 2

    vault = Path(args.vault).resolve()
    summaries: list[dict[str, Any]] = []
    try:
        for case in cases["cases"]:
            results, latencies = run_case(vault, case, args.timeout)
            summaries.append(summarize_case(case, results, latencies))
    except SearchRequestError as exc:
        print(f"[SEARCH_FAILED] {exc}", file=sys.stderr)
        return 4
    except ServiceUnavailable as exc:
        print(f"[SERVICE_UNAVAILABLE] {exc}", file=sys.stderr)
        return 3

    report = build_report(cases, vault, Path(args.output), summaries)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.baseline:
        print(json.dumps(report["metrics"], ensure_ascii=False, indent=2))
        print(f"Results written to {args.output}")
        return 0

    try:
        baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[SCHEMA_ERROR] Could not read baseline: {exc}", file=sys.stderr)
        return 2
    passed, failures = compare_baseline(report, baseline)
    print("Baseline comparison:")
    print(f"  recall@40:     {baseline['metrics']['recall@40']} -> {report['metrics']['recall@40']}")
    print(f"  complete:      {baseline['metrics']['complete_recall']} -> {report['metrics']['complete_recall']}")
    print(f"  mrr@10:        {baseline['metrics']['mrr@10']} -> {report['metrics']['mrr@10']}")
    print(f"  forbidden@20:  {baseline['metrics']['forbidden_count@20']} -> {report['metrics']['forbidden_count@20']}")
    print(f"  latency p95:   {baseline['metrics'].get('latency_p95_ms')} -> {report['metrics'].get('latency_p95_ms')} ms")
    if failures:
        print("Quality gate FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("Quality gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
