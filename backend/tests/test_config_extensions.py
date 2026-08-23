"""Config parser tests for the agent extensions (plan §6.3)."""

import json
from pathlib import Path


from vault_search.config import (
    MAX_MCP_SERVERS,
    MAX_PROJECT_RULES_CHARS,
    load_config,
)


def write_config(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "service-config.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def base_payload(**overrides) -> dict:
    payload = {
        "vaultPath": str(Path.cwd()),
        "dataDir": None,  # filled per-test
    }
    payload.update(overrides)
    return payload


def test_defaults_keep_extensions_off(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {"vaultPath": str(tmp_path), "dataDir": str(data_dir)},
        )
    )
    assert config.mcp_enabled is False
    assert config.mcp_servers == []
    assert config.skills_enabled is False
    assert config.project_rules == ""
    assert config.enabled_skills == set()


def test_project_rules_bounded_and_control_chars_rejected(tmp_path: Path):
    data_dir = tmp_path / "data"
    long_rules = "r" * (MAX_PROJECT_RULES_CHARS + 100)
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "answerProjectRules": long_rules,
            },
        )
    )
    assert len(config.project_rules) == MAX_PROJECT_RULES_CHARS
    assert any("truncated" in p for p in config.config_problems)

    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "answerProjectRules": "ok\x00bad",
            },
        )
    )
    assert config.project_rules == ""
    assert any("control" in p for p in config.config_problems)


def make_server_entry(entry_id="s1", name="Server One", **overrides) -> dict:
    entry = {
        "id": entry_id,
        "name": name,
        "command": "python",
        "args": ["-x"],
        "cwd": "vault",
        "envNames": ["TOKEN_A"],
        "toolPolicies": {"tool_a": "ask"},
        "enabled": True,
    }
    entry.update(overrides)
    return entry


def test_valid_servers_parsed(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpEnabled": True,
                "mcpServers": [make_server_entry()],
            },
        )
    )
    assert len(config.mcp_servers) == 1
    server = config.mcp_servers[0]
    assert server.id == "s1"
    assert server.args == ["-x"]
    assert server.tool_policies == {"tool_a": "ask"}
    assert config.config_problems == []


def test_bad_entries_isolated_without_blocking_start(tmp_path: Path):
    data_dir = tmp_path / "data"
    entries = [
        make_server_entry("good", "Good"),
        make_server_entry("", "NoId"),
        make_server_entry("dup", "Dup"),
        make_server_entry("dup", "Dup2"),
        make_server_entry("nc", "No Command", command=""),
        make_server_entry("many", "Many Args", args=["a"] * 65),
        make_server_entry("ctrl", "Ctrl", command="py\x00thon"),
        make_server_entry("cwd", "Bad Cwd", cwd=str(tmp_path / "missing-dir")),
    ]
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": entries,
            },
        )
    )
    ids = [server.id for server in config.mcp_servers]
    # "good" and the FIRST "dup" survive; the duplicate-id entry is isolated.
    assert ids == ["good", "dup"]
    assert len(config.config_problems) == 6


def test_plugin_cwd_requires_existing_plugin_path(tmp_path: Path):
    data_dir = tmp_path / "data"
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "pluginPath": str(plugin_dir),
                "mcpServers": [make_server_entry("p1", "P", cwd="plugin")],
            },
        )
    )
    assert config.mcp_servers[0].cwd == "plugin"

    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [make_server_entry("p2", "P", cwd="plugin")],
            },
        )
    )
    assert config.mcp_servers == []
    assert any("plugin" in p for p in config.config_problems)


def test_env_names_and_policy_bounds(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [
                    make_server_entry(
                        "env",
                        "Env",
                        envNames=["1BAD", "OK_NAME", "OK_NAME"],
                    ),
                    make_server_entry(
                        "pol",
                        "Pol",
                        toolPolicies={f"t{i}": ("ask" if i % 2 else "deny") for i in range(600)},
                    ),
                ],
            },
        )
    )
    assert [s.id for s in config.mcp_servers] == []
    problems = " | ".join(config.config_problems)
    assert "env" in problems and "pol" in problems


def test_skill_roots_and_enabled_skills(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "skillsEnabled": True,
                "skillRoots": [
                    {"id": "r1", "path": ".claude/skills", "enabled": True},
                    {"id": "", "path": "x"},
                    {"id": "r1", "path": "y"},
                ],
                "enabledSkills": ["project:.claude:alpha", ""],
            },
        )
    )
    assert [root.id for root in config.skill_roots] == ["r1"]
    assert config.enabled_skills == {"project:.claude:alpha"}


def test_server_cap_enforced(tmp_path: Path):
    data_dir = tmp_path / "data"
    servers = [
        make_server_entry(f"s{i}", f"S{i}") for i in range(MAX_MCP_SERVERS + 5)
    ]
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": servers,
            },
        )
    )
    assert len(config.mcp_servers) == MAX_MCP_SERVERS
    assert any("dropped" in p for p in config.config_problems)


def test_http_transport_servers_are_accepted(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [
                    make_server_entry(
                        "remote-1",
                        "Korean Law",
                        transport="http",
                        url="https://mcp.gomdori.app/law?oc=honggildong",
                    ),
                ],
            },
        )
    )
    assert not any("MCP server" in p for p in config.config_problems)
    server = config.mcp_servers[0]
    assert server.transport == "http"
    assert server.url.endswith("/law?oc=honggildong")
    assert server.command == ""


def test_stdio_servers_default_to_stdio_transport(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [make_server_entry("s1", "Local")],
            },
        )
    )
    assert config.mcp_servers[0].transport == "stdio"
    assert config.mcp_servers[0].url == ""


def test_invalid_http_entries_are_isolated(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [
                    {"id": "r1", "name": "No Url", "transport": "http"},
                    {
                        "id": "r2",
                        "name": "Bad Scheme",
                        "transport": "http",
                        "url": "ftp://example.com/mcp",
                    },
                    {
                        "id": "r3",
                        "name": "Not A Url",
                        "transport": "http",
                        "url": "not a url at all",
                    },
                    make_server_entry("ok1", "Still Fine"),
                ],
            },
        )
    )
    assert [server.id for server in config.mcp_servers] == ["ok1"]
    assert len([p for p in config.config_problems if "MCP server" in p]) >= 3


def test_unknown_transport_rejected(tmp_path: Path):
    data_dir = tmp_path / "data"
    config = load_config(
        write_config(
            tmp_path,
            {
                "vaultPath": str(tmp_path),
                "dataDir": str(data_dir),
                "mcpServers": [
                    make_server_entry("s1", "Weird", transport="websocket"),
                ],
            },
        )
    )
    assert config.mcp_servers == []
    assert any("transport" in p for p in config.config_problems)
