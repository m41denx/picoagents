import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { getOpenAICompatConfig } from "../config.ts";

let cached: ReturnType<typeof createOpenAI> | undefined;

export function getOpenAIProvider() {
  if (!cached) {
    const { apiKey, baseURL } = getOpenAICompatConfig();
    cached = createOpenAI({ apiKey, baseURL });
  }
  return cached;
}

/** Uses Chat Completions (`/v1/chat/completions`) — compatible with LM Studio / OpenRouter. */
export function getLanguageModel(modelId: string): LanguageModel {
  return getOpenAIProvider().chat(modelId);
}
