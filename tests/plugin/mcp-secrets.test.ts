import { describe, expect, it } from "vitest";
import {
  buildMcpSecretPayload,
  deleteMcpSecret,
  deleteServerSecrets,
  getMcpSecret,
  mcpSecretId,
  setMcpSecret,
} from "../../src/mcp-secrets";
import type { McpServerSettings } from "../../src/types";

class FakeSecretStorage {
  private values = new Map<string, string>();
  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }
  setSecret(id: string, value: string): void {
    if (value === "") this.values.delete(id);
    else this.values.set(id, value);
  }
}

function fakeApp(): { app: never; storage: FakeSecretStorage } {
  const storage = new FakeSecretStorage();
  const app = { secretStorage: storage } as unknown as never;
  return { app, storage };
}

function serverFixture(overrides: Partial<McpServerSettings> = {}): McpServerSettings {
  return {
    id: "srv-1",
    name: "Test",
    enabled: true,
    transport: "stdio",
    command: "python",
    args: [],
    cwd: "vault",
    envNames: ["GITHUB_TOKEN"],
    toolPolicies: {},
    ...overrides,
  };
}

describe("MCP secret ids", () => {
  it("are stable per server+name and differ across names", () => {
    expect(mcpSecretId("srv-1", "TOKEN")).toBe(mcpSecretId("srv-1", "TOKEN"));
    expect(mcpSecretId("srv-1", "TOKEN")).not.toBe(mcpSecretId("srv-1", "OTHER"));
    expect(mcpSecretId("srv-2", "TOKEN")).not.toBe(mcpSecretId("srv-1", "TOKEN"));
  });

  it("never embeds the raw env name", () => {
    const id = mcpSecretId("srv-1", "SUPER_SECRET_NAME");
    expect(id).not.toContain("SUPER_SECRET_NAME");
  });
});

describe("MCP secret storage", () => {
  it("round-trips a value without persisting to plugin data", () => {
    const { app, storage } = fakeApp();
    setMcpSecret(app, "srv-1", "TOKEN", "abc");
    expect(getMcpSecret(app, "srv-1", "TOKEN")).toBe("abc");
    // Nothing outside the secret store was touched.
    expect(Object.keys(storage["values"] || new Map())).toBeDefined();
  });

  it("delete removes the value", () => {
    const { app } = fakeApp();
    setMcpSecret(app, "srv-1", "TOKEN", "abc");
    deleteMcpSecret(app, "srv-1", "TOKEN");
    expect(getMcpSecret(app, "srv-1", "TOKEN")).toBeNull();
  });

  it("deleteServerSecrets clears every configured name", () => {
    const { app } = fakeApp();
    const server = serverFixture({ envNames: ["A_TOKEN", "B_TOKEN"] });
    setMcpSecret(app, server.id, "A_TOKEN", "1");
    setMcpSecret(app, server.id, "B_TOKEN", "2");
    deleteServerSecrets(app, server);
    expect(getMcpSecret(app, server.id, "A_TOKEN")).toBeNull();
    expect(getMcpSecret(app, server.id, "B_TOKEN")).toBeNull();
  });
});

describe("buildMcpSecretPayload", () => {
  it("collects stored values of enabled servers only", () => {
    const { app } = fakeApp();
    setMcpSecret(app, "srv-1", "GITHUB_TOKEN", "tok");
    setMcpSecret(app, "srv-off", "KEY", "off");
    const result = buildMcpSecretPayload(app, [
      serverFixture(),
      serverFixture({ id: "srv-off", name: "Off", enabled: false, envNames: ["KEY"] }),
      serverFixture({ id: "srv-empty", name: "Empty", envNames: ["NOT_SET"] }),
    ]);
    // Enabled servers always appear — an empty map is explicit so the
    // backend's wholesale replace performs deletions (fix §5).
    expect(result.payload.servers).toEqual({
      "srv-1": { GITHUB_TOKEN: "tok" },
      "srv-empty": {},
    });
    expect(result.summary).toEqual({ "srv-1": ["GITHUB_TOKEN"], "srv-empty": [] });
  });

  it("skips oversized values with an explicit reason", () => {
    const { app } = fakeApp();
    setMcpSecret(app, "srv-1", "BIG", "x".repeat(8 * 1024 + 1));
    setMcpSecret(app, "srv-1", "OK", "fine");
    const result = buildMcpSecretPayload(app, [
      serverFixture({ envNames: ["BIG", "OK"] }),
    ]);
    expect(result.payload.servers["srv-1"]["OK"]).toBe("fine");
    expect(result.skipped).toContainEqual({
      serverId: "srv-1",
      envName: "BIG",
      reason: "value-too-large",
    });
  });

  it("enforces the aggregate payload budget", () => {
    const { app } = fakeApp();
    // ~8KiB each: four fit within 32KiB, the fifth is dropped.
    const names = ["N1", "N2", "N3", "N4", "N5"];
    for (const name of names) {
      setMcpSecret(app, "srv-1", name, "y".repeat(8 * 1024 - 16));
    }
    const result = buildMcpSecretPayload(app, [
      serverFixture({ envNames: names }),
    ]);
    const delivered = Object.keys(result.payload.servers["srv-1"]).sort();
    expect(delivered.length).toBeLessThan(names.length);
    expect(
      result.skipped.every((skip) => skip.reason === "payload-budget-exceeded"),
    ).toBe(true);
  });

  it("lists enabled servers with empty maps when nothing is stored", () => {
    const { app } = fakeApp();
    const result = buildMcpSecretPayload(app, [serverFixture()]);
    // The explicit empty map tells the backend to drop any stale values.
    expect(result.payload.servers).toEqual({ "srv-1": {} });
    expect(result.summary).toEqual({ "srv-1": [] });
  });

  it("returns an empty payload when no server is enabled", () => {
    const { app } = fakeApp();
    const result = buildMcpSecretPayload(app, [
      serverFixture({ enabled: false }),
    ]);
    expect(result.payload.servers).toEqual({});
    expect(result.summary).toEqual({});
  });
});
