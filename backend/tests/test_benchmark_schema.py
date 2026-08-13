import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

_SCRIPT = REPO_ROOT / "scripts" / "benchmark-search.py"
_spec = importlib.util.spec_from_file_location("benchmark_search", _SCRIPT)
assert _spec is not None and _spec.loader is not None
benchmark_search = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(benchmark_search)

SchemaError = benchmark_search.SchemaError
SearchRequestError = benchmark_search.SearchRequestError
compare_baseline = benchmark_search.compare_baseline
load_cases = benchmark_search.load_cases
normalize_path = benchmark_search.normalize_path
recall_at = benchmark_search.recall_at
forbidden_count = benchmark_search.forbidden_count
mrr_at = benchmark_search.mrr_at
validate_cases = benchmark_search.validate_cases


def make_case(**overrides) -> dict:
    case = {
        "id": "case-one",
        "query": "층간소음 처리 절차",
        "intent": "topic",
        "expected_paths": ["2_Area/apt/민원/층간소음.md"],
        "acceptable_paths": [],
        "forbidden_paths": [],
        "top_k": 40,
    }
    case.update(overrides)
    return case


def make_file(**overrides) -> dict:
    data = {
        "schema_version": 1,
        "vault": "K_Notes",
        "cases": [make_case()],
    }
    data.update(overrides)
    return data


def test_rejects_bad_schema_version():
    problems = validate_cases(make_file(schema_version=2))
    assert any("schema_version" in problem for problem in problems)


def test_rejects_duplicate_case_id():
    problems = validate_cases(make_file(cases=[make_case(), make_case()]))
    assert any("duplicate" in problem for problem in problems)


def test_single_empty_expected_acceptable_forbidden_is_allowed():
    problems = validate_cases(make_file(cases=[make_case(
        expected_paths=[], acceptable_paths=["related.md"])]))
    assert not problems
    problems = validate_cases(make_file(cases=[make_case(
        acceptable_paths=[], forbidden_paths=["noise.md"])]))
    assert not problems
    problems = validate_cases(make_file(cases=[make_case(
        forbidden_paths=[], acceptable_paths=["related.md"])]))
    assert not problems


def test_all_empty_expected_acceptable_forbidden_rejected():
    case = make_case(expected_paths=[], acceptable_paths=[], forbidden_paths=[])
    problems = validate_cases(make_file(cases=[case]))
    assert any("cannot all be empty" in problem for problem in problems)


def test_normalizes_windows_paths():
    assert normalize_path("2_Area\\apt\\민원\\층간소음.md") == "2_Area/apt/민원/층간소음.md"


def test_recall_at_k():
    paths = ["a.md", "b.md", "c.md", "d.md"]
    expected = {"b.md", "d.md"}
    assert recall_at(paths, expected, 2) == 0.5
    assert recall_at(paths, expected, 4) == 1.0
    assert recall_at(paths, set(), 4) == 0.0
    assert recall_at(["b.md", "b.md"], {"b.md"}, 2) == 1.0


def test_mrr_at():
    paths = ["a.md", "b.md", "c.md"]
    assert mrr_at(paths, {"b.md"}, 3) == 0.5
    assert mrr_at(paths, {"c.md"}, 3) == 1 / 3
    assert mrr_at(paths, {"zz.md"}, 3) == 0.0
    assert mrr_at(paths, {"b.md"}, 1) == 0.0


def test_forbidden_count():
    paths = ["a.md", "b.md", "c.md", "d.md"]
    forbidden = {"c.md", "d.md", "zz.md"}
    assert forbidden_count(paths, forbidden, 2) == 0
    assert forbidden_count(paths, forbidden, 4) == 2


def test_load_cases_validates_schema(tmp_path: Path):
    path = tmp_path / "cases.json"
    path.write_text(
        '{"schema_version": 1, "vault": "V", "cases": [{"id": "x", "query": "q", "intent": "topic", "expected_paths": ["a.md"], "top_k": 40}]}',
        encoding="utf-8")
    loaded = load_cases(path)
    assert loaded["vault"] == "V"


def test_load_cases_raises_on_schema_error(tmp_path: Path):
    path = tmp_path / "cases.json"
    path.write_text('{"schema_version": 2, "vault": "V", "cases": []}', encoding="utf-8")
    try:
        load_cases(path)
        raise AssertionError("expected SchemaError")
    except SchemaError:
        pass


def test_compare_baseline_recall40_regression():
    def report(recall40, complete=False, forbidden=0, p95=100.0):
        return {
            "metrics": {
                "recall@40": recall40, "complete_recall": 1.0 if complete else 0.0,
                "forbidden_count@20": forbidden, "forbidden_count@40": forbidden,
                "latency_p95_ms": p95,
            },
            "cases": [{"id": "case-one", "complete": complete}],
        }

    passed, failures = compare_baseline(report(0.8), report(0.9))
    assert not passed
    assert any("recall@40" in failure for failure in failures)

    passed, failures = compare_baseline(report(0.9), report(0.9))
    assert passed


def test_compare_baseline_complete_recall_regression():
    def report(complete, recall40=0.9, forbidden=0, p95=100.0):
        return {
            "metrics": {
                "recall@40": recall40, "complete_recall": 1.0 if complete else 0.0,
                "forbidden_count@20": forbidden, "forbidden_count@40": forbidden,
                "latency_p95_ms": p95,
            },
            "cases": [{"id": "case-one", "complete": complete}],
        }

    passed, failures = compare_baseline(report(False), report(True))
    assert not passed
    assert any("complete recall regression" in failure for failure in failures)

    passed, _failures = compare_baseline(report(True), report(True))
    assert passed


def test_compare_baseline_forbidden_increase():
    def report(forbidden, recall40=0.9, complete=True, p95=100.0):
        return {
            "metrics": {
                "recall@40": recall40, "complete_recall": 1.0,
                "forbidden_count@20": forbidden, "forbidden_count@40": forbidden,
                "latency_p95_ms": p95,
            },
            "cases": [{"id": "case-one", "complete": complete}],
        }

    passed, failures = compare_baseline(report(1), report(0))
    assert not passed
    assert any("forbidden" in failure for failure in failures)

    passed, _failures = compare_baseline(report(0), report(0))
    assert passed


def test_compare_baseline_forbidden_at_40_increase():
    def report(forbidden40):
        return {
            "metrics": {
                "recall@40": 0.9, "complete_recall": 1.0,
                "forbidden_count@20": 0, "forbidden_count@40": forbidden40,
                "latency_p95_ms": 100.0,
            },
            "cases": [{"id": "case-one", "complete": True}],
        }

    passed, failures = compare_baseline(report(1), report(0))
    assert not passed
    assert any("at 40" in failure for failure in failures)


def test_compare_baseline_latency_increase():
    def report(p95, recall40=0.9, complete=True, forbidden=0):
        return {
            "metrics": {
                "recall@40": recall40, "complete_recall": 1.0,
                "forbidden_count@20": forbidden, "forbidden_count@40": forbidden,
                "latency_p95_ms": p95,
            },
            "cases": [{"id": "case-one", "complete": complete}],
        }

    passed, failures = compare_baseline(report(126.0), report(100.0))
    assert not passed
    assert any("latency" in failure for failure in failures)

    passed, _failures = compare_baseline(report(124.0), report(100.0))
    assert passed


def test_search_retries_model_loading_until_ready(monkeypatch, tmp_path: Path):
    calls: list[str] = []
    search_count = 0
    search_ok = {"ok": True, "data": {"results": [{"rank": 1, "file_path": "a.md"}]}}

    def fake_call(_vault, method, _params, _timeout):
        nonlocal search_count
        calls.append(method)
        if method == "search":
            search_count += 1
            if search_count == 1:
                return {"ok": False, "error": {"code": "MODEL_LOADING", "message": "loading"}}
            return search_ok
        if method == "status":
            return {"ok": True, "data": {"state": "ready"}}
        raise AssertionError(f"unexpected method {method}")

    monkeypatch.setattr(benchmark_search, "call_runtime", fake_call)
    result = benchmark_search._search(tmp_path, {"query": "q", "top_k": 5}, 5.0)
    assert result == search_ok["data"]["results"]
    assert calls[0] == "search"
    assert "status" in calls
    assert calls[-1] == "search"


def test_search_retry_times_out_when_backend_stays_loading(monkeypatch, tmp_path: Path):
    def fake_call(_vault, method, _params, _timeout):
        if method == "search":
            return {"ok": False, "error": {"code": "MODEL_LOADING", "message": "loading"}}
        return {"ok": True, "data": {"state": "loading_model"}}

    monkeypatch.setattr(benchmark_search, "call_runtime", fake_call)
    monkeypatch.setattr(benchmark_search, "STARTUP_TIMEOUT", 0.5)
    try:
        benchmark_search._search(tmp_path, {"query": "q", "top_k": 5}, 5.0)
        raise AssertionError("expected SearchRequestError")
    except SearchRequestError as exc:
        assert "startup timed out" in str(exc)


def test_search_retry_reports_backend_error_on_state_error(monkeypatch, tmp_path: Path):
    def fake_call(_vault, method, _params, _timeout):
        if method == "search":
            return {"ok": False, "error": {"code": "MODEL_LOADING", "message": "loading"}}
        return {"ok": True, "data": {"state": "error", "error": "boom"}}

    monkeypatch.setattr(benchmark_search, "call_runtime", fake_call)
    try:
        benchmark_search._search(tmp_path, {"query": "q", "top_k": 5}, 5.0)
        raise AssertionError("expected SearchRequestError")
    except SearchRequestError as exc:
        assert "BACKEND_ERROR" in str(exc)
        assert "boom" in str(exc)
