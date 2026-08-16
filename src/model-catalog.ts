import type { LLMProviderId } from "./types";

type RawProviderModel = { id: string; created: number };

// The OpenAI models endpoint includes models that cannot answer the plugin's
// grounded text prompt (audio, transcription, embeddings, and so on).
const OPENAI_NON_CHAT_MARKERS = [
  "audio",
  "dall-e",
  "embedding",
  "image",
  "moderation",
  "realtime",
  "transcribe",
  "tts",
  "whisper",
] as const;

export function isSelectableAnswerModel(provider: LLMProviderId, modelId: string): boolean {
  if (provider !== "openai") return true;
  const normalized = modelId.trim().toLowerCase();
  if (!normalized || OPENAI_NON_CHAT_MARKERS.some((marker) => normalized.includes(marker))) {
    return false;
  }
  // The endpoint does not expose a capability field, so keep the known text
  // model families supported by the Responses adapter.
  return /^(?:gpt(?:-|$)|chatgpt-|codex-|o\d+(?:-|$))/.test(normalized);
}

export function normalizeProviderModels(provider: LLMProviderId, data: unknown[]): string[] {
  const models = data
    .map((item: unknown): RawProviderModel | null => {
      if (!item || typeof item !== "object") return null;
      const value = item as { id?: unknown; created?: unknown };
      const id = typeof value.id === "string" ? value.id.trim() : "";
      if (!id || !isSelectableAnswerModel(provider, id)) return null;
      return { id, created: typeof value.created === "number" ? value.created : 0 };
    })
    .filter((item): item is RawProviderModel => item !== null)
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return [...new Set(models.map((item) => item.id))].slice(0, 200);
}

export function chooseProviderModel(
  availableModels: string[],
  rememberedModel: string | undefined,
  fallbackModel: string,
): string {
  const remembered = rememberedModel?.trim() || "";
  if (availableModels.length) {
    return availableModels.includes(remembered) ? remembered : availableModels[0];
  }
  return remembered || fallbackModel;
}
