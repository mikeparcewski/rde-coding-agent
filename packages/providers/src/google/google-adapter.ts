import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type Content,
  type Tool as GoogleTool,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type {
  LLMAdapter,
  CompletionOptions,
  CompletionSignal,
  Message,
} from "@the-agent/core";

export interface GoogleAdapterConfig {
  apiKey: string;
  defaultModel: string;
}

export class GoogleAdapter implements LLMAdapter {
  readonly providerId = "google";
  readonly supportedModels: readonly string[] = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
  ];

  private readonly genAI: GoogleGenerativeAI;
  private readonly defaultModel: string;

  constructor(config: GoogleAdapterConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.defaultModel = config.defaultModel;
  }

  async complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal> {
    try {
      const model = this.getModel(options);
      const { history, lastUserMessage } = this.convertMessages(messages, options.systemPrompt);

      const chat = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          temperature: options.temperature,
        },
      });

      const result = await chat.sendMessage(lastUserMessage);
      return this.normalizeResponse(result.response);
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
      const model = this.getModel(options);
      const { history, lastUserMessage } = this.convertMessages(messages, options.systemPrompt);

      const chat = model.startChat({
        history,
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          temperature: options.temperature,
        },
      });

      const result = await chat.sendMessageStream(lastUserMessage);

      let fullText = "";
      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        if (text) onDelta(text);
      }

      const response = await result.response;
      return this.normalizeResponse(response, fullText);
    } catch (error) {
      return this.normalizeError(error);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const model = this.genAI.getGenerativeModel({ model: this.defaultModel });
      await model.generateContent("ping");
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private getModel(options: CompletionOptions): GenerativeModel {
    const modelName = options.model || this.defaultModel;

    const typeMap: Record<string, SchemaType> = {
      string: SchemaType.STRING,
      number: SchemaType.NUMBER,
      boolean: SchemaType.BOOLEAN,
      array: SchemaType.ARRAY,
      object: SchemaType.OBJECT,
    };

    const tools: GoogleTool[] | undefined = options.tools
      ? [
          {
            functionDeclarations: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: {
                type: SchemaType.OBJECT,
                properties: Object.fromEntries(
                  Object.entries(tool.parameters).map(([key, param]) => [
                    key,
                    {
                      type: typeMap[param.type] ?? SchemaType.STRING,
                      description: param.description,
                    },
                  ])
                ),
                required: Object.entries(tool.parameters)
                  .filter(([, param]) => param.required)
                  .map(([key]) => key),
              },
            })),
          },
        ]
      : undefined;

    return this.genAI.getGenerativeModel({
      model: modelName,
      ...(tools !== undefined ? { tools } : {}),
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        },
      ],
    });
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string
  ): { history: Content[]; lastUserMessage: string } {
    const allMessages = [...messages];

    // Inject system prompt as first user message if provided and not already in messages
    if (systemPrompt) {
      allMessages.unshift({
        id: "system-prompt",
        role: "user",
        content: `System instructions:\n${systemPrompt}`,
        timestamp: Date.now(),
      });
    }

    // Extract system messages and prepend them
    const history: Content[] = [];
    let lastUserMessage = "";

    // Filter out system-role messages; Google uses different approach
    const nonSystemMessages = allMessages.filter((m) => m.role !== "system");

    // The last message should be from user — extract it
    const lastMsg = nonSystemMessages[nonSystemMessages.length - 1];
    if (lastMsg) {
      lastUserMessage = lastMsg.content;
    }

    // Build history from all but the last message
    for (const msg of nonSystemMessages.slice(0, -1)) {
      history.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    return { history, lastUserMessage };
  }

  private normalizeResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: any,
    overrideText?: string
  ): CompletionSignal {
    try {
      // Check for function calls
      const candidate = response.candidates?.[0];
      if (candidate?.content?.parts) {
        const functionCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
        let textContent = overrideText ?? "";

        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            functionCalls.push({
              id: `${part.functionCall.name}-${Date.now()}`,
              name: part.functionCall.name as string,
              arguments: part.functionCall.args as Record<string, unknown>,
            });
          } else if (part.text && !overrideText) {
            textContent += part.text as string;
          }
        }

        if (functionCalls.length > 0) {
          return { type: "tool_use", calls: functionCalls };
        }

        const finishReason = candidate.finishReason as string | undefined;
        const stopReason: "end_turn" | "max_tokens" | "stop_sequence" =
          finishReason === "MAX_TOKENS"
            ? "max_tokens"
            : finishReason === "STOP"
            ? "end_turn"
            : "end_turn";

        return { type: "text", content: textContent, stopReason };
      }

      const text = overrideText ?? (response.text() as string);
      return { type: "text", content: text, stopReason: "end_turn" };
    } catch (error) {
      return this.normalizeError(error);
    }
  }

  private normalizeError(error: unknown): CompletionSignal {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      message.includes("429") ||
      message.includes("500") ||
      message.includes("503");
    return {
      type: "error",
      code: "google_error",
      message,
      retryable,
    };
  }
}
