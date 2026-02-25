import type { LLMAdapter, CompletionOptions, CompletionSignal } from "../interfaces/llm-adapter.js";
import type { AgentConfig } from "../interfaces/agent-config.js";
import type { Tool, ToolCall, ToolResult } from "../interfaces/tool.js";
import type { Message } from "../interfaces/message.js";
import type { CompletionContract, CompletionResult } from "../interfaces/completion.js";
import { RuntimeState, type RuntimePhase } from "./runtime-state.js";
import { ContextAssembler } from "./context-assembler.js";
import { ToolDispatcher } from "../dispatch/tool-dispatcher.js";

export interface RuntimeLoopOptions {
  adapter: LLMAdapter;
  agentConfig: AgentConfig;
  tools: Map<string, Tool>;
  /** Completion contract governs multi-turn loop termination */
  contract?: CompletionContract | undefined;
  /** Called on each phase transition for observability */
  onPhaseChange?: ((phase: RuntimePhase) => void) | undefined;
  /** Called when the LLM emits a text response */
  onText?: ((text: string) => void) | undefined;
  /** Called after all tool results are collected */
  onToolResults?: ((results: ToolResult[]) => void) | undefined;
  /** Called when the loop decides the task is complete */
  onComplete?: ((result: CompletionResult) => void) | undefined;
  /** Max context window tokens (default 80% of 200k = 160k, expressed in token units) */
  maxContextTokens?: number | undefined;
}

// Exponential backoff configuration for retryable errors
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export class RuntimeLoop {
  private readonly state: RuntimeState;
  private readonly assembler: ContextAssembler;
  private readonly dispatcher: ToolDispatcher;
  private readonly options: RuntimeLoopOptions;

  /** Tracks which completion conditions have been satisfied across turns */
  private readonly satisfiedConditionIds = new Set<string>();
  /** Tracks artifact paths collected during the session */
  private readonly artifacts: string[] = [];

  constructor(sessionId: string, options: RuntimeLoopOptions) {
    this.state = new RuntimeState(sessionId, options.agentConfig.id);
    this.assembler = new ContextAssembler();
    this.dispatcher = new ToolDispatcher();
    this.options = options;
  }

  get snapshot() {
    return this.state.snapshot;
  }

  /**
   * Process a single user message through the full turn loop.
   * Returns when the task reaches completion (text response with no further
   * tool calls needed, or contract conditions satisfied).
   */
  async run(userMessage: string): Promise<CompletionResult> {
    const startMs = Date.now();

    // Append user message to history
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    };
    this.state.appendMessage(userMsg);
    this.state.advanceTurn();

    const contract = this.options.contract;
    const maxTurns = contract?.maxTurns ?? this.options.agentConfig.maxTurns;
    const timeoutMs = contract?.timeoutMs ?? 300_000;
    const timeoutAt = startMs + timeoutMs;

    const { satisfiedConditionIds, artifacts } = this;
    const allConditionIds = contract?.conditions.map((c) => c.id) ?? [];

    let turnsUsed = 0;

    while (true) {
      // Check timeout
      if (Date.now() > timeoutAt) {
        return this.buildResult({
          done: false,
          satisfiedConditionIds,
          allConditionIds,
          artifacts,
          turnsUsed,
          startMs,
          summary: "Task timed out before completion.",
        });
      }

      // Check max turns
      if (turnsUsed >= maxTurns) {
        return this.buildResult({
          done: false,
          satisfiedConditionIds,
          allConditionIds,
          artifacts,
          turnsUsed,
          startMs,
          summary: `Reached maximum turns (${maxTurns}) without completing all conditions.`,
        });
      }

      // [assembling_context]
      this.transition("assembling_context");
      const contextMessages = this.assembler.assemble(this.state.snapshot, {
        maxContextTokens: this.options.maxContextTokens ?? 160_000,
        systemPrompt: this.options.agentConfig.systemPrompt,
      });

      const completionOptions: CompletionOptions = this.assembler.buildCompletionOptions(
        this.options.agentConfig.model ?? "default",
        {
          ...(this.options.agentConfig.temperature !== undefined
            ? { temperature: this.options.agentConfig.temperature }
            : {}),
          tools: [...this.options.tools.values()].filter((t) =>
            this.isToolAllowed(t.name, this.options.agentConfig.allowedTools)
          ),
        }
      );

      // [awaiting_completion]
      this.transition("awaiting_completion");
      const signal = await this.callLLMWithRetry(contextMessages, completionOptions);

      if (signal.type === "error") {
        this.transition("error");
        return this.buildResult({
          done: false,
          satisfiedConditionIds,
          allConditionIds,
          artifacts,
          turnsUsed,
          startMs,
          summary: `LLM error: ${signal.message}`,
        });
      }

      if (signal.type === "tool_use") {
        // [dispatching_tools]
        this.transition("dispatching_tools");

        const toolCalls: ToolCall[] = signal.calls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.arguments,
        }));

        // Record pending calls
        for (const call of toolCalls) {
          this.state.recordToolCall(call.id);
        }

        // Append assistant message with tool use intent
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: JSON.stringify({ tool_use: signal.calls }),
          timestamp: Date.now(),
        };
        this.state.appendMessage(assistantMsg);

        // [awaiting_tool_results]
        this.transition("awaiting_tool_results");
        const results = await this.dispatcher.dispatch(
          toolCalls,
          this.options.tools,
          this.options.agentConfig.allowedTools
        );

        // Record results and append to message history
        for (const result of results) {
          this.state.recordToolResult(result);
          const toolMsg: Message = {
            id: crypto.randomUUID(),
            role: "tool",
            content: result.error ?? JSON.stringify(result.output),
            timestamp: Date.now(),
            toolCallId: result.toolCallId,
          };
          this.state.appendMessage(toolMsg);
        }

        this.options.onToolResults?.(results);

        turnsUsed++;
        // Loop back to assembling_context
        continue;
      }

      // signal.type === "text"
      // Append assistant text response
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: signal.content,
        timestamp: Date.now(),
      };
      this.state.appendMessage(assistantMsg);
      this.options.onText?.(signal.content);

      turnsUsed++;

      // [evaluating_completion]
      this.transition("evaluating_completion");

      if (!contract || contract.conditions.length === 0) {
        // No contract — single text response is considered complete
        this.transition("idle");
        return this.buildResult({
          done: true,
          satisfiedConditionIds: new Set(allConditionIds),
          allConditionIds,
          artifacts,
          turnsUsed,
          startMs,
          summary: signal.content,
        });
      }

      // Evaluate each unsatisfied condition
      for (const condition of contract.conditions) {
        if (satisfiedConditionIds.has(condition.id)) {
          continue;
        }

        let satisfied = false;

        if (condition.check === "assertion" && condition.assertionFn) {
          try {
            satisfied = Boolean(await condition.assertionFn());
          } catch {
            // Assertion threw — not satisfied
          }
        } else if (condition.check === "manual") {
          // Manual conditions are never auto-satisfied by the runtime
          satisfied = false;
        }
        // "artifact" conditions are evaluated externally and injected via satisfyCondition()

        if (satisfied) {
          satisfiedConditionIds.add(condition.id);
        }
      }

      const allSatisfied = allConditionIds.every((id) => satisfiedConditionIds.has(id));

      if (allSatisfied) {
        this.transition("idle");
        const result = this.buildResult({
          done: true,
          satisfiedConditionIds,
          allConditionIds,
          artifacts,
          turnsUsed,
          startMs,
          summary: signal.content,
        });
        this.options.onComplete?.(result);
        return result;
      }

      // Conditions remain and we have turns left — loop back
      // Loop back to assembling_context with accumulated context
    }
  }

  /**
   * Externally mark an artifact-type condition as satisfied.
   * Called by the CLI when it detects that an artifact file was created.
   */
  satisfyCondition(conditionId: string, artifactPath?: string): void {
    this.satisfiedConditionIds.add(conditionId);
    if (artifactPath) {
      this.artifacts.push(artifactPath);
    }
  }

  private transition(phase: RuntimePhase): void {
    this.state.setPhase(phase);
    this.options.onPhaseChange?.(phase);
  }

  private async callLLMWithRetry(
    messages: Message[],
    options: CompletionOptions
  ): Promise<CompletionSignal> {
    let lastSignal: CompletionSignal | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const signal = await this.options.adapter.complete(messages, options);

      if (signal.type !== "error" || !signal.retryable) {
        return signal;
      }

      lastSignal = signal;

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        break;
      }

      await sleep(delay);
    }

    // All retries exhausted
    return lastSignal ?? {
      type: "error",
      code: "unknown",
      message: "Unknown error after retries",
      retryable: false,
    };
  }

  private isToolAllowed(toolName: string, allowedTools: string[]): boolean {
    if (allowedTools.includes("*")) {
      return true;
    }
    return allowedTools.includes(toolName);
  }

  private buildResult(params: {
    done: boolean;
    satisfiedConditionIds: Set<string>;
    allConditionIds: string[];
    artifacts: string[];
    turnsUsed: number;
    startMs: number;
    summary: string;
  }): CompletionResult {
    const unsatisfied = params.allConditionIds.filter(
      (id) => !params.satisfiedConditionIds.has(id)
    );

    return {
      done: params.done,
      satisfiedConditions: [...params.satisfiedConditionIds],
      unsatisfiedConditions: unsatisfied,
      summary: params.summary,
      artifacts: params.artifacts,
      turnsUsed: params.turnsUsed,
      durationMs: Date.now() - params.startMs,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
