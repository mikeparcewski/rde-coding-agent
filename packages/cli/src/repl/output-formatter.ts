import type { ToolResult } from "@the-agent/core";

/**
 * OutputFormatter handles all terminal output for the REPL.
 * It normalizes LLM text, tool results, errors, and routing narrations
 * into readable console output.
 */
export class OutputFormatter {
  private readonly useColor: boolean;

  constructor(options: { color?: boolean } = {}) {
    this.useColor = options.color ?? process.stdout.isTTY;
  }

  /**
   * Print the routing narration line shown before agent execution.
   * Example: "Treating this as code-review using Senior Engineer. Starting."
   */
  narration(text: string): void {
    if (this.useColor) {
      process.stdout.write(`\x1b[36m${text}\x1b[0m\n`);
    } else {
      process.stdout.write(`${text}\n`);
    }
  }

  /**
   * Write a streaming delta character-by-character without newline.
   */
  delta(text: string): void {
    process.stdout.write(text);
  }

  /**
   * Finalize the output after streaming (add trailing newline if needed).
   */
  endStream(): void {
    process.stdout.write("\n");
  }

  /**
   * Print a complete assistant message (non-streaming).
   */
  assistantMessage(content: string): void {
    process.stdout.write(`${content}\n`);
  }

  /**
   * Print a tool call notification.
   */
  toolCall(name: string, args: Record<string, unknown>): void {
    if (this.useColor) {
      process.stdout.write(
        `\x1b[33m[tool] ${name}(${JSON.stringify(args)})\x1b[0m\n`
      );
    } else {
      process.stdout.write(`[tool] ${name}(${JSON.stringify(args)})\n`);
    }
  }

  /**
   * Print a tool result.
   */
  toolResult(result: ToolResult): void {
    if (result.error) {
      if (this.useColor) {
        process.stdout.write(
          `\x1b[31m[tool error] ${result.name}: ${result.error}\x1b[0m\n`
        );
      } else {
        process.stdout.write(`[tool error] ${result.name}: ${result.error}\n`);
      }
    } else {
      if (this.useColor) {
        process.stdout.write(
          `\x1b[32m[tool ok] ${result.name} (${result.durationMs}ms)\x1b[0m\n`
        );
      } else {
        process.stdout.write(
          `[tool ok] ${result.name} (${result.durationMs}ms)\n`
        );
      }
    }
  }

  /**
   * Print an error message.
   */
  error(message: string): void {
    if (this.useColor) {
      process.stderr.write(`\x1b[31m[error] ${message}\x1b[0m\n`);
    } else {
      process.stderr.write(`[error] ${message}\n`);
    }
  }

  /**
   * Print a warning.
   */
  warn(message: string): void {
    if (this.useColor) {
      process.stderr.write(`\x1b[33m[warn] ${message}\x1b[0m\n`);
    } else {
      process.stderr.write(`[warn] ${message}\n`);
    }
  }

  /**
   * Print an info/status message.
   */
  info(message: string): void {
    if (this.useColor) {
      process.stdout.write(`\x1b[90m${message}\x1b[0m\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  }

  /**
   * Print the REPL prompt.
   */
  prompt(agentName: string): void {
    process.stdout.write(
      this.useColor ? `\x1b[32m${agentName}> \x1b[0m` : `${agentName}> `
    );
  }

  /**
   * Print a section separator.
   */
  separator(): void {
    process.stdout.write("─".repeat(60) + "\n");
  }
}
