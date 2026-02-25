import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMAdapter,
  CompletionOptions,
  CompletionSignal,
  Message,
} from "@the-agent/core";

export interface AnthropicAdapterConfig {
  apiKey: string;
  defaultModel: string;
}

export class AnthropicAdapter implements LLMAdapter {
  readonly providerId = "anthropic";
  readonly supportedModels: readonly string[] = [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ];

  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(config: AnthropicAdapterConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.defaultModel = config.defaultModel;
  }

  async complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal> {
    const { systemMessages, userMessages } = this.splitMessages(messages);

    try {
      const systemText = systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
      const convertedTools = options.tools ? this.convertTools(options.tools) : undefined;
      const response = await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        ...(systemText !== undefined ? { system: systemText } : {}),
        messages: userMessages,
        ...(convertedTools !== undefined ? { tools: convertedTools } : {}),
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
    const { systemMessages, userMessages } = this.splitMessages(messages);

    try {
      let fullText = "";
      let stopReason: "end_turn" | "max_tokens" | "stop_sequence" = "end_turn";
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      const streamSystemText = systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
      const streamConvertedTools = options.tools ? this.convertTools(options.tools) : undefined;
      const stream = await this.client.messages.stream({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        ...(streamSystemText !== undefined ? { system: streamSystemText } : {}),
        messages: userMessages,
        ...(streamConvertedTools !== undefined ? { tools: streamConvertedTools } : {}),
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
          onDelta(event.delta.text);
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
        ) {
          // accumulate tool input — handled via message_stop
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason === "max_tokens") {
            stopReason = "max_tokens";
          } else if (event.delta.stop_reason === "stop_sequence") {
            stopReason = "stop_sequence";
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      // Check if response contains tool use
      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      if (toolCalls.length > 0) {
        return { type: "tool_use", calls: toolCalls };
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

  private splitMessages(messages: Message[]): {
    systemMessages: string[];
    userMessages: Anthropic.MessageParam[];
  } {
    const systemMessages: string[] = [];
    const userMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else if (msg.role === "user" || msg.role === "assistant") {
        userMessages.push({
          role: msg.role,
          content: msg.content,
        });
      } else if (msg.role === "tool") {
        // Tool results are added as user messages with tool_result content
        userMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId ?? "",
              content: msg.content,
            },
          ],
        });
      }
    }

    return { systemMessages, userMessages };
  }

  private convertTools(
    tools: CompletionOptions["tools"]
  ): Anthropic.Tool[] {
    if (!tools) return [];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
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
    }));
  }

  private normalizeResponse(
    response: Anthropic.Message
  ): CompletionSignal {
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let textContent = "";

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    if (toolCalls.length > 0) {
      return { type: "tool_use", calls: toolCalls };
    }

    const stopReason =
      response.stop_reason === "max_tokens"
        ? "max_tokens"
        : response.stop_reason === "stop_sequence"
        ? "stop_sequence"
        : "end_turn";

    return { type: "text", content: textContent, stopReason };
  }

  private normalizeError(error: unknown): CompletionSignal {
    if (error instanceof Anthropic.APIError) {
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
}
