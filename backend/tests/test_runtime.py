from pathlib import Path

from vault_search.runtime import atomic_write_json, read_json, vault_id


def test_vault_id_is_stable(tmp_path: Path):
    assert vault_id(tmp_path) == vault_id(tmp_path.resolve())
    assert len(vault_id(tmp_path)) == 20


def test_atomic_json(tmp_path: Path):
    path = tmp_path / "runtime.json"
    atomic_write_json(path, {"port": 1234})
    assert read_json(path) == {"port": 1234}
    assert not (tmp_path / "runtime.json.tmp").exists()
