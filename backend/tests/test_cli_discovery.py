from pathlib import Path

import pytest

from vault_search.cli import discover_vault


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
