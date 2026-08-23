import { describe, expect, it } from "vitest";
import {
  describeMcpServer,
  isLoopbackHost,
  toSafeOrigin,
  validateMcpServerForm,
  withPolicyForAll,
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

  it("validates staged raw URL snapshot with strict bounds and control character checks", () => {
    // 1. Control characters in staged raw URL rejected
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: "https://example.com/mcp\x00bad" },
      ),
    ).toMatch(/제어 문자/);

    // 2. Spaces in staged raw URL rejected
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: "https://example.com/mcp with spaces" },
      ),
    ).toMatch(/공백/);

    // 3. Staged URL length > 2048 rejected
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: `https://example.com/${"x".repeat(2050)}` },
      ),
    ).toMatch(/최대 2048자/);

    // 4. Staged URL deletion (empty string or null) is valid
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: "" },
      ),
    ).toBeNull();
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: null },
      ),
    ).toBeNull();

    // 5. Existing server with stored URL and no staged change is valid
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { hasStoredUrl: true },
      ),
    ).toBeNull();

    // 6. Failed migration / recovery server without stored URL cannot save without staging a new URL
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "https://mcp.example.com/mcp?token=raw" },
        { hasStoredUrl: false, stagedRawUrl: undefined },
      ),
    ).toMatch(/URL을 입력해 주세요/);

    // 7. Staged URL with leading/trailing whitespace is strictly rejected
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: " https://mcp.example.com/stream " },
      ),
    ).toMatch(/공백/);

    // 8. Valid full URL with userinfo and query is accepted
    expect(
      validateMcpServerForm(
        { name: "R", transport: "http", command: "", url: "" },
        { stagedRawUrl: "https://alice:secret@mcp.example.com:8443/stream?token=canary-123#frag" },
      ),
    ).toBeNull();
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

  it("strips path, query strings, and credentials from http urls before display", () => {
    expect(
      describeMcpServer(
        serverFixture({
          transport: "http",
          url: "https://user:pass@mcp.gomdori.app:8443/law?oc=secret-token#sec",
        }),
      ),
    ).toBe("https://mcp.gomdori.app:8443");
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

describe("bulk tool policy helper", () => {
  it("applies one policy to every tool while preserving unrelated entries", () => {
    expect(
      withPolicyForAll({ other: "deny" }, ["a", "b"], "allow"),
    ).toEqual({ other: "deny", a: "allow", b: "allow" });
  });

  it("overwrites previous per-tool values", () => {
    expect(
      withPolicyForAll({ a: "ask", b: "deny" }, ["a", "b"], "allow"),
    ).toEqual({ a: "allow", b: "allow" });
    expect(withPolicyForAll({}, [], "allow")).toEqual({});
  });
});

describe("toSafeOrigin and isLoopbackHost", () => {
  it("extracts scheme://host:port and strips path, query, fragment, credentials", () => {
    expect(toSafeOrigin("https://user:pass@example.com:8443/mcp?token=xyz#frag")).toBe(
      "https://example.com:8443",
    );
    expect(toSafeOrigin("http://localhost:3000/api")).toBe("http://localhost:3000");
    expect(toSafeOrigin("invalid")).toBe("");
  });

  it("identifies loopback hosts correctly", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.0.0.99")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
  });
});
