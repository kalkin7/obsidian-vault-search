from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.index_metadata import expected_metadata, validate_metadata


def config(tmp_path: Path) -> SearchConfig:
    return SearchConfig(vault_path=tmp_path, data_dir=tmp_path / "data")


def test_dimension_mismatch_requires_rebuild(tmp_path: Path):
    expected = expected_metadata(config(tmp_path), 768)
    actual = dict(expected)
    actual["embedding_dimension"] = 1024
    problems = validate_metadata(actual, expected)
    assert any("embedding_dimension" in problem for problem in problems)


def test_prefix_mismatch_requires_rebuild(tmp_path: Path):
    expected = expected_metadata(config(tmp_path), 768)
    actual = dict(expected)
    actual["query_prefix"] = ""
    assert validate_metadata(actual, expected)
