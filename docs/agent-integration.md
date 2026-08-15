# Agent integration

AI coding agents (Claude Code, Codex, Antigravity, OpenCode, …) only use a
search service if they can discover it. This plugin installs three artifacts
into a vault so agents find and use `vault-search`:

1. **A search wrapper** (`search.ps1`) in the plugin directory — path
   independent, resolves the vault from its own location.
2. **A managed `## Vault Search` section** in the vault-root `AGENTS.md` — the
   cross-agent convention read by Codex and Gemini CLI, plus a managed
   `CLAUDE.md` block that imports it for Claude Code (which reads `CLAUDE.md`,
   not `AGENTS.md`).
3. **A skill** (open Agent Skills format: `name` + `description` frontmatter)
   installed into every supported harness's skill directory.

## Activation

The installer only ever runs on **explicit user action**:

- Settings tab → **에이전트 통합 → 설치/갱신**, or
- Command palette → **Install agent integration**.

Nothing is written automatically at startup.

## What gets written

| Artifact | Location | Notes |
| --- | --- | --- |
| Wrapper | `<vault>/.obsidian/plugins/obsidian-vault-search/search.ps1` | `$PSScriptRoot/../../..` derives the vault root; no hardcoded paths |
| AGENTS.md block | `<vault>/AGENTS.md` | Marker-guarded, idempotent; read by Codex and Gemini CLI |
| CLAUDE.md block | `<vault>/CLAUDE.md` | Marker-guarded; self-contained copy of the vault-search instructions so Claude Code gets them without importing any user-authored AGENTS.md content |
| Skill (Claude Code) | `<vault>/.claude/skills/vault-search/SKILL.md` | Marker-guarded, never clobbers user skills |
| Skill (Antigravity / Codex / OpenCode) | `<vault>/.agents/skills/vault-search/SKILL.md` | Universal agent-skills path: Antigravity workspace skills, Codex (scans `.agents/skills` from CWD to repo root; the old `.codex/skills` catalog is deprecated), OpenCode |
| Skill (OpenCode) | `<vault>/.opencode/skills/vault-search/SKILL.md` | Explicit copy; OpenCode also reads `.claude/skills` and `.agents/skills` |

The wrapper usage (as shown in the AGENTS.md block):

```powershell
& .\.obsidian\plugins\obsidian-vault-search\search.ps1 -Top 40 -Json "<query>"
& .\.obsidian\plugins\obsidian-vault-search\search.ps1 -Status
```

The wrapper reads `machine.json` for the Python executable (resolving bare
commands such as `python` via `Get-Command`), sets `PYTHONPATH` to the plugin's
backend folder, and invokes `vault_search.cli`.

> **Gemini CLI** was sunset for individual accounts (transitioned to Antigravity
> CLI, June 2026), so no `.gemini/skills` copy is written. Antigravity skills
> use the standard `.agents/skills` location.

## AGENTS.md / CLAUDE.md merge rules (`updateAgentsFile`)

The block is delimited by explicit markers:

```markdown
<!-- vault-search:start -->
## Vault Search
…
<!-- vault-search:end -->
```

- **Marker present** → the block is replaced in place. The separator after the
  block is normalized, so re-running never accumulates blank lines and a second
  run with identical content reports `unchanged` (idempotent).
- **No marker, but search guidance exists elsewhere** (`vault-search`,
  `obsidian-vault-search`, `Vault Search`, `hybrid search`, case-insensitive) →
  the installer reports `conflict` and **does not modify the file**. This
  protects user-authored instructions (e.g. K_Notes' hand-tuned AGENTS.md).
- **No marker, no conflict** → the block is appended (or the file created).

The conflict check also applies to content **outside** an existing marker
block: if a vault later hand-authors search guidance next to our managed block,
installs abort instead of leaving two instruction sets.

The same rules manage `CLAUDE.md`, whose managed block is a **self-contained
copy** of the same vault-search instructions:

```markdown
<!-- vault-search:start -->
## Vault Search
…
<!-- vault-search:end -->
```

Claude Code reads `CLAUDE.md` (not `AGENTS.md`). The block is deliberately NOT
an `@AGENTS.md` import: an import would pull the entire file — including any
user-authored content — into Claude's context. Both files carry only the
managed instructions, so each harness sees exactly the vault-search block and
nothing else. `GEMINI.md` is left untouched (Gemini CLI reads `AGENTS.md` and
has been superseded by Antigravity CLI for individual accounts).

## Skill

Every copy carries a `<!-- vault-search:managed -->` marker. An existing skill
without that marker is a user artifact and is left alone (`skipped`);
otherwise it is refreshed idempotently at all three locations. The frontmatter
uses the portable open Agent Skills core (`name` + `description`), which all
supported harnesses document.

## Fault tolerance

- An unreadable existing `AGENTS.md` (permission/sharing errors) aborts the
  install — it is never silently treated as absent and overwritten.
- The status shown in the settings tab degrades unreadable files to "absent"
  for display purposes only.
