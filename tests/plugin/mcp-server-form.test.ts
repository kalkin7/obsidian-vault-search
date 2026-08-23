import { describe, expect, it } from "vitest";
import {
  describeMcpServer,
  validateMcpServerForm,
} from "../../src/mcp-server-form";
import type { McpServerSettings } from "../../src/types";

const serverFixture = (
  overrides: Partial<McpServerSettings> = {},
): McpServerSettings => ({
  id: "srv-1",
  name: "Test",
  enabled: true,
  transport: "stdio",
  command: "python",
  args: [],
  cwd: "vault",
  url: "",
  envNames: [],
  toolPolicies: {},
  ...overrides,
});

describe("MCP server form validation", () => {
  it("requires a command for stdio servers", () => {
    expect(
      validateMcpServerForm({ name: "A", transport: "stdio", command: "", url: "" }),
    ).toMatch(/실행 명령/);
    expect(
      validateMcpServerForm({
        name: "A",
        transport: "stdio",
        command: "npx",
        url: "",
      }),
    ).toBeNull();
  });

  it("rejects invalid names", () => {
    expect(
      validateMcpServerForm({
        name: "",
        transport: "stdio",
        command: "x",
        url: "",
      }),
    ).toMatch(/표시명/);
    expect(
      validateMcpServerForm({
        name: "-bad",
        transport: "stdio",
        command: "x",
        url: "",
      }),
    ).toMatch(/표시명/);
  });

  it("accepts the issued-url style remote server", () => {
    expect(
      validateMcpServerForm({
        name: "korean-law",
        transport: "http",
        command: "",
        url: "https://mcp.gomdori.app/law?oc=honggildong",
      }),
    ).toBeNull();
  });

  it("rejects http forms without a usable absolute url", () => {
    expect(
      validateMcpServerForm({ name: "R", transport: "http", command: "", url: "" }),
    ).toMatch(/URL을 입력/);
    expect(
      validateMcpServerForm({
        name: "R",
        transport: "http",
        command: "",
        url: "not-a-url",
      }),
    ).toMatch(/형식이 올바르지 않습니다/);
    expect(
      validateMcpServerForm({
        name: "R",
        transport: "http",
        command: "",
        url: "ftp://mcp.gomdori.app/law",
      }),
    ).toMatch(/http 또는 https/);
    expect(
      validateMcpServerForm({
        name: "R",
        transport: "http",
        command: "",
        url: `https://example.com/${"a".repeat(2100)}`,
      }),
    ).toMatch(/최대 2048자/);
  });
});

describe("MCP server list summary", () => {
  it("summarizes stdio servers as command plus args", () => {
    expect(
      describeMcpServer(
        serverFixture({ args: ["-m", "server"] }),
      ),
    ).toBe("python -m server");
    expect(describeMcpServer(serverFixture({ command: " " }))).toBe("명령 미지정");
  });

  it("strips query strings from http urls before display", () => {
    expect(
      describeMcpServer(
        serverFixture({
          transport: "http",
          url: "https://mcp.gomdori.app/law?oc=secret-token",
        }),
      ),
    ).toBe("https://mcp.gomdori.app/law");
    expect(
      describeMcpServer(serverFixture({ transport: "http", url: "" })),
    ).toBe("원격 URL 미지정");
    expect(
      describeMcpServer(
        serverFixture({ transport: "http", url: "::bad::" }),
      ),
    ).toBe("(잘못된 URL)");
  });
});
