import { requestUrl, type App, type SecretStorage } from "obsidian";
import type { LLMProviderId } from "./types";
import {
  LLM_CHAT_ENDPOINTS,
  LLM_CLIENT_USER_AGENT,
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
 *  endpoint.
 *
 *  - "valid": 2xx/3xx, the key was accepted.
 *  - "invalid": definitive 401/403 rejection of the credential.
 *  - "rejected": the gateway answered but refused the request for a non-auth
 *    reason (retired model id, region/privacy block, missing routing header).
 *    The key itself may still be fine, so this must not be reported as an
 *    invalid key.
 *  - "unverified": the API could not be reached or answered with a transient
 *    status (network, timeout, 429, 5xx).
 *
 *  The models endpoint does NOT validate keys, so a successful model fetch is
 *  not proof a key works. */
export type ProviderKeyStatus = "valid" | "invalid" | "rejected" | "unverified";

export interface ProviderKeyProbe {
  status: ProviderKeyStatus;
  /** Provider-supplied error text for rejected/unverified outcomes. */
  detail: string;
}

export function createSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `vault-search-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function readErrorBody(response: {
  text?: string;
  json?: unknown;
}): unknown {
  try {
    const parsed = response.json;
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
      return parsed;
    }
  } catch {
    // Obsidian's `json` getter throws for non-JSON bodies.
  }
  try {
    if (typeof response.text === "string" && response.text.trim()) {
      return JSON.parse(response.text);
    }
  } catch {
    // Leave the raw text unused; the status code is still reported.
  }
  return null;
}

function errorDetail(response: {
  status: number;
  text?: string;
  json?: unknown;
}): string {
  const data = readErrorBody(response);
  const root = (data || {}) as { error?: unknown; message?: unknown };
  const error = (root.error ?? root) as {
    message?: unknown;
    type?: unknown;
  };
  const parts = [error?.type, error?.message, root.message]
    .filter((part): part is string => typeof part === "string" && !!part.trim())
    .map((part) => part.trim());
  return parts.join(": ") || `HTTP ${response.status}`;
}

export async function validateProviderApiKey(
  provider: LLMProviderId,
  apiKey: string,
): Promise<ProviderKeyProbe> {
  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": LLM_CLIENT_USER_AGENT,
  };
  // OpenCode Go routes per conversation and rejects requests without this
  // header before it ever checks the credential.
  if (provider === "opencode-go") {
    headers["x-opencode-session"] = createSessionId();
  }
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
      url: LLM_CHAT_ENDPOINTS[provider],
      method: "POST",
      contentType: "application/json",
      headers,
      body,
      throw: false,
    });
    const detail = errorDetail(response);
    if (response.status === 401 || response.status === 403) {
      // A routing/bot/region refusal can surface as 401/403 without meaning the
      // key is bad, so keep that distinguishable from a credential rejection.
      const lowered = detail.toLowerCase();
      const notCredential =
        lowered.includes("session") ||
        lowered.includes("1010") ||
        lowered.includes("cloudflare");
      return notCredential
        ? { status: "rejected", detail }
        : { status: "invalid", detail };
    }
    if (response.status >= 200 && response.status < 400) {
      return { status: "valid", detail: "" };
    }
    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 422
    ) {
      return { status: "rejected", detail };
    }
    return { status: "unverified", detail };
  } catch (error) {
    return {
      status: "unverified",
      detail: error instanceof Error ? error.message : "",
    };
  }
}
