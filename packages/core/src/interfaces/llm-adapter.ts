import { z } from "zod";
import type { Message } from "./message.js";
import type { Tool } from "./tool.js";

export const CompletionOptionsSchema = z.object({
  model: z.string(),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(1),
  systemPrompt: z.string().optional(),
  tools: z.array(z.custom<Tool>()).optional(),
  stream: z.boolean().default(false),
});
export type CompletionOptions = z.infer<typeof CompletionOptionsSchema>;

// Discriminated union — the runtime only ever receives one signal type per turn
export const CompletionSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string(),
    stopReason: z.enum(["end_turn", "max_tokens", "stop_sequence"]),
  }),
  z.object({
    type: z.literal("tool_use"),
    calls: z.array(z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.record(z.unknown()),
    })),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type CompletionSignal = z.infer<typeof CompletionSignalSchema>;

export interface LLMAdapter {
  readonly providerId: string;
  readonly supportedModels: readonly string[];

  complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal>;

  stream(
    messages: Message[],
    options: CompletionOptions,
    onDelta: (delta: string) => void
  ): Promise<CompletionSignal>;

  health(): Promise<{ ok: boolean; latencyMs: number }>;
}
