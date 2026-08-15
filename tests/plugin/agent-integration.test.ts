import { describe, expect, it } from "vitest";
import * as path from "path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  agentIntegrationStatus,
  buildAgentsBlock,
  installAgentIntegration,
  searchWrapperSource,
  skillSource,
  updateAgentsFile,
} from "../../src/agent-integration";

describe("buildAgentsBlock", () => {
  it("is marker-guarded and references the wrapper", () => {
    const block = buildAgentsBlock();
    expect(block.startsWith(AGENTS_MARKER_START)).toBe(true);
    expect(block.endsWith(AGENTS_MARKER_END)).toBe(true);
    expect(block).toContain("search.ps1 -Top 40 -Json");
  });
});

describe("searchWrapperSource", () => {
  it("derives the vault from the script location, never hardcoding paths", () => {
    const source = searchWrapperSource();
    expect(source).toContain("$PSScriptRoot");
    expect(source).toContain('"..\\..\\.."');
    expect(source).toContain("vault_search.cli");
    // No machine-specific absolute path must leak into the wrapper.
    expect(source).not.toMatch(/[A-Z]:\\/);
  });
});

describe("skillSource", () => {
  it("carries the managed marker for idempotent reinstall", () => {
    const source = skillSource();
    expect(source).toContain("name: vault-search");
    expect(source).toContain("<!-- vault-search:managed -->");
  });
});

describe("updateAgentsFile", () => {
  const block = buildAgentsBlock();

  it("creates the file when none exists", () => {
    const result = updateAgentsFile(null, block);
    expect(result.status).toBe("created");
    expect(result.content).toBe(`${block}\n`);
  });

  it("replaces only the marker block and keeps surrounding content", () => {
    const existing = [
      "# Project rules",
      "",
      "Some existing guidance.",
      AGENTS_MARKER_START,
      "## Vault Search",
      "old content",
      AGENTS_MARKER_END,
      "",
      "## Other section",
      "kept",
    ].join("\n");
    const result = updateAgentsFile(existing, block);
    expect(result.status).toBe("updated");
    expect(result.content).toContain("# Project rules");
    expect(result.content).toContain("Some existing guidance.");
    expect(result.content).toContain("## Other section");
    expect(result.content).toContain("kept");
    expect(result.content).not.toContain("old content");
    expect(
      (result.content!.match(new RegExp(AGENTS_MARKER_START, "g")) || [])
        .length,
    ).toBe(1);
    expect(
      (result.content!.match(new RegExp(AGENTS_MARKER_END, "g")) || []).length,
    ).toBe(1);
  });

  it("is idempotent: a second run with the same block reports unchanged", () => {
    const existing =
      "# Rules\n\n" +
      AGENTS_MARKER_START +
      "\nold content\n" +
      AGENTS_MARKER_END +
      "\n\nMore.\n";
    const first = updateAgentsFile(existing, block);
    expect(first.status).toBe("updated");
    const second = updateAgentsFile(first.content!, block);
    expect(second.status).toBe("unchanged");
    expect(second.content).toBe(first.content);
  });

  it("conflicts (never clobbers) when search guidance exists outside the marker", () => {
    const existing = "# Rules\n\nUse the vault-search CLI for all searches.\n";
    const result = updateAgentsFile(existing, block);
    expect(result.status).toBe("conflict");
    expect(result.content).toBeNull();
  });

  it("conflicts even when our marker exists but user guidance sits outside it", () => {
    const existing =
      "# Rules\n\nUse vault-search for all searches.\n\n" +
      AGENTS_MARKER_START +
      "\n## Vault Search\nmanaged\n" +
      AGENTS_MARKER_END +
      "\n";
    const result = updateAgentsFile(existing, block);
    expect(result.status).toBe("conflict");
    expect(result.content).toBeNull();
  });

  it("appends to a plain file without search guidance", () => {
    const existing = "# Rules\n";
    const result = updateAgentsFile(existing, block);
    expect(result.status).toBe("updated");
    expect(result.content).toContain("# Rules");
    expect(result.content).toContain(AGENTS_MARKER_START);
  });
});

describe("installAgentIntegration (filesystem)", () => {
  it("installs all three artifacts and is idempotent on re-run", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "vault-search-agent-"));
    const vault = path.join(tmp, "vault");
    const pluginDir = path.join(
      vault,
      ".obsidian",
      "plugins",
      "obsidian-vault-search",
    );
    await mkdir(pluginDir, { recursive: true });
    try {
      const first = await installAgentIntegration(vault, pluginDir);
      expect(first.agentsFile).toBe("created");
      expect(first.wrapper).toBe("written");
      expect(first.skill).toBe("written");

      const agents = await readFile(path.join(vault, "AGENTS.md"), "utf8");
      expect(agents).toContain(AGENTS_MARKER_START);
      expect(agents).toContain(AGENTS_MARKER_END);
      expect(agents).toContain("search.ps1");

      const wrapper = await readFile(
        path.join(pluginDir, "search.ps1"),
        "utf8",
      );
      expect(wrapper).toContain("vault_search.cli");

      const skill = await readFile(
        path.join(vault, ".claude", "skills", "vault-search", "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain("<!-- vault-search:managed -->");

      const second = await installAgentIntegration(vault, pluginDir);
      expect(second.agentsFile).toBe("unchanged");
      expect(second.wrapper).toBe("unchanged");
      expect(second.skill).toBe("unchanged");

      const status = await agentIntegrationStatus(vault, pluginDir);
      expect(status.agentsFile).toBe("managed");
      expect(status.wrapper).toBe(true);
      expect(status.skill).toBe("managed");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("never clobbers a vault AGENTS.md that already has search guidance", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "vault-search-conflict-"));
    const vault = path.join(tmp, "vault");
    const pluginDir = path.join(
      vault,
      ".obsidian",
      "plugins",
      "obsidian-vault-search",
    );
    await mkdir(pluginDir, { recursive: true });
    const handWritten =
      "# Rules\n\nUse the vault-search CLI for all searches.\n";
    await writeFile(path.join(vault, "AGENTS.md"), handWritten, "utf8");
    try {
      const result = await installAgentIntegration(vault, pluginDir);
      expect(result.agentsFile).toBe("conflict");
      const after = await readFile(path.join(vault, "AGENTS.md"), "utf8");
      expect(after).toBe(handWritten);
      const status = await agentIntegrationStatus(vault, pluginDir);
      expect(status.agentsFile).toBe("conflict");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
