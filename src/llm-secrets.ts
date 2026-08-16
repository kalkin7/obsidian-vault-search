import { requestUrl, type App, type SecretStorage } from "obsidian";
import type { LLMProviderId } from "./types";
import {
  LLM_MODEL_ENDPOINTS,
  LLM_PROVIDER_DEFAULTS,
  LLM_SECRET_IDS,
} from "./constants";

type SecretCapableApp = App & { secretStorage?: SecretStorage };

function storage(app: App): SecretStorage | undefined {
  return (app as SecretCapableApp).secretStorage;
}

export function hasSecretStorage(app: App): boolean {
  return Boolean(storage(app));
}

export function getProviderSecret(app: App, provider: LLMProviderId): string {
  return storage(app)?.getSecret(LLM_SECRET_IDS[provider])?.trim() || "";
}

export function setProviderSecret(
  app: App,
  provider: LLMProviderId,
  secret: string,
): void {
  const secretStorage = storage(app);
  if (!secretStorage) {
    throw new Error(
      "이 버전의 Obsidian은 보안 키 저장소를 지원하지 않습니다. Obsidian 1.11.4 이상이 필요합니다.",
    );
  }
  secretStorage.setSecret(LLM_SECRET_IDS[provider], secret.trim());
}

export function providerEnvironment(app: App): Record<string, string> {
  const environment: Record<string, string> = {};
  const secretStorage = storage(app);
  if (!secretStorage) return environment;
  for (const provider of Object.keys(
    LLM_PROVIDER_DEFAULTS,
  ) as LLMProviderId[]) {
    const stored = secretStorage.getSecret(LLM_SECRET_IDS[provider]);
    if (stored !== null) {
      environment[LLM_PROVIDER_DEFAULTS[provider].env] = stored.trim();
    }
  }
  return environment;
}

export function mergeProviderEnvironment(
  inherited: Record<string, string | undefined>,
  providerValues: Record<string, string>,
): Record<string, string> {
  const environment = { ...inherited } as Record<string, string>;
  for (const name of Object.keys(providerValues)) delete environment[name];
  Object.assign(environment, providerValues);
  return environment;
}

/** Outcome of a one-token key probe against the provider's real chat
 *  endpoint: "invalid" only on a definitive 401/403 rejection, "valid" on a
 *  2xx/3xx, "unverified" when the API could not be reached or answered with
 *  another status (network, timeout, 429, 5xx). The models endpoint does NOT
 *  validate keys, so a successful model fetch is not proof a key works. */
export type ProviderKeyStatus = "valid" | "invalid" | "unverified";

export async function validateProviderApiKey(
  provider: LLMProviderId,
  apiKey: string,
): Promise<ProviderKeyStatus> {
  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  const url =
    provider === "openai"
      ? "https://api.openai.com/v1/responses"
      : LLM_MODEL_ENDPOINTS[provider].replace(/\/models$/, "/chat/completions");
  const body =
    provider === "openai"
      ? JSON.stringify({
          model: defaults.model,
          input: "hi",
          max_output_tokens: 1,
        })
      : JSON.stringify({
          model: defaults.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        });
  try {
    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      throw: false,
    });
    if (response.status === 401 || response.status === 403) return "invalid";
    if (response.status >= 200 && response.status < 400) return "valid";
    return "unverified";
  } catch {
    return "unverified";
  }
}
