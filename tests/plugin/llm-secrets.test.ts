import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import {
  getProviderSecret,
  mergeProviderEnvironment,
  providerEnvironment,
  setProviderSecret,
  validateProviderApiKey,
} from "../../src/llm-secrets";

vi.mock("obsidian", async (importOriginal) => {
  const mod = await importOriginal<typeof import("obsidian")>();
  return { ...mod, requestUrl: vi.fn() };
});

const mockRequestUrl = requestUrl as unknown as {
  mockResolvedValue(value: unknown): void;
  mockRejectedValue(error: unknown): void;
  mockImplementation(impl: () => Promise<unknown>): void;
  mockClear(): void;
  mock: { calls: unknown[][] };
};

function response(status: number): unknown {
  return {
    status,
    text: "",
    json: {},
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
  };
}

beforeEach(() => mockRequestUrl.mockClear());

function fakeApp() {
  const values = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: (id: string) => (values.has(id) ? values.get(id)! : null),
      setSecret: (id: string, value: string) => values.set(id, value),
    },
  } as never;
}

describe("LLM secrets", () => {
  it("stores provider keys in secret storage and maps them to sidecar env names", () => {
    const app = fakeApp();
    setProviderSecret(app, "openai", "  key-1  ");
    setProviderSecret(app, "deepseek", "key-2");

    expect(getProviderSecret(app, "openai")).toBe("key-1");
    expect(providerEnvironment(app)).toEqual({
      OPENAI_API_KEY: "key-1",
      DEEPSEEK_API_KEY: "key-2",
    });
  });

  it("masks an inherited key when the stored secret is cleared", () => {
    const app = fakeApp();
    setProviderSecret(app, "openai", "");

    expect(providerEnvironment(app)).toEqual({ OPENAI_API_KEY: "" });
    expect(
      mergeProviderEnvironment(
        { OPENAI_API_KEY: "inherited-key", OTHER_ENV: "kept" },
        providerEnvironment(app),
      ),
    ).toEqual({ OPENAI_API_KEY: "", OTHER_ENV: "kept" });
  });

  it("rejects a key the provider answers 401 to (real chat endpoint probe)", async () => {
    mockRequestUrl.mockResolvedValue(response(401));
    expect(await validateProviderApiKey("opencode-go", "bad-key")).toBe(
      "invalid",
    );
    const call = mockRequestUrl.mock.calls[0][0] as {
      url: string;
      headers: Record<string, string>;
    };
    expect(call.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(call.headers.Authorization).toBe("Bearer bad-key");
  });

  it("returns valid on success and unverified when the provider cannot be reached", async () => {
    mockRequestUrl.mockResolvedValue(response(200));
    expect(await validateProviderApiKey("deepseek", "good-key")).toBe("valid");
    // A non-2xx/3xx status (or a network failure) must not block saving — it
    // reports "unverified" instead of claiming the key is invalid.
    mockRequestUrl.mockResolvedValue(response(503));
    expect(await validateProviderApiKey("opencode-go", "maybe-key")).toBe(
      "unverified",
    );
  });
});
