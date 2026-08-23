"""Skill discovery / progressive-loading boundary tests (plan §8)."""

import subprocess
from pathlib import Path

import pytest

from vault_search.skills import (
    MAX_DESCRIPTION_CHARS,
    MAX_SKILL_MD_BYTES,
    RunResourceBudget,
    SkillError,
    SkillRegistry,
)


def write_skill(root: Path, name: str, body: str = "Body text") -> Path:
    skill_dir = root / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} skill\n---\n{body}\n",
        encoding="utf-8",
    )
    return skill_dir


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    return tmp_path


def test_project_roots_discovered_and_enabled(vault: Path):
    write_skill(vault / ".claude" / "skills", "alpha")
    write_skill(vault / ".agents" / "skills", "beta")
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)]
    )
    ids = {entry.id for entry in scan.entries}
    assert "project:.claude:alpha" in ids
    assert all("beta" not in entry.id for entry in scan.entries)
    states = {root.root_id: root.state for root in scan.roots}
    assert states["project:.claude"] == "ok"
    assert states["project:.agents"] == "disabled"


def test_user_absolute_root_opt_in(vault: Path, tmp_factory=None):
    external = vault.parent / "external-skills"
    write_skill(external, "gamma")
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("ext", str(external), True)]
    )
    assert any(entry.id == "ext:gamma" for entry in scan.entries)


def test_traversal_user_root_rejected(vault: Path):
    registry = SkillRegistry(vault)
    scan = registry.refresh(user_roots=[("bad", "../outside", True)])
    state = next(r for r in scan.roots if r.root_id == "bad")
    assert state.state == "error"


def test_bom_and_crlf_frontmatter(vault: Path):
    skill_dir = vault / ".claude" / "skills" / "bom"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_bytes(
        b"\xef\xbb\xbf---\r\nname: bom-skill\r\ndescription: handles BOM\r\n---\r\nbody\r\n"
    )
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)]
    )
    assert any(entry.name == "bom-skill" for entry in scan.entries)


def test_malformed_frontmatter_isolated(vault: Path):
    skill_dir = vault / ".claude" / "skills" / "broken"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: [unclosed\n  bad yaml: :::\n", encoding="utf-8"
    )
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)]
    )
    assert scan.entries == []
    assert any("broken" in problem for problem in scan.problems)


def test_missing_name_isolated(vault: Path):
    skill_dir = vault / ".claude" / "skills" / "no-name"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\ndescription: x\n---\nbody\n", encoding="utf-8")
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)]
    )
    assert not scan.entries
    assert any("'name' missing" in p for p in scan.problems)


def test_duplicate_names_conflict(vault: Path):
    write_skill(vault / ".claude" / "skills", "dupe")
    write_skill(vault / ".agents" / "skills", "Dupe")
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[
            ("project:.claude", ".claude/skills", True),
            ("project:.agents", ".agents/skills", True),
        ]
    )
    assert scan.conflicts, scan.conflicts


def test_oversized_skill_md_isolated(vault: Path):
    skill_dir = write_skill(vault / ".claude" / "skills", "huge")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: huge\ndescription: d\n---\n" + "x" * (MAX_SKILL_MD_BYTES + 10),
        encoding="utf-8",
    )
    registry = SkillRegistry(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)]
    )
    assert not any(e.name == "huge" for e in scan.entries)
    assert any("exceeds" in p for p in scan.problems)


def test_junction_escape_skipped(vault: Path):
    # The junction IS a skill directory whose SKILL.md lives behind the
    # reparse point — discovery must reject it as a root escape.
    real_skill_root = vault.parent / "outside-real-skills"
    write_skill(real_skill_root, "escapee")
    link = vault / ".claude" / "skills" / "jailbreak"
    link.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["cmd.exe", "/c", "mklink", "/J", str(link), str(real_skill_root / "escapee")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.skip("junction creation unavailable")
    try:
        registry = SkillRegistry(vault)
        scan = registry.refresh(
            user_roots=[("project:.claude", ".claude/skills", True)]
        )
        assert not any("escapee" in e.name for e in scan.entries)
        assert any("escapes its root" in p for p in scan.problems)
    finally:
        subprocess.run(["cmd.exe", "/c", "rmdir", str(link)], capture_output=True)


def test_load_body_returns_full_file(vault: Path):
    write_skill(vault / ".claude" / "skills", "reader", body="Custom instructions")
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    body = registry.load_body("project:.claude:reader")
    assert "Custom instructions" in body
    assert body.startswith("---")


def test_read_resource_happy_and_boundaries(vault: Path):
    skill_dir = write_skill(vault / ".claude" / "skills", "res")
    (skill_dir / "reference.md").write_text("# Ref\ncontent", encoding="utf-8")
    (skill_dir / ".env").write_text("SECRET=1", encoding="utf-8")
    (skill_dir / "server.key").write_text("-----BEGIN", encoding="utf-8")
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    budget = RunResourceBudget()
    text = registry.read_resource("project:.claude:res", "reference.md", budget)
    assert "content" in text
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:res", "../other.md", budget)
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:res", str(skill_dir / "reference.md"), budget)
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:res", ".env", budget)
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:res", "server.key", budget)
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:res", "missing.md", budget)


def test_run_resource_budget_exhaustion(vault: Path):
    skill_dir = write_skill(vault / ".claude" / "skills", "budget")
    # 5 x 60 KiB > the 256 KiB run budget while staying under the 64 KiB
    # per-file cap.
    for letter in "abcde":
        (skill_dir / f"{letter}.txt").write_text(letter * 60000, encoding="utf-8")
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    budget = RunResourceBudget()
    for letter in "abcd":
        registry.read_resource("project:.claude:budget", f"{letter}.txt", budget)
    with pytest.raises(SkillError):
        registry.read_resource("project:.claude:budget", "e.txt", budget)


def test_unknown_skill_raises(vault: Path):
    registry = SkillRegistry(vault)
    registry.refresh()
    with pytest.raises(SkillError):
        registry.load_body("nowhere:none")


def test_status_shape(vault: Path):
    write_skill(vault / ".claude" / "skills", "st")
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    status = registry.status()
    assert status["active_count"] == 1
    assert status["catalog_chars"] > 0
    claude_root = next(
        root for root in status["roots"] if root["id"] == "project:.claude"
    )
    assert claude_root["state"] == "ok"


def test_description_truncated(vault: Path):
    skill_dir = vault / ".claude" / "skills" / "longdesc"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: longdesc\ndescription: "
        + "d" * (MAX_DESCRIPTION_CHARS + 100)
        + "\n---\nx",
        encoding="utf-8",
    )
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    entry = registry.get("project:.claude:longdesc")
    assert entry is not None
    assert len(entry.description) <= MAX_DESCRIPTION_CHARS


# ---------------------------------------------------------------------------
# enabledSkills allowlist (fix §4)
# ---------------------------------------------------------------------------


def _two_skill_vault(vault: Path) -> SkillRegistry:
    write_skill(vault / ".claude" / "skills", "alpha")
    write_skill(vault / ".claude" / "skills", "beta")
    registry = SkillRegistry(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    return registry


def test_enabled_skills_allowlist_filters_catalog(vault: Path):
    registry = _two_skill_vault(vault)
    scan = registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)],
        enabled_skills={"project:.claude:alpha"},
    )
    # Discovery still reports both; the catalog only exposes the allowlist.
    assert {entry.id for entry in scan.entries} == {
        "project:.claude:alpha",
        "project:.claude:beta",
    }
    assert [entry.id for entry in registry.catalog_entries()] == [
        "project:.claude:alpha"
    ]
    assert all("beta" not in line for line in registry.catalog_lines())
    with pytest.raises(SkillError):
        registry.load_body("project:.claude:beta")


def test_empty_enabled_skills_means_no_active_skills(vault: Path):
    registry = _two_skill_vault(vault)
    registry.refresh(
        user_roots=[("project:.claude", ".claude/skills", True)],
        enabled_skills=set(),
    )
    assert registry.catalog_entries() == []
    assert registry.catalog_lines() == []
    assert registry.status()["active_count"] == 0


def test_none_enabled_skills_keeps_discovered_default(vault: Path):
    registry = _two_skill_vault(vault)
    registry.refresh(user_roots=[("project:.claude", ".claude/skills", True)])
    assert len(registry.catalog_entries()) == 2
