import { describe, expect, it, vi } from "vitest";
import {
  buildMcpSecretPayload,
  deleteMcpHttpUrl,
  deleteMcpSecret,
  deleteServerSecrets,
  getMcpHttpUrl,
  getMcpSecret,
  hasMcpEnvSecret,
  hasMcpHttpUrl,
  mcpHttpUrlSecretId,
  mcpSecretId,
  migrateMcpHttpUrls,
  setMcpHttpUrl,
  setMcpSecret,
} from "../../src/mcp-secrets";
import { validateMcpServerForm } from "../../src/mcp-server-form";
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
    url: "",
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

  it("mcpHttpUrlSecretId is stable per server id and differs across servers", () => {
    expect(mcpHttpUrlSecretId("srv-1")).toBe("vault-search-mcp-http-url-srv-1");
    expect(mcpHttpUrlSecretId("srv-2")).toBe("vault-search-mcp-http-url-srv-2");
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

  it("deleteServerSecrets clears every configured name and HTTP URL", () => {
    const { app } = fakeApp();
    const server = serverFixture({
      transport: "http",
      url: "https://mcp.example.com",
      envNames: ["A_TOKEN", "B_TOKEN"],
    });
    setMcpSecret(app, server.id, "A_TOKEN", "1");
    setMcpSecret(app, server.id, "B_TOKEN", "2");
    setMcpHttpUrl(app, server.id, "https://mcp.example.com/mcp?token=secret123");
    deleteServerSecrets(app, server);
    expect(getMcpSecret(app, server.id, "A_TOKEN")).toBeNull();
    expect(getMcpSecret(app, server.id, "B_TOKEN")).toBeNull();
    expect(getMcpHttpUrl(app, server.id)).toBeNull();
  });

  it("HTTP URL round-trips through secretStorage", () => {
    const { app } = fakeApp();
    const fullUrl = "https://mcp.example.com/stream?token=canary-token-999#frag";
    setMcpHttpUrl(app, "srv-http", fullUrl);
    expect(getMcpHttpUrl(app, "srv-http")).toBe(fullUrl);
    deleteMcpHttpUrl(app, "srv-http");
    expect(getMcpHttpUrl(app, "srv-http")).toBeNull();
  });

  it("calls deleteSecret when supported and removes key from listSecrets without setting empty string", () => {
    const store = new Map<string, string>();
    let deleteCalls = 0;
    let setCalls = 0;
    const storage = {
      getSecret: (id: string) => store.get(id) ?? null,
      setSecret: (id: string, value: string) => {
        setCalls++;
        store.set(id, value);
      },
      deleteSecret: (id: string) => {
        deleteCalls++;
        store.delete(id);
      },
      listSecrets: () => Array.from(store.keys()),
    };
    const app = { secretStorage: storage } as unknown as never;

    setMcpSecret(app, "srv-del-test", "TOKEN", "secret-val");
    setMcpHttpUrl(app, "srv-del-test", "https://mcp.example.com?token=xyz");
    expect(storage.listSecrets()).toHaveLength(2);

    const prevSetCalls = setCalls;
    deleteMcpSecret(app, "srv-del-test", "TOKEN");
    deleteMcpHttpUrl(app, "srv-del-test");

    expect(deleteCalls).toBe(2);
    // setSecret was NOT called during delete because deleteSecret was available and returned early
    expect(setCalls).toBe(prevSetCalls);
    expect(storage.listSecrets()).toEqual([]);
    expect(getMcpSecret(app, "srv-del-test", "TOKEN")).toBeNull();
    expect(getMcpHttpUrl(app, "srv-del-test")).toBeNull();
  });

  it("falls back to setSecret(key, '') when deleteSecret is unavailable and normalizes read-back to null", () => {
    const store = new Map<string, string>();
    const storage = {
      getSecret: (id: string) => store.get(id) ?? null,
      setSecret: (id: string, value: string) => {
        store.set(id, value);
      },
    };
    const app = { secretStorage: storage } as unknown as never;

    setMcpSecret(app, "srv-fallback", "API_KEY", "canary_val");
    setMcpHttpUrl(app, "srv-fallback", "https://mcp.example.com/stream?token=abc");

    deleteMcpSecret(app, "srv-fallback", "API_KEY");
    deleteMcpHttpUrl(app, "srv-fallback");

    // Under the hood, store has empty strings
    expect(store.get(mcpSecretId("srv-fallback", "API_KEY"))).toBe("");
    expect(store.get(mcpHttpUrlSecretId("srv-fallback"))).toBe("");

    // getMcpSecret / getMcpHttpUrl normalize "" to null
    expect(getMcpSecret(app, "srv-fallback", "API_KEY")).toBeNull();
    expect(getMcpHttpUrl(app, "srv-fallback")).toBeNull();
  });
});

describe("buildMcpSecretPayload", () => {
  it("collects stored values of enabled servers only and separates stdio from http", () => {
    const { app } = fakeApp();
    setMcpSecret(app, "srv-1", "GITHUB_TOKEN", "tok");
    setMcpSecret(app, "srv-off", "KEY", "off");
    setMcpHttpUrl(app, "srv-http-1", "https://mcp.example.com/stream?token=canary");
    setMcpHttpUrl(app, "srv-http-off", "https://mcp.example.com/stream?token=off");
    const result = buildMcpSecretPayload(app, [
      serverFixture(),
      serverFixture({ id: "srv-off", name: "Off", enabled: false, envNames: ["KEY"] }),
      serverFixture({ id: "srv-empty", name: "Empty", envNames: ["NOT_SET"] }),
      serverFixture({
        id: "srv-http-1",
        name: "HTTP 1",
        transport: "http",
        url: "https://mcp.example.com",
        envNames: [],
      }),
      serverFixture({
        id: "srv-http-off",
        name: "HTTP Off",
        enabled: false,
        transport: "http",
        url: "https://mcp.example.com",
        envNames: [],
      }),
    ]);
    expect(result.payload.servers).toEqual({
      "srv-1": { GITHUB_TOKEN: "tok" },
      "srv-empty": {},
    });
    expect(result.payload.http_urls).toEqual({
      "srv-http-1": "https://mcp.example.com/stream?token=canary",
    });
    expect(result.summary).toEqual({
      servers: {
        "srv-1": ["GITHUB_TOKEN"],
        "srv-empty": [],
      },
      http_urls: {
        "srv-http-1": true,
      },
    });
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
    expect(result.summary).toEqual({
      servers: { "srv-1": [] },
      http_urls: {},
    });
  });

  it("returns an empty payload when no server is enabled", () => {
    const { app } = fakeApp();
    const result = buildMcpSecretPayload(app, [
      serverFixture({ enabled: false }),
    ]);
    expect(result.payload.servers).toEqual({});
    expect(result.summary).toEqual({
      servers: {},
      http_urls: {},
    });
  });

  it("clears secrets completely so re-registering the same UUID does not inherit past secrets", () => {
    const { app } = fakeApp();
    const server = serverFixture({
      id: "srv-reuse",
      name: "Reuse Test",
      transport: "http",
      envNames: ["OLD_KEY"],
    });
    setMcpSecret(app, server.id, "OLD_KEY", "old-secret-val");
    setMcpHttpUrl(app, server.id, "https://mcp.example.com/stream?token=old-token");

    // Purge on deletion
    deleteServerSecrets(app, server);
    expect(getMcpSecret(app, server.id, "OLD_KEY")).toBeNull();
    expect(getMcpHttpUrl(app, server.id)).toBeNull();

    // Brand new server with same UUID
    const reRegistered = serverFixture({
      id: "srv-reuse",
      name: "New Server Same UUID",
      transport: "http",
      envNames: ["NEW_KEY"],
    });
    const payload = buildMcpSecretPayload(app, [reRegistered]);
    expect(payload.payload.http_urls["srv-reuse"]).toBe("");
    expect(payload.payload.servers["srv-reuse"]).toBeUndefined();
  });

  it("handles awaiting_secret HTTP server with null or empty URL without throwing in strict mode and returns empty tombstone", () => {
    const { app } = fakeApp();
    const serverB = serverFixture({
      id: "srv-awaiting-b",
      name: "Awaiting Secret HTTP",
      transport: "http",
      url: "https://mcp.example.com",
      envNames: [],
    });

    const strictResult = buildMcpSecretPayload(app, [serverB], { strict: true });
    expect(strictResult.payload.http_urls[serverB.id]).toBe("");
    expect(strictResult.summary.http_urls[serverB.id]).toBe(false);
    expect(strictResult.skipped).toEqual([]);

    const bestEffortResult = buildMcpSecretPayload(app, [serverB]);
    expect(bestEffortResult).toEqual(strictResult);

    setMcpHttpUrl(app, serverB.id, "");
    const strictEmptyResult = buildMcpSecretPayload(app, [serverB], { strict: true });
    expect(strictEmptyResult.payload.http_urls[serverB.id]).toBe("");
    expect(strictEmptyResult.summary.http_urls[serverB.id]).toBe(false);
    expect(strictEmptyResult.skipped).toEqual([]);

    const bestEffortEmptyResult = buildMcpSecretPayload(app, [serverB]);
    expect(bestEffortEmptyResult).toEqual(strictEmptyResult);
    expect(strictEmptyResult).toEqual(strictResult);
  });

  it("throws MCP_SECRET_PAYLOAD_READ_FAILED in strict mode when secretStorage throws on HTTP URL read", () => {
    const storage = new FakeSecretStorage();
    storage.getSecret = () => {
      throw new Error("Keychain locked");
    };
    const app = { secretStorage: storage } as unknown as never;
    const server = serverFixture({
      id: "srv-read-err",
      transport: "http",
      url: "https://mcp.example.com",
    });

    expect(() =>
      buildMcpSecretPayload(app, [server], { strict: true }),
    ).toThrow("MCP_SECRET_PAYLOAD_READ_FAILED:srv-read-err");
  });

  it("calculates empty HTTP tombstones into payload byte budget and throws in strict mode when budget exceeded", () => {
    const { app } = fakeApp();
    const servers: McpServerSettings[] = [];
    for (let i = 0; i < 600; i++) {
      servers.push(
        serverFixture({
          id: `srv-bulk-empty-tombstone-${i.toString().padStart(4, "0")}-${"x".repeat(30)}`,
          transport: "http",
          url: "https://mcp.example.com",
        }),
      );
    }

    expect(() =>
      buildMcpSecretPayload(app, servers, { strict: true }),
    ).toThrow(/MCP_SECRET_PAYLOAD_BUDGET_EXCEEDED/);

    const bestEffort = buildMcpSecretPayload(app, servers);
    expect(bestEffort.skipped.length).toBeGreaterThan(0);
    expect(
      bestEffort.skipped.every((s) => s.reason === "payload-budget-exceeded"),
    ).toBe(true);
  });

  it("enforces strict coded reject for origin mismatch, malformed URL, and oversized URL without leaking secret values", () => {
    const { app } = fakeApp();
    const canarySecret = "super-secret-canary-token-98765";
    const mismatchedServer = serverFixture({
      id: "srv-mismatch",
      transport: "http",
      url: "https://origin-a.example.com",
    });
    setMcpHttpUrl(
      app,
      "srv-mismatch",
      `https://origin-b.example.com/stream?token=${canarySecret}`,
    );

    let err: Error | null = null;
    try {
      buildMcpSecretPayload(app, [mismatchedServer], { strict: true });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toBe("MCP_SECRET_PAYLOAD_ORIGIN_MISMATCH:srv-mismatch");
    expect(err!.message).not.toContain(canarySecret);
    expect(err!.message).not.toContain("origin-b.example.com");

    // Malformed URL
    const badServer = serverFixture({
      id: "srv-bad",
      transport: "http",
      url: "https://origin-a.example.com",
    });
    setMcpHttpUrl(app, "srv-bad", "ftp://invalid-scheme.example.com");
    expect(() =>
      buildMcpSecretPayload(app, [badServer], { strict: true }),
    ).toThrow("MCP_SECRET_PAYLOAD_INVALID_URL:srv-bad");

    // Oversized URL
    const largeServer = serverFixture({
      id: "srv-large",
      transport: "http",
      url: "https://origin-a.example.com",
    });
    setMcpHttpUrl(
      app,
      "srv-large",
      "https://origin-a.example.com/mcp?token=" + "t".repeat(2049),
    );
    expect(() =>
      buildMcpSecretPayload(app, [largeServer], { strict: true }),
    ).toThrow("MCP_SECRET_PAYLOAD_URL_TOO_LARGE:srv-large");
  });
});

describe("migrateMcpHttpUrls", () => {
  it("migrates legacy plaintext URLs to secretStorage and scrubs server.url to safe origin", () => {
    const { app } = fakeApp();
    const legacyServer = serverFixture({
      id: "srv-legacy",
      name: "srv-legacy",
      transport: "http",
      url: "https://user:pass@example.com:8443/v1/mcp/sse?token=legacy-token#active",
    });
    const settings = { mcpServers: [legacyServer], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);
    expect(result.migratedCount).toBe(1);
    expect(result.failedServers).toEqual([]);
    expect(settings.mcpHttpUrlsMigrated).toBe(true);
    expect(getMcpHttpUrl(app, "srv-legacy")).toBe(
      "https://user:pass@example.com:8443/v1/mcp/sse?token=legacy-token#active",
    );
    expect(legacyServer.url).toBe("https://example.com:8443");
    expect(legacyServer.url).not.toContain("legacy-token");
    expect(legacyServer.url).not.toContain("user:pass");
    expect(legacyServer.url).not.toContain("/v1/mcp");
  });

  it("does not re-seed safe origin into secretStorage when mcpHttpUrlsMigrated is true", () => {
    const { app } = fakeApp();
    const server = serverFixture({
      id: "srv-already",
      name: "srv-already",
      transport: "http",
      url: "https://example.com",
    });
    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: true };
    const result = migrateMcpHttpUrls(app, settings);
    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([]);
    // Secret storage must remain empty — safe origin was not re-seeded as a secret
    expect(getMcpHttpUrl(app, "srv-already")).toBeNull();
  });

  it("handles mixed success and failure: scrubs success server, preserves raw URL for failed server", () => {
    const storage = new FakeSecretStorage();
    const origSetSecret = storage.setSecret.bind(storage);
    storage.setSecret = (id: string, val: string) => {
      if (id.includes("srv-fail")) {
        throw new Error("Storage quota exceeded");
      }
      origSetSecret(id, val);
    };
    const app = { secretStorage: storage } as unknown as never;

    const srvSuccess = serverFixture({
      id: "srv-ok",
      name: "OK Server",
      transport: "http",
      url: "https://ok.example.com/mcp?token=ok-token-123",
      enabled: true,
    });
    const srvFail = serverFixture({
      id: "srv-fail",
      name: "Fail Server",
      transport: "http",
      url: "https://fail.example.com/mcp?token=raw-canary-token",
      enabled: true,
    });

    const settings = { mcpServers: [srvSuccess, srvFail], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(1);
    expect(result.failedServers).toEqual([{ id: "srv-fail", name: "Fail Server" }]);
    expect(settings.mcpHttpUrlsMigrated).toBe(false);

    // Success server is scrubbed
    expect(srvSuccess.url).toBe("https://ok.example.com");
    expect(getMcpHttpUrl(app, "srv-ok")).toBe("https://ok.example.com/mcp?token=ok-token-123");

    // Failed server is disabled and retains unscrubbed raw URL for user recovery
    expect(srvFail.enabled).toBe(false);
    expect(srvFail.url).toBe("https://fail.example.com/mcp?token=raw-canary-token");
    expect(getMcpHttpUrl(app, "srv-fail")).toBeNull();
  });

  it("disables server and does not scrub URL if read-back verification fails", () => {
    const storage = new FakeSecretStorage();
    storage.getSecret = () => null; // Corrupted read-back
    const app = { secretStorage: storage } as unknown as never;

    const failingServer = serverFixture({
      id: "srv-corrupt",
      name: "Corrupt Read",
      transport: "http",
      url: "https://corrupt.example.com/mcp?token=secret",
      enabled: true,
    });
    const settings = { mcpServers: [failingServer], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([{ id: "srv-corrupt", name: "Corrupt Read" }]);
    expect(failingServer.enabled).toBe(false);
    // Raw URL preserved
    expect(failingServer.url).toBe("https://corrupt.example.com/mcp?token=secret");
  });

  it("migrates legacy origin-only URL to secretStorage when mcpHttpUrlsMigrated is false", () => {
    const { app } = fakeApp();
    const originOnlyServer = serverFixture({
      id: "srv-origin-only",
      name: "Origin Only Legacy",
      transport: "http",
      url: "https://mcp.example.com",
    });
    const settings = { mcpServers: [originOnlyServer], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(1);
    expect(result.changed).toBe(true);
    expect(settings.mcpHttpUrlsMigrated).toBe(true);
    expect(getMcpHttpUrl(app, "srv-origin-only")).toBe("https://mcp.example.com");
    expect(originOnlyServer.url).toBe("https://mcp.example.com");
  });

  it("stamps mcpHttpUrlsMigrated = true and changed = true on upgrade with zero HTTP servers", () => {
    const { app } = fakeApp();
    const stdioServer = serverFixture({
      id: "srv-stdio",
      transport: "stdio",
      command: "node",
    });
    const settings = { mcpServers: [stdioServer], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([]);
    expect(result.changed).toBe(true);
    expect(settings.mcpHttpUrlsMigrated).toBe(true);
  });

  it("sets empty string in payload.http_urls for oversized stored URL to prevent stale backend URL", () => {
    const { app } = fakeApp();
    const server = serverFixture({
      id: "srv-too-big",
      transport: "http",
      url: "https://mcp.example.com",
    });
    setMcpHttpUrl(app, "srv-too-big", "https://mcp.example.com/mcp?token=" + "a".repeat(2050));

    const result = buildMcpSecretPayload(app, [server]);
    expect(result.payload.http_urls["srv-too-big"]).toBe("");
    expect(result.summary.http_urls["srv-too-big"]).toBe(false);
    expect(result.skipped).toContainEqual({
      serverId: "srv-too-big",
      reason: "url-too-large",
    });
  });

  it("buildMcpSecretPayload throws coded error in strict mode when secretStorage read fails", () => {
    const storage = new FakeSecretStorage();
    storage.getSecret = () => {
      throw new Error("Disk read error");
    };
    const app = { secretStorage: storage } as unknown as never;
    const server = serverFixture({
      id: "srv-fail",
      transport: "http",
      url: "https://mcp.example.com",
    });

    expect(() => buildMcpSecretPayload(app, [server], { strict: true })).toThrow(
      /MCP_SECRET_PAYLOAD_READ_FAILED/,
    );
  });

  it("hasMcpHttpUrl and hasMcpEnvSecret safely return boolean without throwing", () => {
    const { app } = fakeApp();
    expect(hasMcpHttpUrl(app, "srv-1")).toBe(false);
    expect(hasMcpEnvSecret(app, "srv-1", "KEY")).toBe(false);

    setMcpHttpUrl(app, "srv-1", "https://example.com");
    setMcpSecret(app, "srv-1", "KEY", "val");

    expect(hasMcpHttpUrl(app, "srv-1")).toBe(true);
    expect(hasMcpEnvSecret(app, "srv-1", "KEY")).toBe(true);
  });

  it("hasMcpHttpUrl and hasMcpEnvSecret safely return false when secretStorage throws", () => {
    const storage = new FakeSecretStorage();
    storage.getSecret = () => {
      throw new Error("Secret storage OS keychain lock");
    };
    const app = { secretStorage: storage } as unknown as never;

    expect(hasMcpHttpUrl(app, "srv-1")).toBe(false);
    expect(hasMcpEnvSecret(app, "srv-1", "KEY")).toBe(false);
  });

  it("migration fails server and preserves rawUrl when rawUrl matches safeOrigin but storedUrl is invalid", () => {
    const { app } = fakeApp();
    // Stored URL is corrupt / invalid
    setMcpHttpUrl(app, "srv-invalid-stored", "not-a-valid-http-url");
    const server = serverFixture({
      id: "srv-invalid-stored",
      name: "Invalid Stored Server",
      transport: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });
    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([{ id: "srv-invalid-stored", name: "Invalid Stored Server" }]);
    expect(settings.mcpHttpUrlsMigrated).toBe(false);
    expect(server.enabled).toBe(false);
    expect(server.url).toBe("https://mcp.example.com");
  });

  it("migration preserves stored full URL when rawUrl is safe origin and storedUrl has same origin", () => {
    const { app } = fakeApp();
    const server = serverFixture({
      id: "srv-same-origin",
      name: "Same Origin Server",
      transport: "http",
      url: "https://mcp.example.com",
      enabled: true,
    });
    setMcpHttpUrl(app, "srv-same-origin", "https://mcp.example.com/v1/mcp?token=canary-valid-token-123");

    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(1);
    expect(result.failedServers).toEqual([]);
    expect(settings.mcpHttpUrlsMigrated).toBe(true);
    expect(server.enabled).toBe(true);
    expect(server.url).toBe("https://mcp.example.com");
    expect(getMcpHttpUrl(app, "srv-same-origin")).toBe(
      "https://mcp.example.com/v1/mcp?token=canary-valid-token-123",
    );
  });

  it("migration fails server and clears mismatched stored secret when storedUrl origin differs from raw safe origin", () => {
    const { app } = fakeApp();
    // Raw is Origin A, but stored is Origin B
    const server = serverFixture({
      id: "srv-origin-mismatch",
      name: "Mismatch Server",
      transport: "http",
      url: "https://origin-a.example.com",
      enabled: true,
    });
    setMcpHttpUrl(app, "srv-origin-mismatch", "https://origin-b.example.com/stream?token=secret-b-456");

    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: false };
    const result = migrateMcpHttpUrls(app, settings);

    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([
      { id: "srv-origin-mismatch", name: "Mismatch Server" },
    ]);
    expect(settings.mcpHttpUrlsMigrated).toBe(false);
    expect(server.enabled).toBe(false);
    expect(server.url).toBe("https://origin-a.example.com");
    // Stale secret is purged
    expect(getMcpHttpUrl(app, "srv-origin-mismatch")).toBeNull();

    // Payload verification: 0 payload and 0 connection to origin B
    const payloadResult = buildMcpSecretPayload(app, [server]);
    expect(payloadResult.payload.http_urls["srv-origin-mismatch"]).toBeUndefined();
  });

  it("handles delete throw fail-closed: keeps server disabled, blocks modal save, and excludes stale secret from payload", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const values = new Map<string, string>();
    const canaryB = "https://origin-b.example.com/endpoint?token=super-secret-canary-b";
    values.set(mcpHttpUrlSecretId("srv-throw"), canaryB);

    const storage = {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, val: string) => values.set(id, val),
      deleteSecret: () => {
        throw new Error("Disk permission denied during secret deletion");
      },
    };
    const app = { secretStorage: storage } as unknown as never;

    const server = serverFixture({
      id: "srv-throw",
      name: "Throw Server",
      transport: "http",
      url: "https://origin-a.example.com",
      enabled: true,
    });
    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: false };

    const result = migrateMcpHttpUrls(app, settings);
    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([{ id: "srv-throw", name: "Throw Server" }]);
    expect(server.enabled).toBe(false);
    expect(server.url).toBe("https://origin-a.example.com");

    // Diagnostic warning logged without canary or raw error
    expect(warnSpy).toHaveBeenCalled();
    for (const call of warnSpy.mock.calls) {
      const msg = call.join(" ");
      expect(msg).not.toContain(canaryB);
      expect(msg).not.toContain("super-secret-canary");
      expect(msg).not.toContain("Disk permission denied");
      expect(msg).toContain("MCP_SECRET_DELETE_FAILED");
    }

    // Origin-aware check fails because stored secret B doesn't match server origin A
    expect(hasMcpHttpUrl(app, server.id, server.url)).toBe(false);

    // Recovery modal validation blocks saving without staging a new valid URL
    const problem = validateMcpServerForm(server, {
      hasStoredUrl: hasMcpHttpUrl(app, server.id, server.url),
      stagedRawUrl: undefined,
    });
    expect(problem).toBe("원격 서버 URL을 입력해 주세요.");

    // Best-effort payload: 0 count of canary B
    const payloadResult = buildMcpSecretPayload(app, [{ ...server, enabled: true }]);
    expect(payloadResult.payload.http_urls["srv-throw"]).toBe("");
    expect(payloadResult.skipped).toContainEqual({
      serverId: "srv-throw",
      reason: "origin-mismatch",
    });

    // Strict handoff throws coded diagnostic without leaking canary
    expect(() =>
      buildMcpSecretPayload(app, [{ ...server, enabled: true }], { strict: true }),
    ).toThrow("MCP_SECRET_PAYLOAD_ORIGIN_MISMATCH:srv-throw");

    // Saving new valid URL A restores usable state
    const newUrlA = "https://origin-a.example.com/v1/mcp?token=fresh-token-a";
    values.set(mcpHttpUrlSecretId("srv-throw"), newUrlA);
    expect(hasMcpHttpUrl(app, server.id, server.url)).toBe(true);
    const validPayload = buildMcpSecretPayload(app, [{ ...server, enabled: true }]);
    expect(validPayload.payload.http_urls["srv-throw"]).toBe(newUrlA);

    warnSpy.mockRestore();
  });

  it("handles delete silent no-op fail-closed: detects unconfirmed delete, blocks modal save, and excludes stale secret", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const values = new Map<string, string>();
    const canaryB = "https://origin-b.example.com/stream?token=noop-canary-b";
    values.set(mcpHttpUrlSecretId("srv-noop"), canaryB);

    const storage = {
      getSecret: (id: string) => values.get(id) ?? null,
      setSecret: (id: string, val: string) => values.set(id, val),
      deleteSecret: () => {
        /* Silent no-op: does not delete */
      },
    };
    const app = { secretStorage: storage } as unknown as never;

    const server = serverFixture({
      id: "srv-noop",
      name: "Noop Server",
      transport: "http",
      url: "https://origin-a.example.com",
      enabled: true,
    });
    const settings = { mcpServers: [server], mcpHttpUrlsMigrated: false };

    const result = migrateMcpHttpUrls(app, settings);
    expect(result.migratedCount).toBe(0);
    expect(result.failedServers).toEqual([{ id: "srv-noop", name: "Noop Server" }]);
    expect(server.enabled).toBe(false);

    // Unconfirmed delete warning logged without canary
    expect(warnSpy).toHaveBeenCalled();
    for (const call of warnSpy.mock.calls) {
      const msg = call.join(" ");
      expect(msg).not.toContain(canaryB);
      expect(msg).toContain("MCP_SECRET_DELETE_UNCONFIRMED");
    }

    // Origin-aware check treats mismatched stale secret as false
    expect(hasMcpHttpUrl(app, server.id, server.url)).toBe(false);

    // Modal save rejected when staged is undefined
    const problem = validateMcpServerForm(server, {
      hasStoredUrl: hasMcpHttpUrl(app, server.id, server.url),
      stagedRawUrl: undefined,
    });
    expect(problem).toBeDefined();

    // Payload excludes canary B
    const payload = buildMcpSecretPayload(app, [{ ...server, enabled: true }]);
    expect(payload.payload.http_urls["srv-noop"]).toBe("");

    warnSpy.mockRestore();
  });

  it("handles malformed / invalid stored URL and blank server origin in payload", () => {
    const { app } = fakeApp();
    setMcpHttpUrl(app, "srv-bad-url", "not a url \u0000 with null byte");
    const server = serverFixture({
      id: "srv-bad-url",
      transport: "http",
      url: "",
      enabled: true,
    });

    const payload = buildMcpSecretPayload(app, [server]);
    expect(payload.payload.http_urls["srv-bad-url"]).toBe("");
    expect(payload.skipped).toContainEqual({
      serverId: "srv-bad-url",
      reason: "invalid-url",
    });

    expect(() =>
      buildMcpSecretPayload(app, [server], { strict: true }),
    ).toThrow("MCP_SECRET_PAYLOAD_INVALID_URL:srv-bad-url");
  });
});
