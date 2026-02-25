import OpenAI from "openai";
import type {
  LLMAdapter,
  CompletionOptions,
  CompletionSignal,
  Message,
} from "@the-agent/core";

export interface OpenAIAdapterConfig {
  apiKey: string;
  defaultModel: string;
  baseURL?: string;
}

export class OpenAIAdapter implements LLMAdapter {
  readonly providerId = "openai";
  readonly supportedModels: readonly string[] = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
  ];

  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: OpenAIAdapterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.defaultModel = config.defaultModel;
  }

  async complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal> {
    try {
      const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;
      const response = await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: this.convertMessages(messages, options.systemPrompt),
        ...(convertedTools !== undefined ? { tools: convertedTools, tool_choice: "auto" as const } : {}),
      });

      return this.normalizeResponse(response);
    } catch (error) {
      return this.normalizeError(error);
    }
  }

  async stream(
    messages: Message[],
    options: CompletionOptions,
    onDelta: (delta: string) => void
  ): Promise<CompletionSignal> {
    try {
      const streamConvertedTools = options.tools ? this.convertTools(options.tools) : undefined;
      const stream = await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: this.convertMessages(messages, options.systemPrompt),
        ...(streamConvertedTools !== undefined ? { tools: streamConvertedTools, tool_choice: "auto" as const } : {}),
        stream: true,
      });

      let fullText = "";
      let stopReason: "end_turn" | "max_tokens" | "stop_sequence" = "end_turn";
      const toolCallAccumulator: Map<
        number,
        { id: string; name: string; arguments: string }
      > = new Map();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          fullText += delta.content;
          onDelta(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallAccumulator.get(tc.index);
            if (existing) {
              existing.arguments += tc.function?.arguments ?? "";
            } else {
              toolCallAccumulator.set(tc.index, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              });
            }
          }
        }

        if (choice.finish_reason === "length") {
          stopReason = "max_tokens";
        } else if (choice.finish_reason === "stop") {
          stopReason = "end_turn";
        }
      }

      if (toolCallAccumulator.size > 0) {
        const calls = Array.from(toolCallAccumulator.values()).map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: this.parseJson(tc.arguments),
        }));
        return { type: "tool_use", calls };
      }

      return { type: "text", content: fullText, stopReason };
    } catch (error) {
      return this.normalizeError(error);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.client.models.list();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool") {
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId ?? "",
          content: msg.content,
        });
      }
    }

    return result;
  }

  private convertTools(
    tools: CompletionOptions["tools"]
  ): OpenAI.ChatCompletionTool[] {
    if (!tools) return [];
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              {
                type: param.type,
                description: param.description,
                ...(param.enum ? { enum: param.enum } : {}),
              },
            ])
          ),
          required: Object.entries(tool.parameters)
            .filter(([, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));
  }

  private normalizeResponse(
    response: OpenAI.ChatCompletion
  ): CompletionSignal {
    const choice = response.choices[0];
    if (!choice) {
      return {
        type: "error",
        code: "no_choice",
        message: "No completion choice returned",
        retryable: false,
      };
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const calls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.parseJson(tc.function.arguments),
      }));
      return { type: "tool_use", calls };
    }

    const stopReason =
      choice.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";

    return {
      type: "text",
      content: choice.message.content ?? "",
      stopReason,
    };
  }

  private normalizeError(error: unknown): CompletionSignal {
    if (error instanceof OpenAI.APIError) {
      const retryable =
        error.status === 429 || (error.status >= 500 && error.status < 600);
      return {
        type: "error",
        code: String(error.status),
        message: error.message,
        retryable,
      };
    }
    return {
      type: "error",
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }

  private parseJson(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
