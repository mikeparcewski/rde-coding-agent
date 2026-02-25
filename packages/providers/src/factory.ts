import type { LLMAdapter } from "@the-agent/core";
import { AnthropicAdapter } from "./anthropic/anthropic-adapter.js";
import { OpenAIAdapter } from "./openai/openai-adapter.js";
import { GoogleAdapter } from "./google/google-adapter.js";
import { OllamaAdapter } from "./ollama/ollama-adapter.js";

export type ProviderConfig =
  | {
      provider: "anthropic";
      apiKey: string;
      defaultModel: string;
    }
  | {
      provider: "openai";
      apiKey: string;
      defaultModel: string;
      baseURL?: string;
    }
  | {
      provider: "google";
      apiKey: string;
      defaultModel: string;
    }
  | {
      provider: "ollama";
      baseUrl: string;
      defaultModel: string;
    };

/**
 * createAdapter() instantiates the correct LLMAdapter from a provider config.
 * This is the primary factory used by the CLI framework loader.
 *
 * @example
 * const adapter = createAdapter({
 *   provider: "anthropic",
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   defaultModel: "claude-opus-4-6",
 * });
 */
export function createAdapter(config: ProviderConfig): LLMAdapter {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter({
        apiKey: config.apiKey,
        defaultModel: config.defaultModel,
      });

    case "openai":
      return new OpenAIAdapter({
        apiKey: config.apiKey,
        defaultModel: config.defaultModel,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });

    case "google":
      return new GoogleAdapter({
        apiKey: config.apiKey,
        defaultModel: config.defaultModel,
      });

    case "ollama":
      return new OllamaAdapter({
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
      });

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = config;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
