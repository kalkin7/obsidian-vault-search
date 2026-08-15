/**
 * Agent integration (P2-1): make AI coding agents in this vault discover and
 * use the Vault Search Service.
 *
 * Installs three artifacts:
 *  1. A search wrapper script in the plugin directory (path-independent;
 *     the vault is derived from the script location).
 *  2. A managed `## Vault Search` section in the vault-root AGENTS.md
 *     (marker-guarded, idempotent, conflict-safe — see updateAgentsFile).
 *  3. A skill installed into every supported agent harness's skill directory
 *     (`.claude/skills`, `.codex/skills`, `.gemini/skills`, `.opencode/skills`
 *     and Antigravity's `.gemini/antigravity/skills`, registered in
 *     `.agent-skills.json`), all marker-guarded and never clobbering
 *     user-authored skills.
 *
 * Safety rules:
 *  - The vault-root AGENTS.md is only ever touched by an explicit user action
 *    (settings button / command), never automatically.
 *  - If AGENTS.md already contains search guidance OUTSIDE our marker block,
 *    the installer skips it and reports a conflict instead of duplicating or
 *    overwriting user-authored instructions.
 *  - Re-running the installer replaces only the marker-guarded block, so it
 *    never accumulates.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import * as path from "path";

export const AGENTS_MARKER_START = "<!-- vault-search:start -->";
export const AGENTS_MARKER_END = "<!-- vault-search:end -->";
const SKILL_MARKER = "<!-- vault-search:managed -->";

const AGENTS_FILE = "AGENTS.md";
/** Claude Code reads CLAUDE.md (not AGENTS.md). */
const CLAUDE_FILE = "CLAUDE.md";
const WRAPPER_REL = "search.ps1";

/** Instruction files that carry a self-contained copy of the managed block:
 *  AGENTS.md (Codex, and Antigravity CLI which also reads it) and CLAUDE.md
 *  (Claude Code). GEMINI.md is NOT written — Antigravity already reads
 *  AGENTS.md, so a third copy would be pure duplication. Each file is
 *  marker-guarded and never imports the others, so user-authored content in
 *  one file is never pulled into another harness. */
const INSTRUCTION_FILES = [AGENTS_FILE, CLAUDE_FILE] as const;

/** Skill install locations, one per supported agent harness, per official docs:
 *  - Claude Code reads .claude/skills.
 *  - .agents/skills is the universal agent-skills standard path: Antigravity
 *    (workspace skills), Codex (scans .agents/skills from CWD to the repo
 *    root; the old .codex/skills catalog is deprecated) and OpenCode all read
 *    it.
 *  - OpenCode additionally reads its own .opencode/skills.
 *  Gemini CLI was sunset for individual accounts (transitioned to Antigravity
 *  CLI, June 2026). */
const SKILL_TARGETS: string[][] = [
  [".claude", "skills", "vault-search", "SKILL.md"],
  [".agents", "skills", "vault-search", "SKILL.md"],
  [".opencode", "skills", "vault-search", "SKILL.md"],
];

/** Matches search guidance that may already exist in a user's AGENTS.md. */
const CONFLICT_RE =
  /(?:vault\s*[-_]?search|obsidian-vault-search|Vault Search|hybrid\s*search)/i;

export type AgentsFileStatus = "created" | "updated" | "unchanged" | "conflict";

export interface AgentsFileResult {
  status: AgentsFileStatus;
  /** Full new AGENTS.md content; null when nothing should be written. */
  content: string | null;
}

export interface AgentIntegrationStatus {
  agentsFile: "absent" | "managed" | "conflict" | "plain";
  /** CLAUDE.md status (Claude Code does not read AGENTS.md). */
  claudeFile: "absent" | "managed" | "conflict" | "plain";
  wrapper: boolean;
  /** Claude Code skill copy (.claude/skills/vault-search). */
  skill: "absent" | "managed" | "other";
  /** The universal .agents/skills copy (Antigravity, Codex, OpenCode). */
  agentsSkill: boolean;
}

export interface AgentIntegrationResult {
  agentsFile: AgentsFileStatus;
  claudeFile: AgentsFileStatus;
  wrapper: "written" | "unchanged";
  skill: "written" | "unchanged" | "skipped";
  /** Vault-relative path of the wrapper, for the AGENTS.md block. */
  wrapperPath: string;
}

const AGENTS_BLOCK = [
  AGENTS_MARKER_START,
  "## Vault Search",
  "",
  "This vault runs the **Vault Search Service** (hybrid lexical + semantic search).",
  "Use it as the default first tool for vault content searches.",
  "",
  "- Run the search wrapper from the vault root (it resolves the vault itself):",
  "  ```powershell",
  '  & .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Top 40 -Json "<query>"',
  "  & .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Status",
  "  ```",
  "- Treat results as candidates: read the full body of important files before concluding.",
  "- For broad/exhaustive/history requests, expand with additional searches using people, companies, projects, aliases, and related terms from the first pass.",
  "- If the exact target file is already known, read it directly instead of searching.",
  "- The plugin manages the index and service lifecycle; do not start a separate search daemon.",
  "- If `INDEX_REBUILD_REQUIRED` is returned, follow the reported recovery path (`rebuild-vectors` or `rebuild-all`).",
  "- Use `rg`/grep only to verify an exact known string or to debug search coverage — not as the normal search path.",
  AGENTS_MARKER_END,
].join("\n");

/** Claude Code reads CLAUDE.md, not AGENTS.md — but the managed block is a
 *  self-contained copy, never an @AGENTS.md import (see INSTRUCTION_FILES). */

/** The wrapper is written into the plugin directory by the installer. */
const SEARCH_PS1 = `# Vault Search Service — agent wrapper.
# Managed by the Vault Search plugin; edits are overwritten on reinstall.
# The vault is derived from this script's own location (no hardcoded paths).
param(
    [Parameter(Position = 0)][string]$Query = "",
    [int]$Top = 40,
    [switch]$Json,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$Vault = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path
$Canonical = [IO.Path]::GetFullPath($Vault).Replace('\\', '/').ToLowerInvariant()
$Sha = [Security.Cryptography.SHA256]::Create()
try { $Hash = ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Canonical)) | ForEach-Object { $_.ToString('x2') }) -join '' }
finally { $Sha.Dispose() }
$DataDir = Join-Path $env:LOCALAPPDATA ("ObsidianVaultSearch\\vaults\\" + $Hash.Substring(0, 20))
$MachinePath = Join-Path $DataDir "machine.json"
if (-not (Test-Path $MachinePath)) { throw "Vault Search backend is not installed for this PC." }
$Machine = Get-Content -Raw -Encoding UTF8 $MachinePath | ConvertFrom-Json
$Python = $Machine.pythonExecutable
if (-not (Test-Path $Python)) {
    # The configured value may be a bare command (e.g. "python"); resolve it.
    $Resolved = Get-Command $Python -ErrorAction SilentlyContinue
    if ($Resolved -and $Resolved.Source) { $Python = $Resolved.Source }
    else { throw "Configured Python does not exist: $Python" }
}
$Backend = Join-Path $Vault ".obsidian\\plugins\\obsidian-vault-search\\backend"
if (-not (Test-Path $Python)) { throw "Configured Python does not exist: $Python" }
if (-not (Test-Path $Backend)) { throw "Vault Search plugin backend is not installed." }
$env:PYTHONUTF8 = "1"
$env:PYTHONPATH = $Backend
$Arguments = @("-X", "utf8", "-m", "vault_search.cli", "--vault", $Vault, "--timeout", "30")
if ($Status) {
    $Arguments += "status"
} else {
    if (-not $Query) { throw "Query is required unless -Status is used." }
    $Arguments += @("search", "--top", [string]$Top)
    if ($Json) { $Arguments += "--json" }
    $Arguments += $Query
}
& $Python @Arguments
exit $LASTEXITCODE
`;

const SKILL_MD = `---
name: vault-search
description: Default vault content search. Start every vault content search with the vault-search plugin, expand with follow-up queries, and read the source files of important results. Use rg/grep only to verify exact known strings or debug search coverage.
license: Proprietary
metadata:
  displayName: "vault-search"
---

${SKILL_MARKER}

# Vault Search

Search and investigate Obsidian vault content.

## Core rules

1. Start every vault content search with the \`vault-search\` plugin.
2. Search results are candidates. Read the full body of important files before concluding.
3. For broad or exhaustive requests, run additional \`vault-search\` queries using entities, aliases, and related terms found in the first pass.
4. \`rg\`/grep is not the default search step. Use it only to verify an exact known string that the plugin appears to have missed, or to diagnose search coverage.
5. If the exact target file is already known, read it directly instead of searching.
6. Never hardcode machine-specific absolute vault paths; derive paths from the vault root.

## Standard search

Run from the vault root (the wrapper resolves the vault itself):

\`\`\`powershell
# Basic search
& .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Top 40 -Json "<query>"

# Service status
& .\\.obsidian\\plugins\\obsidian-vault-search\\search.ps1 -Status
\`\`\`

Use \`-Top 40\` as the default candidate size and read the source files of key results.

## Service behavior

- With Obsidian open: the plugin manages the vault's Python sidecar and model lifecycle.
- With Obsidian closed: \`search\` / \`rebuild-vectors\` / \`rebuild-all\` auto-start and attach a standalone sidecar using the machine configuration.
- The standalone unloads the model after 300s of model inactivity and exits after 1,800s of overall inactivity.
- If \`INDEX_REBUILD_REQUIRED\` is returned, follow the recovery path in the error message (\`rebuild-vectors\` or \`rebuild-all\`).

## \`rg\` exception usage

- Verify a known exact string that is missing from vault-search results.
- Re-check the existence of exact numbers, codes, or identifiers.
- Diagnose indexing/coverage problems.

Do not treat grep snippets alone as fact.
`;

/** Build the managed AGENTS.md block. */
export function buildAgentsBlock(): string {
  return AGENTS_BLOCK;
}

/** Build the PowerShell search wrapper source. */
export function searchWrapperSource(): string {
  return SEARCH_PS1;
}

/** Build the skill markdown source. */
export function skillSource(): string {
  return SKILL_MD;
}

/**
 * Decide how to merge the managed block into an existing AGENTS.md.
 * Pure and deterministic; no AI judgment involved.
 *
 * - Marker present            -> replace the block (idempotent).
 * - No marker, search content -> conflict (skip; the vault owns its
 *                                instructions).
 * - No marker, no conflict    -> append.
 */
export function updateAgentsFile(
  existing: string | null,
  block: string = AGENTS_BLOCK,
): AgentsFileResult {
  const body = `${block}\n`;
  if (existing === null) {
    return { status: "created", content: body };
  }
  const start = existing.indexOf(AGENTS_MARKER_START);
  const end = existing.indexOf(AGENTS_MARKER_END);
  if (start >= 0 && end > start) {
    // Protect user-authored search guidance OUTSIDE the managed block: even
    // when our marker exists, a conflict in the remaining content must abort
    // (no block rewrite) instead of leaving two instruction sets.
    const outside =
      existing.slice(0, start) + existing.slice(end + AGENTS_MARKER_END.length);
    if (CONFLICT_RE.test(outside)) {
      return { status: "conflict", content: null };
    }
    // Normalize the separator after the managed block: the body already ends
    // with a newline, so collapse any blank lines that follow the marker.
    // Without this, every re-run adds another blank line and the result is
    // never "unchanged".
    const after = existing
      .slice(end + AGENTS_MARKER_END.length)
      .replace(/^[ \t]*\r?\n+/, "");
    const tail = after.trim().length > 0 ? `\n${after}` : after;
    const next = existing.slice(0, start) + body + tail;
    return {
      status: next === existing ? "unchanged" : "updated",
      content: next,
    };
  }
  if (CONFLICT_RE.test(existing)) {
    return { status: "conflict", content: null };
  }
  const next = `${existing.replace(/\s*$/, "")}\n\n${body}`;
  return { status: "updated", content: next };
}

/** Read a file, treating only "absent" (ENOENT) as null; other failures
 * (permission, sharing) must propagate so an unreadable existing AGENTS.md is
 * never silently treated as absent and overwritten. */
async function readOptional(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

/** Read for status display: any failure means "absent" (informational only). */
async function readForStatus(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

async function writeIfChanged(
  target: string,
  content: string,
): Promise<boolean> {
  if ((await readOptional(target)) === content) return false;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return true;
}

async function installSkill(
  skillPath: string,
): Promise<"written" | "unchanged" | "skipped"> {
  const existing = await readOptional(skillPath);
  if (existing !== null && !existing.includes(SKILL_MARKER)) {
    // A user-authored skill already exists; do not clobber it.
    return "skipped";
  }
  const changed = await writeIfChanged(skillPath, SKILL_MD);
  return changed ? "written" : "unchanged";
}

/** Install the managed skill into every supported agent harness's directory.
 *  A user-authored skill at one location only skips that location — the
 *  others are still refreshed. */
async function installSkills(
  vaultPath: string,
): Promise<AgentIntegrationResult["skill"]> {
  let anyWritten = false;
  let anySkipped = false;
  let anyTargets = 0;
  for (const rel of SKILL_TARGETS) {
    const result = await installSkill(path.join(vaultPath, ...rel));
    anyTargets += 1;
    if (result === "written") anyWritten = true;
    if (result === "skipped") anySkipped = true;
  }
  if (anyWritten) return "written";
  return anySkipped && anyTargets === SKILL_TARGETS.length
    ? "skipped"
    : "unchanged";
}

/** Human-readable install summary for Notices. */
export function agentIntegrationNotice(result: AgentIntegrationResult): string {
  const agents =
    result.agentsFile === "created"
      ? "AGENTS.md 생성"
      : result.agentsFile === "updated"
        ? "AGENTS.md 갱신"
        : result.agentsFile === "conflict"
          ? "AGENTS.md에 기존 검색 지시가 있어 건너뜀"
          : "AGENTS.md 동일";
  const claude =
    result.claudeFile === "created"
      ? "CLAUDE.md 생성"
      : result.claudeFile === "updated"
        ? "CLAUDE.md 갱신"
        : result.claudeFile === "conflict"
          ? "CLAUDE.md에 기존 검색 지시가 있어 건너뜀"
          : "CLAUDE.md 동일";
  const skill =
    result.skill === "written"
      ? "스킬 설치"
      : result.skill === "skipped"
        ? "기존 스킬 유지(건너뜀)"
        : "스킬 동일";
  return `에이전트 통합: ${agents} / ${claude} / 래퍼 ${result.wrapper === "written" ? "설치" : "동일"} / ${skill} (Claude/Codex/Antigravity/OpenCode)`;
}

/** Install (or refresh) all three artifacts. Returns a summary for the UI. */
export async function installAgentIntegration(
  vaultPath: string,
  pluginDir: string,
): Promise<AgentIntegrationResult> {
  const wrapperPath = path.join(pluginDir, WRAPPER_REL);
  const wrapperChanged = await writeIfChanged(wrapperPath, SEARCH_PS1);
  const wrapper: AgentIntegrationResult["wrapper"] = wrapperChanged
    ? "written"
    : "unchanged";

  // Every instruction file (AGENTS.md / CLAUDE.md) carries a self-contained,
  // marker-guarded copy of the same block — never an import, so user-authored
  // content in one file is never pulled into another harness.
  const fileStatus: Partial<
    Record<(typeof INSTRUCTION_FILES)[number], AgentsFileStatus>
  > = {};
  for (const name of INSTRUCTION_FILES) {
    const target = path.join(vaultPath, name);
    const existing = await readOptional(target);
    const result = updateAgentsFile(existing, AGENTS_BLOCK);
    if (result.content !== null) {
      await writeFile(target, result.content, "utf8");
    }
    fileStatus[name] = result.status;
  }

  const skill = await installSkills(vaultPath);

  return {
    agentsFile: fileStatus[AGENTS_FILE] ?? "unchanged",
    claudeFile: fileStatus[CLAUDE_FILE] ?? "unchanged",
    wrapper,
    skill,
    wrapperPath: path.join(
      ".obsidian",
      "plugins",
      path.basename(pluginDir),
      WRAPPER_REL,
    ),
  };
}

/** Current installed state, for the settings tab. */
export async function agentIntegrationStatus(
  vaultPath: string,
  pluginDir: string,
): Promise<AgentIntegrationStatus> {
  // Status is informational: unreadable files (permission/sharing) degrade to
  // "absent" rather than failing the settings tab.
  const readFileStatus = async (
    name: string,
  ): Promise<"absent" | "managed" | "conflict" | "plain"> => {
    const content = await readForStatus(path.join(vaultPath, name));
    if (content === null) return "absent";
    if (content.includes(AGENTS_MARKER_START)) return "managed";
    if (CONFLICT_RE.test(content)) return "conflict";
    return "plain";
  };
  const agentsFile = await readFileStatus(AGENTS_FILE);
  const claudeFile = await readFileStatus(CLAUDE_FILE);

  const wrapper =
    (await readForStatus(path.join(pluginDir, WRAPPER_REL))) !== null;

  const skillContent = await readForStatus(
    path.join(vaultPath, ...SKILL_TARGETS[0]),
  );
  const skill: AgentIntegrationStatus["skill"] =
    skillContent === null
      ? "absent"
      : skillContent.includes(SKILL_MARKER)
        ? "managed"
        : "other";

  // The universal .agents/skills copy is what Antigravity, Codex and OpenCode
  // read (Claude Code uses the .claude copy above).
  const agentsSkill =
    (await readForStatus(
      path.join(vaultPath, ".agents", "skills", "vault-search", "SKILL.md"),
    )) !== null;

  return { agentsFile, claudeFile, wrapper, skill, agentsSkill };
}
