import type {
  LLMAdapter,
  CompletionOptions,
  CompletionSignal,
  Message,
  Tool,
} from "@the-agent/core";

export interface OllamaAdapterConfig {
  baseUrl: string;
  defaultModel: string;
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  tool_call_id?: string | undefined;
}

interface OllamaToolFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  options?: {
    temperature?: number | undefined;
    num_predict?: number | undefined;
  } | undefined;
  tools?: Array<{ type: "function"; function: OllamaToolFunction }> | undefined;
  stream: boolean;
}

interface OllamaResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      id?: string;
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done: boolean;
  done_reason?: string;
}

export class OllamaAdapter implements LLMAdapter {
  readonly providerId = "ollama";
  readonly supportedModels: readonly string[] = [
    // Ollama supports dynamic models — list is open-ended
    "llama3.3",
    "llama3.1",
    "mistral",
    "mixtral",
    "gemma2",
    "phi4",
    "qwen2.5",
    "deepseek-r1",
  ];

  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(config: OllamaAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.defaultModel = config.defaultModel;
  }

  async complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal> {
    try {
      const body: OllamaRequest = {
        model: options.model || this.defaultModel,
        messages: this.convertMessages(messages),
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
        tools: options.tools ? this.convertTools(options.tools) : undefined,
        stream: false,
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          type: "error",
          code: String(response.status),
          message: text,
          retryable: response.status >= 500,
        };
      }

      const data = (await response.json()) as OllamaResponse;
      return this.normalizeResponse(data);
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
      const body: OllamaRequest = {
        model: options.model || this.defaultModel,
        messages: this.convertMessages(messages),
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
        },
        tools: options.tools ? this.convertTools(options.tools) : undefined,
        stream: true,
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          type: "error",
          code: String(response.status),
          message: text,
          retryable: response.status >= 500,
        };
      }

      if (!response.body) {
        return {
          type: "error",
          code: "no_body",
          message: "Response body is null",
          retryable: false,
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let lastChunk: OllamaResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.trim());

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line) as OllamaResponse;
            lastChunk = chunk;

            if (chunk.message?.content) {
              fullText += chunk.message.content;
              onDelta(chunk.message.content);
            }
          } catch {
            // Incomplete JSON line — skip
          }
        }
      }

      if (lastChunk?.message?.tool_calls?.length) {
        const calls = lastChunk.message.tool_calls.map((tc, idx) => ({
          id: tc.id ?? `tool-${idx}-${Date.now()}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
        return { type: "tool_use", calls };
      }

      return { type: "text", content: fullText, stopReason: "end_turn" };
    } catch (error) {
      return this.normalizeError(error);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return { ok: response.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private convertMessages(messages: Message[]): OllamaMessage[] {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          ...(msg.toolCallId !== undefined ? { tool_call_id: msg.toolCallId } : {}),
        };
      }
      return {
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      };
    });
  }

  private convertTools(
    tools: Tool[]
  ): Array<{ type: "function"; function: OllamaToolFunction }> {
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
              { type: param.type, description: param.description },
            ])
          ),
          required: Object.entries(tool.parameters)
            .filter(([, param]) => param.required)
            .map(([key]) => key),
        },
      },
    }));
  }

  private normalizeResponse(data: OllamaResponse): CompletionSignal {
    if (data.message?.tool_calls?.length) {
      const calls = data.message.tool_calls.map((tc, idx) => ({
        id: tc.id ?? `tool-${idx}-${Date.now()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
      return { type: "tool_use", calls };
    }

    const stopReason: "end_turn" | "max_tokens" | "stop_sequence" =
      data.done_reason === "length" ? "max_tokens" : "end_turn";

    return {
      type: "text",
      content: data.message?.content ?? "",
      stopReason,
    };
  }

  private normalizeError(error: unknown): CompletionSignal {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT");
    return {
      type: "error",
      code: "ollama_error",
      message,
      retryable,
    };
  }
}
