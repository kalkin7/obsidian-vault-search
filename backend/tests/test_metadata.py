from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.index_metadata import (
    LEXICAL_SCHEMA_VERSION, SCHEMA_VERSION, expected_metadata, validate_metadata,
)


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


def test_lexical_schema_version_is_separate_from_core_schema(tmp_path: Path):
    metadata = expected_metadata(config(tmp_path), 768)
    assert SCHEMA_VERSION == 2
    assert LEXICAL_SCHEMA_VERSION == 2
    assert metadata["schema_version"] == 2
    assert metadata["lexical_schema_version"] == 2
