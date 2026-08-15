import { describe, expect, it } from "vitest";
import {
  getProviderSecret,
  mergeProviderEnvironment,
  providerEnvironment,
  setProviderSecret,
} from "../../src/llm-secrets";

function fakeApp() {
  const values = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: (id: string) => values.has(id) ? values.get(id)! : null,
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
    expect(mergeProviderEnvironment(
      { OPENAI_API_KEY: "inherited-key", OTHER_ENV: "kept" },
      providerEnvironment(app),
    )).toEqual({ OPENAI_API_KEY: "", OTHER_ENV: "kept" });
  });
});
