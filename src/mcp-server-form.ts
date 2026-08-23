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

/** Extract conservative scheme://hostname[:port] display origin.
 *  Path, query, fragment, and userinfo are always excluded. */
export function toSafeOrigin(url: string): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol || !parsed.hostname) return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

/** Check if host is loopback (localhost, 127.0.0.1, ::1). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/.test(h)
  );
}

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

export interface McpServerValidationOptions {
  hasStoredUrl?: boolean;
  stagedRawUrl?: string | null;
}

export function validateMcpServerForm(
  form: McpServerFormData,
  options?: McpServerValidationOptions,
): string | null {
  const name = form.name.trim();
  if (!NAME_PATTERN.test(name)) {
    return "표시명은 영문/숫자로 시작하는 1-64자(공백, ., _, - 허용)여야 합니다.";
  }
  if (form.transport === "http") {
    let urlToValidate: string;
    if (options?.stagedRawUrl !== undefined) {
      if (options.stagedRawUrl === null || options.stagedRawUrl === "") {
        // Explicit URL deletion: valid to save, server will enter awaiting_secret state.
        return null;
      }
      urlToValidate = options.stagedRawUrl;
    } else if (options?.hasStoredUrl === true) {
      // Existing server with stored secret URL not touched in this edit.
      return null;
    } else if (options?.hasStoredUrl === false) {
      // Failed migration or unstored server in modal edit must stage a URL to save.
      return "원격 서버 URL을 입력해 주세요.";
    } else {
      // Standalone form validation (e.g. creation without options)
      if (!form.url.trim()) {
        return "원격 서버 URL을 입력해 주세요.";
      }
      urlToValidate = form.url;
    }

    if (urlToValidate.length > 2048) {
      return "URL이 너무 깁니다(최대 2048자).";
    }
    if (/[\x00-\x1F\x7F]/.test(urlToValidate)) {
      return "URL에 제어 문자가 포함될 수 없습니다.";
    }
    if (/\s/.test(urlToValidate)) {
      return "URL에 공백이 포함될 수 없습니다.";
    }
    let parsed: URL;
    try {
      parsed = new URL(urlToValidate);
    } catch {
      return "URL 형식이 올바르지 않습니다. 전체 URL을 붙여넣어 주세요.";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "URL은 http 또는 https로 시작해야 합니다.";
    }
    if (!parsed.hostname) {
      return "URL에 유효한 호스트명이 필요합니다.";
    }
    return null;
  }
  if (!form.command.trim()) {
    return "실행 명령을 입력해 주세요. 원격 서버라면 연결 방식을 '원격 URL'로 바꿔 주세요.";
  }
  return null;
}

/** Human-readable one-line summary for list rows. Only the safe origin is shown:
 *  path/query/fragment/userinfo never reach list views or logs. */
export function describeMcpServer(server: McpServerSettings): string {
  if (server.transport === "http") {
    const url = server.url.trim();
    if (!url) return "원격 URL 미지정";
    const safe = toSafeOrigin(url);
    if (safe) return safe;
    return "(잘못된 URL)";
  }
  const command = server.command.trim();
  if (!command) return "명령 미지정";
  return [command, ...server.args].join(" ");
}
