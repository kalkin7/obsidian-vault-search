import { App, MarkdownView, normalizePath, Notice, TFile } from "obsidian";
import type { SearchResult } from "./types";
import { historyTitle } from "./history";

/**
 * Clean up title to be safe for filenames in Obsidian.
 */
export function sanitizeNoteTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "검색 결과";
  const cleaned = historyTitle(trimmed);
  return cleaned || "검색 결과";
}

/**
 * Generate a timestamp string suitable for note filenames: YYYY-MM-DD_HH-mm-ss
 */
export function getFormattedTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Format search results into a clean markdown document or section.
 */
export function formatSearchResultsMarkdown(
  query: string,
  results: SearchResult[],
): string {
  const lines: string[] = [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  lines.push(`## 🔍 볼트 검색: ${query}`);
  lines.push(`> 검색 시각: ${timeStr} · 총 ${results.length}개 결과`);
  lines.push("");

  if (results.length === 0) {
    lines.push("검색 결과가 없습니다.");
    return lines.join("\n");
  }

  for (const result of results) {
    const fileStem =
      result.file_path.split("/").pop()?.replace(/\.md$/i, "") ||
      result.file_path;
    const cleanPath = result.file_path.replace(/\.md$/i, "");
    const headings = result.heading_path?.filter(Boolean) ?? [];
    const headingSuffix = headings.length > 0 ? `#${headings.join("#")}` : "";
    const displayTitle =
      headings.length > 0
        ? `${fileStem} › ${headings.join(" › ")}`
        : fileStem;

    lines.push(`- [[${cleanPath}${headingSuffix}|${displayTitle}]]`);
    if (result.content) {
      const snippet = result.content.replace(/\s+/g, " ").trim();
      lines.push(`  > ${snippet}`);
    }
  }

  return lines.join("\n");
}

/**
 * Extract clean note title and remaining body content:
 * 1. If content contains a markdown H1 heading (# Title), extract that title
 *    and strip the H1 line from the body so Obsidian doesn't duplicate the title.
 * 2. Otherwise clean up the fallback title/query and keep the content as-is.
 */
export function extractCleanNoteTitleAndBody(
  fallbackTitle: string,
  content: string,
): { title: string; body: string } {
  const lines = content.split(/\r?\n/);
  let title = "";
  let headingIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = /^#\s+(.+)$/.exec(line);
    if (match && match[1].trim()) {
      title = sanitizeNoteTitle(match[1].trim());
      headingIndex = i;
      break;
    }
    // If first non-empty line isn't an H1, stop searching
    break;
  }

  if (headingIndex >= 0 && title) {
    // Strip the H1 line and any immediately following blank lines
    let nextIndex = headingIndex + 1;
    while (nextIndex < lines.length && !lines[nextIndex].trim()) {
      nextIndex++;
    }
    const remainingLines = lines.slice(nextIndex);
    return { title, body: remainingLines.join("\n").trimStart() };
  }

  return {
    title: sanitizeNoteTitle(fallbackTitle),
    body: content,
  };
}

/**
 * Backward-compatible helper to extract note title.
 */
export function extractCleanNoteTitle(fallbackTitle: string, content: string): string {
  return extractCleanNoteTitleAndBody(fallbackTitle, content).title;
}

/**
 * Ensure content has YAML frontmatter with created date.
 * Obsidian uses the file basename as the title, so we only record created timestamp.
 */
export function ensureNoteFrontmatter(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("---")) {
    return content;
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const createdStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const frontmatter = [
    "---",
    `created: "${createdStr}"`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}\n${content}`;
}

/**
 * Generate a unique file path in the given folder without overwriting existing files.
 * Example: Title.md -> Title 1.md -> Title 2.md
 */
export function getUniqueFilePath(
  app: App,
  folderPath: string,
  baseTitle: string,
): string {
  const cleanFolder = folderPath.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  let fileName = `${baseTitle}.md`;
  let fullPath = normalizePath(
    cleanFolder ? `${cleanFolder}/${fileName}` : fileName,
  );

  let counter = 1;
  while (app.vault.getAbstractFileByPath(fullPath) && counter <= 1000) {
    fileName = `${baseTitle} ${counter}.md`;
    fullPath = normalizePath(
      cleanFolder ? `${cleanFolder}/${fileName}` : fileName,
    );
    counter++;
  }
  return fullPath;
}

/**
 * Resolve target folder for new notes:
 * 1. Explicit folder from options if provided.
 * 2. Obsidian's configured default location via app.fileManager.getNewFileParent.
 * 3. Fallback to vault root ("").
 */
export function resolveTargetFolder(app: App, explicitFolder?: string): string {
  if (explicitFolder && explicitFolder.trim()) {
    return explicitFolder.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  }

  try {
    const activeFile = app.workspace?.getActiveFile?.();
    const parent = app.fileManager?.getNewFileParent?.(activeFile?.path || "");
    if (parent && parent.path && parent.path !== "/" && parent.path !== ".") {
      return normalizePath(parent.path);
    }
  } catch {
    // Fallback if fileManager API is not available
  }

  return "";
}

/**
 * Options for creating a note from markdown content.
 */
export interface CreateNoteOptions {
  title: string;
  content: string;
  folder?: string;
  openInNewTab?: boolean;
}

/**
 * Create a new markdown note in the vault and optionally open it.
 */
export async function createNoteFromMarkdown(
  app: App,
  options: CreateNoteOptions,
): Promise<TFile | null> {
  const { title, content, folder, openInNewTab = true } = options;
  const { title: cleanTitle, body: cleanBody } = extractCleanNoteTitleAndBody(
    title,
    content,
  );
  const contentWithFrontmatter = ensureNoteFrontmatter(cleanBody);
  const cleanFolder = resolveTargetFolder(app, folder);

  try {
    // Ensure parent folder exists if specified
    if (cleanFolder) {
      const folderEntry = app.vault.getAbstractFileByPath(cleanFolder);
      if (!folderEntry) {
        await app.vault.createFolder(cleanFolder);
      }
    }

    const fullPath = getUniqueFilePath(app, cleanFolder, cleanTitle);
    const file = await app.vault.create(fullPath, contentWithFrontmatter);
    new Notice(`새 노트를 생성했습니다: ${file.basename}`);

    if (openInNewTab) {
      const leaf = app.workspace.getLeaf("tab");
      await leaf.openFile(file, { active: true });
    }

    return file;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    new Notice(`새 노트 생성 실패: ${msg}`, 8000);
    return null;
  }
}

/**
 * Insert or append markdown content to the currently active markdown note.
 */
export function insertMarkdownToActiveNote(
  app: App,
  content: string,
): boolean {
  const activeView = app.workspace.getActiveViewOfType(MarkdownView);
  if (!activeView || !activeView.editor) {
    new Notice("현재 열려 있는 마크다운 노트가 없습니다.");
    return false;
  }

  const editor = activeView.editor;
  const docLength = editor.getValue().length;

  if (docLength === 0) {
    // Empty document
    editor.setValue(content);
  } else {
    // If there is an active selection, insert after the selection without overwriting it.
    // Otherwise insert at the current cursor position.
    const pos = editor.somethingSelected()
      ? (editor.getCursor?.("to") ?? editor.getCursor?.() ?? { line: 0, ch: 0 })
      : (editor.getCursor?.() ?? { line: 0, ch: 0 });

    const lineText = editor.getLine(pos.line) ?? "";
    if (lineText.trim().length > 0) {
      // Insert with newlines so we don't break existing line
      editor.replaceRange(`\n\n${content}\n`, pos);
    } else {
      editor.replaceRange(`${content}\n`, pos);
    }
  }

  new Notice("현재 노트에 내용을 추가했습니다.");
  return true;
}

/**
 * Copy text to clipboard using navigator.clipboard or textarea fallback.
 */
export async function copyMarkdownToClipboard(
  text: string,
  onNotify?: (ok: boolean) => void,
): Promise<boolean> {
  const notify =
    onNotify ??
    ((ok: boolean) =>
      new Notice(ok ? "복사했습니다." : "복사에 실패했습니다."));

  const hasNavigator = typeof navigator !== "undefined" && Boolean(navigator.clipboard);
  const isSecure = typeof window === "undefined" || window.isSecureContext;

  if (hasNavigator && isSecure) {
    try {
      await navigator.clipboard.writeText(text);
      notify(true);
      return true;
    } catch {
      return fallbackCopyText(text, notify);
    }
  } else {
    return fallbackCopyText(text, notify);
  }
}

function fallbackCopyText(
  text: string,
  notify: (ok: boolean) => void,
): boolean {
  if (typeof document === "undefined" || !document.createElement) {
    notify(false);
    return false;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  notify(ok);
  return ok;
}
