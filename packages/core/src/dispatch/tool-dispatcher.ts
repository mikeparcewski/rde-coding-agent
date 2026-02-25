import type { Tool, ToolCall, ToolResult } from "../interfaces/tool.js";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/**
 * ToolDispatcher executes tool calls in parallel, enforcing the agent's
 * allowedTools list and per-tool timeouts.
 *
 * Design decisions:
 * - All tool calls within a single LLM turn are dispatched simultaneously
 *   via Promise.all() to minimize latency.
 * - Each handler is wrapped in Promise.race with an AbortController-aware
 *   timeout. On timeout the error is captured in ToolResult.error rather than
 *   propagating, so the session continues.
 * - A tool not in allowedTools produces a ToolResult with error="not_allowed"
 *   and is never invoked.
 * - A tool not found in the registry produces ToolResult with error="not_found".
 */
export class ToolDispatcher {
  async dispatch(
    calls: ToolCall[],
    registry: Map<string, Tool>,
    allowedTools: string[]
  ): Promise<ToolResult[]> {
    const tasks = calls.map((call) =>
      this.executeOne(call, registry, allowedTools)
    );
    return Promise.all(tasks);
  }

  private async executeOne(
    call: ToolCall,
    registry: Map<string, Tool>,
    allowedTools: string[]
  ): Promise<ToolResult> {
    const startMs = Date.now();

    // Enforce allowedTools before any invocation
    if (!this.isAllowed(call.name, allowedTools)) {
      return {
        toolCallId: call.id,
        name: call.name,
        output: null,
        error: `Tool '${call.name}' is not in the agent's allowedTools list.`,
        durationMs: Date.now() - startMs,
      };
    }

    const tool = registry.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        output: null,
        error: `Tool '${call.name}' is not registered.`,
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const output = await this.withTimeout(
        tool.handler(call.arguments),
        DEFAULT_TOOL_TIMEOUT_MS,
        call.name
      );

      return {
        toolCallId: call.id,
        name: call.name,
        output,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: call.id,
        name: call.name,
        output: null,
        error: message,
        durationMs: Date.now() - startMs,
      };
    }
  }

  /**
   * Races the handler promise against a timeout.
   * On timeout, resolves to a ToolResult with an error string rather than
   * throwing, so the outer catch produces a well-formed error result.
   */
  private withTimeout(
    promise: Promise<unknown>,
    timeoutMs: number,
    toolName: string
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Tool '${toolName}' timed out after ${timeoutMs}ms.`
          )
        );
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private isAllowed(toolName: string, allowedTools: string[]): boolean {
    if (allowedTools.includes("*")) {
      return true;
    }
    return allowedTools.includes(toolName);
  }
}
