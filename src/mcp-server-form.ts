import type { McpServerSettings } from "./types";

/** Pure validation/summary helpers for the MCP server editor modal.
 *  Kept free of Obsidian imports so unit tests can exercise the exact rules
 *  mirrored by the Python side (plan §12.3). */

export interface McpServerFormData {
  name: string;
  transport: "stdio" | "http";
  command: string;
  url: string;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

export type McpToolPolicyValue = "allow" | "ask" | "deny";

/** Bulk-apply one policy to every tool, preserving unrelated entries. */
export function withPolicyForAll(
  current: Record<string, McpToolPolicyValue>,
  tools: string[],
  policy: McpToolPolicyValue,
): Record<string, McpToolPolicyValue> {
  const next = { ...current };
  for (const tool of tools) next[tool] = policy;
  return next;
}

export function validateMcpServerForm(form: McpServerFormData): string | null {
  const name = form.name.trim();
  if (!NAME_PATTERN.test(name)) {
    return "표시명은 영문/숫자로 시작하는 1-64자(공백, ., _, - 허용)여야 합니다.";
  }
  if (form.transport === "http") {
    const url = form.url.trim();
    if (!url) return "원격 서버 URL을 입력해 주세요.";
    if (url.length > 2048) return "URL이 너무 깁니다(최대 2048자).";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "URL 형식이 올바르지 않습니다. 전체 URL을 붙여넣어 주세요.";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL은 http 또는 https로 시작해야 합니다.";
    }
    if (!parsed.hostname) return "URL에 호스트가 없습니다.";
    return null;
  }
  if (!form.command.trim()) {
    return "실행 명령을 입력해 주세요. 원격 서버라면 연결 방식을 '원격 URL'로 바꿔 주세요.";
  }
  return null;
}

/** Human-readable one-line summary for list rows. Query strings are stripped:
 *  issued URLs frequently embed tokens we never want on screen. */
export function describeMcpServer(server: McpServerSettings): string {
  if (server.transport === "http") {
    const url = server.url.trim();
    if (!url) return "원격 URL 미지정";
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(
        /\/$/,
        "",
      );
    } catch {
      return "(잘못된 URL)";
    }
  }
  const command = server.command.trim();
  if (!command) return "명령 미지정";
  return [command, ...server.args].join(" ");
}
