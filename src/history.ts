import { normalizePath, type Vault } from "obsidian";
import type { Citation } from "./types";
import { toNoteMarkdown } from "./answer-renderer";

/** Default folder (relative to vault root) for AI search history notes. */
export const DEFAULT_HISTORY_FOLDER = "AI Vault Search/history";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** A saved AI-search conversation. `messages` holds the RAW transcript
 *  ([S#] markers intact) — the lossless source for reloading the panel;
 *  the note body shows the converted, note-ready markdown for humans. */
export interface HistorySession {
  title: string;
  created: string; // ISO timestamp
  provider: string;
  model: string;
  reasoningEffort: string;
  messages: HistoryMessage[];
  citations: Citation[];
}

export interface HistoryMeta {
  /** Vault-relative path of the history note. */
  file: string;
  title: string;
  created: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  messageCount: number;
}

/** Derive a readable file-name fragment from the first question. */
export function historyTitle(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "대화";
  const rest = words.slice(1, 10).join(" ");
  const raw = rest ? `${first} ${rest}` : first;
  const safe = raw
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (safe || "대화").slice(0, 60);
}

/** Normalize a user-configured folder into a vault-relative path. */
export function normalizeHistoryFolder(folder: string): string {
  const trimmed = (folder || DEFAULT_HISTORY_FOLDER).trim();
  const cleaned = trimmed.replace(/^[/\\]+|[/\\]+$/g, "").replace(/\\/g, "/");
  return normalizePath(cleaned || DEFAULT_HISTORY_FOLDER);
}

/** `제목@YYYY-MM-DD_HH-MM-SS.md` — Copilot-style conversation file name. */
export function historyFileName(query: string, created: string): string {
  const date = new Date(created);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds(),
  )}`;
  return `${historyTitle(query)}@${stamp}.md`;
}

// ---------------------------------------------------------------------------
// Frontmatter (minimal YAML subset, no dependency)
// ---------------------------------------------------------------------------

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Multi-line literal block scalar (`|-`); content is indented under the
 *  list item (`      ` = 6 spaces) so `  - role:` lines end the block, and
 *  empty content lines stay indented so they are not mistaken for the end. */
function yamlBlock(value: string): string {
  const lines = value.split("\n");
  return `|-\n${lines
    .map((line) => (line ? `      ${line}` : "      "))
    .join("\n")}`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

/** Serialize a session into a history note: YAML frontmatter (raw transcript
 *  + citations — the machine-readable source of truth) plus a human-readable
 *  body (question headings and the converted note-ready answer with ①
 *  wikilinks and a 근거 list). */
export function buildHistoryNote(session: HistorySession): string {
  const messages = session.messages
    .map(
      (message) =>
        `  - role: ${message.role}\n    content: ${yamlBlock(message.content)}`,
    )
    .join("\n");
  const citations = session.citations
    .map((citation) =>
      [
        `  - id: ${citation.id}`,
        `    file: ${yamlQuote(citation.file_path)}`,
        `    line: ${citation.start_line}`,
        `    headings: ${yamlQuote(JSON.stringify(citation.heading_path))}`,
        `    rank: ${citation.rank}`,
        `    score: ${citation.score}`,
      ].join("\n"),
    )
    .join("\n");
  const frontmatter = [
    "---",
    `title: ${yamlQuote(session.title)}`,
    `provider: ${yamlQuote(session.provider)}`,
    `model: ${yamlQuote(session.model)}`,
    `effort: ${yamlQuote(session.reasoningEffort)}`,
    `created: ${yamlQuote(session.created)}`,
    "messages:",
    messages,
    "citations:",
    citations,
    "---",
    "",
  ].join("\n");
  const body = session.messages
    .map((message) =>
      message.role === "user"
        ? `## Q\n${message.content}`
        : `## A\n${toNoteMarkdown(message.content, session.citations)}`,
    )
    .join("\n\n");
  return `${frontmatter}\n${body}\n`;
}

/** Parse a history note back into a session. Returns null when the file is
 *  not one of ours (no frontmatter or missing fields). */
export function parseHistoryNote(text: string): HistorySession | null {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return null;
  const session: HistorySession = {
    title: "",
    created: "",
    provider: "",
    model: "",
    reasoningEffort: "",
    messages: [],
    citations: [],
  };
  let message: HistoryMessage | null = null;
  let citation: Partial<Citation> | null = null;
  let block: string[] | null = null;
  let blockTarget: HistoryMessage | null = null;
  for (const line of match[1].split("\n")) {
    if (block) {
      if (/^ {6}/.test(line)) {
        block.push(line.slice(6));
        continue;
      }
      blockTarget!.content = block.join("\n");
      block = null;
      blockTarget = null;
    }
    if (line === "messages:" || line === "citations:") {
      message = null;
      citation = null;
      continue;
    }
    const messageStart = /^ {2}- role: (user|assistant)$/.exec(line);
    if (messageStart) {
      const next: HistoryMessage = {
        role: messageStart[1] === "user" ? "user" : "assistant",
        content: "",
      };
      message = next;
      session.messages.push(next);
      continue;
    }
    const contentStart = /^ {4}content: (.*)$/.exec(line);
    if (contentStart && message) {
      const value = contentStart[1];
      if (value === "|-" || value === "|") {
        block = [];
        blockTarget = message;
      } else {
        message.content = value;
      }
      continue;
    }
    const citationStart = /^ {2}- id: (.+)$/.exec(line);
    if (citationStart) {
      citation = { id: citationStart[1] } as Citation;
      session.citations.push(citation as Citation);
      continue;
    }
    if (citation) {
      const field = /^ {4}(file|line|headings|rank|score): (.*)$/.exec(line);
      if (field) {
        const key = field[1];
        const raw = field[2];
        if (key === "file") citation.file_path = unquote(raw);
        else if (key === "line") citation.start_line = Number(raw);
        else if (key === "rank") citation.rank = Number(raw);
        else if (key === "score") citation.score = Number(raw);
        else if (key === "headings") {
          try {
            citation.heading_path = JSON.parse(unquote(raw));
          } catch {
            citation.heading_path = [];
          }
        }
      }
      continue;
    }
    const top = /^([a-zA-Z]+): (.*)$/.exec(line);
    if (top) {
      const key = top[1];
      const raw = top[2];
      if (key === "title") session.title = unquote(raw);
      else if (key === "provider") session.provider = unquote(raw);
      else if (key === "model") session.model = unquote(raw);
      else if (key === "effort") session.reasoningEffort = unquote(raw);
      else if (key === "created") session.created = unquote(raw);
    }
  }
  if (block && blockTarget) {
    blockTarget.content = block.join("\n");
  }
  if (!session.title) session.title = "대화";
  return session;
}

// ---------------------------------------------------------------------------
// Vault I/O
// ---------------------------------------------------------------------------

/** List saved history notes (newest first). Skips unreadable/foreign files. */
export async function listHistory(
  vault: Vault,
  folder: string,
): Promise<HistoryMeta[]> {
  const dir = normalizeHistoryFolder(folder);
  let children: Array<{ path: string; extension?: string }>;
  try {
    const entry = vault.getAbstractFileByPath(dir) as {
      children?: Array<{ path: string; extension?: string }>;
    } | null;
    if (!entry || !Array.isArray(entry.children)) return [];
    children = entry.children;
  } catch {
    return [];
  }
  const metas: HistoryMeta[] = [];
  for (const child of children) {
    if (child.extension !== "md") continue;
    try {
      const file = vault.getFileByPath(child.path);
      if (!file) continue;
      const session = parseHistoryNote(await vault.read(file));
      if (!session) continue;
      metas.push({
        file: child.path,
        title: session.title,
        created: session.created,
        provider: session.provider,
        model: session.model,
        reasoningEffort: session.reasoningEffort,
        messageCount: session.messages.length,
      });
    } catch {
      // Skip unreadable files — never block the history list on one bad note.
    }
  }
  metas.sort((a, b) => b.created.localeCompare(a.created));
  return metas;
}

/** Write (or upsert) a session note. Returns the vault-relative file path. */
export async function saveHistory(
  vault: Vault,
  folder: string,
  session: HistorySession,
  maxEntries = 0,
): Promise<string> {
  const dir = normalizeHistoryFolder(folder);
  const filePath = normalizePath(
    `${dir}/${historyFileName(session.title, session.created)}`,
  );
  const content = buildHistoryNote(session);
  const entry = vault.getAbstractFileByPath(dir) as {
    children?: unknown;
  } | null;
  if (!entry || !Array.isArray(entry.children)) {
    await vault.createFolder(dir);
  }
  const existing = vault.getFileByPath(filePath);
  if (existing) {
    await vault.process(existing, () => content);
  } else {
    await vault.create(filePath, content);
  }
  await pruneHistory(vault, folder, maxEntries);
  return filePath;
}

/** Load a saved session by its vault-relative path. */
export async function loadHistory(
  vault: Vault,
  filePath: string,
): Promise<HistorySession | null> {
  const file = vault.getFileByPath(filePath);
  if (!file) return null;
  try {
    return parseHistoryNote(await vault.read(file));
  } catch {
    return null;
  }
}

export async function deleteHistory(
  vault: Vault,
  filePath: string,
): Promise<void> {
  const file = vault.getFileByPath(filePath);
  if (file) await vault.delete(file);
}

/** Delete the oldest notes so at most maxEntries remain (0 = keep all). */
export async function pruneHistory(
  vault: Vault,
  folder: string,
  maxEntries: number,
): Promise<void> {
  if (!maxEntries || maxEntries < 1) return;
  const metas = await listHistory(vault, folder);
  if (metas.length <= maxEntries) return;
  for (const stale of metas.slice(maxEntries)) {
    await deleteHistory(vault, stale.file);
  }
}
