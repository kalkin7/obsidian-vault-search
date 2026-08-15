# Agent integration

AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, …) only use a
search service if they can discover it. This plugin installs three artifacts
into a vault so agents find and use `vault-search`:

1. **A search wrapper** (`search.ps1`) in the plugin directory — path
   independent, resolves the vault from its own location.
2. **A managed `## Vault Search` section** in the vault-root `AGENTS.md` — the
   cross-agent convention every major coding agent reads.
3. **A skill** at `.claude/skills/vault-search/SKILL.md` for skill-aware agents.

## Activation

The installer only ever runs on **explicit user action**:

- Settings tab → **에이전트 통합 → 설치/갱신**, or
- Command palette → **Install agent integration**.

Nothing is written automatically at startup.

## What gets written

| Artifact | Location | Notes |
| --- | --- | --- |
| Wrapper | `<vault>/.obsidian/plugins/obsidian-vault-search/search.ps1` | `$PSScriptRoot/../../..` derives the vault root; no hardcoded paths |
| AGENTS.md block | `<vault>/AGENTS.md` | Marker-guarded, idempotent |
| Skill | `<vault>/.claude/skills/vault-search/SKILL.md` | Marker-guarded, never clobbers user skills |

The wrapper usage (as shown in the AGENTS.md block):

```powershell
& .\.obsidian\plugins\obsidian-vault-search\search.ps1 -Top 40 -Json "<query>"
& .\.obsidian\plugins\obsidian-vault-search\search.ps1 -Status
```

The wrapper reads `machine.json` for the Python executable (resolving bare
commands such as `python` via `Get-Command`), sets `PYTHONPATH` to the plugin's
backend folder, and invokes `vault_search.cli`.

## AGENTS.md merge rules (`updateAgentsFile`)

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

Only `AGENTS.md` is written. `CLAUDE.md`/`GEMINI.md` are left untouched to avoid
duplicated instructions (Claude Code and Gemini CLI both read `AGENTS.md`).

## Skill

`.claude/skills/vault-search/SKILL.md` carries a `<!-- vault-search:managed -->`
marker. An existing skill without that marker is a user artifact and is left
alone (`skipped`); otherwise it is refreshed idempotently.

## Fault tolerance

- An unreadable existing `AGENTS.md` (permission/sharing errors) aborts the
  install — it is never silently treated as absent and overwritten.
- The status shown in the settings tab degrades unreadable files to "absent"
  for display purposes only.
