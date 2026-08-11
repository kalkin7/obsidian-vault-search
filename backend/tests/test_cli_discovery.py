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


def test_cli_forwards_match_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    captured: dict = {}
    monkeypatch.setattr(cli, "discover_vault", lambda _explicit: tmp_path)

    def fake_call(_vault, method, params, _timeout):
        captured.update({"method": method, "params": params})
        return {"ok": True, "data": {"results": []}}

    monkeypatch.setattr(cli, "call_runtime", fake_call)
    monkeypatch.setattr(sys, "argv", [
        "vault-search", "search", "전기차", "--match", "phrase", "--json",
    ])
    cli.main()
    assert captured["method"] == "search"
    assert captured["params"]["match_mode"] == "phrase"
