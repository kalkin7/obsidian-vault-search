from pathlib import Path

from vault_search.config import SearchConfig
from vault_search.database import STATE_SCHEMA_VERSION
from vault_search.index_metadata import (
    LEXICAL_SCHEMA_VERSION, SCHEMA_VERSION, classify_index_problems, expected_metadata,
    validate_metadata,
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
    assert STATE_SCHEMA_VERSION == 2
    assert metadata["schema_version"] == 2
    assert metadata["lexical_schema_version"] == 2


def test_expected_metadata_contains_engine_and_provider(tmp_path: Path):
    metadata = expected_metadata(config(tmp_path), 768)
    assert metadata["engine"] == "pytorch"
    assert metadata["provider"] == "auto"


def test_engine_change_requires_rebuild(tmp_path: Path):
    expected = expected_metadata(config(tmp_path), 768)
    actual = dict(expected)
    actual["engine"] = "onnx"
    assert validate_metadata(actual, expected)


def test_provider_change_requires_rebuild(tmp_path: Path):
    expected = expected_metadata(config(tmp_path), 768)
    actual = dict(expected)
    actual["provider"] = "tensorrt"
    assert validate_metadata(actual, expected)


def test_onnx_cpu_metadata_records_cpu_provider(tmp_path: Path):
    cfg = config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cpu"
    metadata = expected_metadata(cfg, 768)
    assert metadata["effective_provider"] == "CPUExecutionProvider"


def test_onnx_cpu_provider_change_invalidates_index(tmp_path: Path):
    cfg = config(tmp_path)
    cfg.engine = "onnx"
    cfg.device = "cpu"
    expected = expected_metadata(cfg, 768, effective_provider="CPUExecutionProvider")
    actual = dict(expected)
    actual["effective_provider"] = "CUDAExecutionProvider"
    assert validate_metadata(actual, expected)


def test_classify_legacy_engine_metadata_requires_vector_rebuild():
    problems = [
        "engine: expected 'onnx', found None",
        "provider: expected 'auto', found None",
        "effective_provider: expected 'CPUExecutionProvider', found None",
    ]
    assert classify_index_problems(problems) == "rebuild_vectors"


def test_classify_dimension_and_prefix_require_vector_rebuild():
    problems = [
        "embedding_dimension: expected 768, found 1024",
        "query_prefix: expected 'query: ', found ''",
        "vector count: expected 10, found 8",
    ]
    assert classify_index_problems(problems) == "rebuild_vectors"


def test_classify_structural_mismatch_requires_full_rebuild():
    problems = [
        "chunking_strategy: expected 'paragraph-v1', found 'markdown-v2'",
        "engine: expected 'onnx', found None",
    ]
    assert classify_index_problems(problems) == "rebuild_all"


def test_classify_schema_and_generation_require_full_rebuild():
    problems = [
        "schema_version: expected 2, found 1",
        "SQLite/metadata generation mismatch",
    ]
    assert classify_index_problems(problems) == "rebuild_all"


def test_classify_lexical_and_scope_require_full_rebuild():
    problems = [
        "scope_config_hash: expected abc, found def",
        "missing lexical tables: chunks_fts",
    ]
    assert classify_index_problems(problems) == "rebuild_all"


def test_classify_unknown_problem_defaults_to_full_rebuild():
    assert classify_index_problems(["some unknown problem"]) == "rebuild_all"
    assert classify_index_problems([]) == "none"


def test_classify_tokenizer_and_scope_require_full_rebuild():
    assert classify_index_problems(["tokenizer_version: expected 'kiwi-pos-v1', found 'x'"]) == "rebuild_all"
    assert classify_index_problems(["scope_config_hash: expected abc, found def"]) == "rebuild_all"
