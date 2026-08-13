from pathlib import Path
import sys

import pytest

from vault_search.cli import discover_vault, make_parser
import vault_search.cli as cli

def test_cli_discovers_parent_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / ".obsidian").mkdir()
    child = tmp_path / "folder" / "nested"
    child.mkdir(parents=True)
    monkeypatch.chdir(child)
    monkeypatch.delenv("OBSIDIAN_VAULT_ROOT", raising=False)
    assert discover_vault(None) == tmp_path.resolve()


def test_cli_rejects_non_vault(tmp_path: Path):
    with pytest.raises(ValueError):
        discover_vault(str(tmp_path))


def test_search_match_mode_parser():
    args = make_parser().parse_args(["search", "전기차", "--match", "all"])
    assert args.match == "all"


def test_search_intent_parser():
    args = make_parser().parse_args(["search", "전체 경과", "--intent", "timeline"])
    assert args.intent == "timeline"


def _mock_forward_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, captured: dict):
    monkeypatch.setattr(cli, "discover_vault", lambda _explicit: tmp_path)
    monkeypatch.setattr(cli, "_ensure_search_runtime", lambda *_a, **_k: None)

    def fake_call(_vault, method, params, _timeout):
        captured.update({"method": method, "params": params})
        return {"ok": True, "data": {"results": []}}

    monkeypatch.setattr(cli, "call_runtime", fake_call)


def test_cli_forwards_match_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict = {}
    _mock_forward_call(monkeypatch, tmp_path, captured)
    monkeypatch.setattr(sys, "argv", [
        "vault-search", "search", "전기차", "--match", "phrase", "--json",
    ])
    cli.main()
    assert captured["method"] == "search"
    assert captured["params"]["match_mode"] == "phrase"


def test_cli_forwards_intent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict = {}
    _mock_forward_call(monkeypatch, tmp_path, captured)
    monkeypatch.setattr(sys, "argv", [
        "vault-search", "search", "전체 경과", "--intent", "timeline", "--json",
    ])
    cli.main()
    assert captured["params"]["intent"] == "timeline"


def test_search_parser_top_defaults_to_none():
    args = make_parser().parse_args(["search", "전기차"])
    assert args.top is None
    args = make_parser().parse_args(["search", "전기차", "--top", "40"])
    assert args.top == 40


def test_search_without_top_forwards_none(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict = {}
    _mock_forward_call(monkeypatch, tmp_path, captured)
    monkeypatch.setattr(sys, "argv", ["vault-search", "search", "전기차", "--json"])
    cli.main()
    assert captured["params"]["top_k"] is None


def test_no_start_skips_standalone_spawn(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(cli, "discover_vault", lambda _explicit: tmp_path)
    monkeypatch.setattr(cli, "_runtime_is_valid", lambda _vault: False)
    spawn_calls: list = []
    monkeypatch.setattr(cli, "_spawn_standalone",
                        lambda *a, **k: spawn_calls.append((a, k)))
    monkeypatch.setattr(sys, "argv", ["vault-search", "search", "전기차", "--no-start"])
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 3
    assert spawn_calls == []


def test_rebuild_vectors_forwards_method(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict = {}
    monkeypatch.setattr(cli, "discover_vault", lambda _explicit: tmp_path)
    monkeypatch.setattr(cli, "_ensure_search_runtime", lambda *_a, **_k: None)
    monkeypatch.setattr(cli, "_ensure_model_ready", lambda *_a, **_k: None)

    def fake_call(_vault, method, params, _timeout):
        captured.update({"method": method, "params": params})
        return {"ok": True, "data": {"files": 1}}

    monkeypatch.setattr(cli, "call_runtime", fake_call)
    monkeypatch.setattr(sys, "argv", ["vault-search", "rebuild-vectors"])
    cli.main()
    assert captured["method"] == "rebuild_vectors"


def test_ensure_search_runtime_spawns_when_stale(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    states = {"valid": False}
    spawned: list = []
    monkeypatch.setattr(cli, "_runtime_is_valid", lambda _vault: states["valid"])
    monkeypatch.setattr(cli, "_spawn_standalone",
                        lambda *a, **k: spawned.append(True) or {"pid": 1})
    cli._ensure_search_runtime(tmp_path, 1.0, 1800.0, no_start=False)
    assert len(spawned) == 1
    states["valid"] = True
    cli._ensure_search_runtime(tmp_path, 1.0, 1800.0, no_start=False)
    assert len(spawned) == 1


def test_ensure_search_runtime_no_start_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(cli, "_runtime_is_valid", lambda _vault: False)
    with pytest.raises(cli.ServiceUnavailable):
        cli._ensure_search_runtime(tmp_path, 1.0, 1800.0, no_start=True)


def test_windowless_python_prefers_configured_sibling(tmp_path: Path):
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    python = script_dir / "python.exe"
    python.write_bytes(b"x")
    pythonw = script_dir / "pythonw.exe"
    pythonw.write_bytes(b"x")
    assert cli._windowless_python(str(python)) == str(pythonw)


def test_windowless_python_falls_back_when_absent(tmp_path: Path):
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    python = script_dir / "python.exe"
    python.write_bytes(b"x")
    assert cli._windowless_python(str(python)) == str(python)


def test_windowless_python_ignores_unrelated_pythonw(tmp_path: Path):
    # A pythonw.exe in some other directory must never be selected: only the
    # sibling of the configured executable is a valid windowless build.
    other = tmp_path / "other"
    other.mkdir()
    (other / "pythonw.exe").write_bytes(b"x")
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    python = script_dir / "python.exe"
    python.write_bytes(b"x")
    assert cli._windowless_python(str(python)) == str(python)
