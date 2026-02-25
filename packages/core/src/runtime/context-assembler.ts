import type { Message } from "../interfaces/message.js";
import type { CompletionOptions } from "../interfaces/llm-adapter.js";
import type { RuntimeSnapshot } from "./runtime-state.js";

// Approximate token count using 4-chars-per-token heuristic
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ContextAssemblerOptions {
  /** Maximum tokens to use for message history (reserve 20% of window for response) */
  maxContextTokens: number;
  /** System prompt override — if provided, prepended as a system message */
  systemPrompt?: string | undefined;
  /** Memory context injected as a labelled system message after main system prompt */
  memoryContext?: string | undefined;
}

/**
 * ContextAssembler builds the Message[] array that gets sent to the LLM on each turn.
 *
 * Assembly order:
 *   1. System prompt (from agent config or override)
 *   2. [Memory Context] system message (if memory recall produced results)
 *   3. Conversation history (oldest messages truncated first to fit token budget)
 *   4. Pending tool results appended as tool messages
 */
export class ContextAssembler {
  assemble(
    snapshot: RuntimeSnapshot,
    options: ContextAssemblerOptions
  ): Message[] {
    const messages: Message[] = [];
    const now = Date.now();

    // 1. System prompt
    if (options.systemPrompt) {
      messages.push({
        id: crypto.randomUUID(),
        role: "system",
        content: options.systemPrompt,
        timestamp: now,
      });
    }

    // 2. Memory context injected as a separate system message
    if (options.memoryContext) {
      messages.push({
        id: crypto.randomUUID(),
        role: "system",
        content: `[Memory Context]\n${options.memoryContext}`,
        timestamp: now,
      });
    }

    // 3. Conversation history — truncate oldest messages first to fit token budget
    const systemTokens = messages.reduce(
      (acc, m) => acc + estimateTokens(m.content),
      0
    );
    const historyBudget = options.maxContextTokens - systemTokens;

    const historyMessages = this.truncateHistory(
      snapshot.messages,
      historyBudget
    );
    messages.push(...historyMessages);

    return messages;
  }

  /**
   * Truncates conversation history from the oldest end until total estimated
   * token count fits within the budget. Always retains at least the last message.
   */
  private truncateHistory(messages: readonly Message[], tokenBudget: number): Message[] {
    if (messages.length === 0) {
      return [];
    }

    // Work from newest to oldest, accumulating token count
    const retained: Message[] = [];
    let tokensUsed = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg === undefined) continue;
      const tokens = estimateTokens(msg.content);

      if (tokensUsed + tokens > tokenBudget && retained.length > 0) {
        // Budget exhausted — stop (we always keep at least the newest message)
        break;
      }

      retained.unshift(msg);
      tokensUsed += tokens;
    }

    return retained;
  }

  /**
   * Builds CompletionOptions from the agent config values, applying defaults.
   */
  buildCompletionOptions(
    model: string,
    overrides: Partial<CompletionOptions>
  ): CompletionOptions {
    return {
      model,
      maxTokens: overrides.maxTokens ?? 4096,
      temperature: overrides.temperature ?? 1,
      ...(overrides.systemPrompt !== undefined ? { systemPrompt: overrides.systemPrompt } : {}),
      ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
      stream: overrides.stream ?? false,
    };
  }
}
