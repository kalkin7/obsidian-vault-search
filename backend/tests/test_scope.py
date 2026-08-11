from pathlib import Path

import pytest

from vault_search.scope import glob_match, is_in_scope, normalize_relative, resolve_inside_vault


def test_double_star_matches_root_and_nested():
    assert glob_match("root.md", "**/*.md")
    assert glob_match("folder/note.md", "**/*.md")


def test_scope_include_exclude():
    assert is_in_scope("2_Area/note.md", ["2_Area/**"], ["9_System/**"])
    assert not is_in_scope("9_System/note.md", ["**/*.md"], ["9_System/**"])
    assert not is_in_scope("2_Area/image.png", ["2_Area/**"], [])


def test_path_traversal_rejected(tmp_path: Path):
    with pytest.raises(ValueError):
        normalize_relative("../outside.md")
    with pytest.raises(ValueError):
        resolve_inside_vault(tmp_path, "../outside.md")
