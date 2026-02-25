import type { SkillConfig } from "@the-agent/core";
import type { SkillRegistry } from "@the-agent/skills";

export interface DispatchResult {
  skill: SkillConfig;
  args: Record<string, unknown>;
}

export interface DispatchError {
  code: "not_found" | "parse_error";
  message: string;
  input: string;
}

/**
 * SlashCommandDispatcher maps /command inputs to SkillRegistry entries.
 *
 * Input format:
 *   /summarize text="Hello world" length="short"
 *   /commit
 *   /review --file=src/index.ts
 *
 * Parsing strategy:
 *   - First token is the command name (must start with /)
 *   - Remaining tokens are key=value pairs (quoted values supported)
 *   - Positional args are mapped to the first parameter by name
 */
export class SlashCommandDispatcher {
  private readonly registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  /**
   * Dispatch a /command input string.
   * Returns a DispatchResult on success, or a DispatchError.
   */
  dispatch(
    input: string
  ): { ok: true; result: DispatchResult } | { ok: false; error: DispatchError } {
    const trimmed = input.trim();

    if (!trimmed.startsWith("/")) {
      return {
        ok: false,
        error: {
          code: "parse_error",
          message: "Slash commands must start with /",
          input: trimmed,
        },
      };
    }

    const tokens = this.tokenize(trimmed);
    if (tokens.length === 0) {
      return {
        ok: false,
        error: {
          code: "parse_error",
          message: "Empty command",
          input: trimmed,
        },
      };
    }

    const commandName = tokens[0] as string;
    const skill = this.registry.get(commandName);

    if (!skill) {
      // Try to find by partial match (e.g., "/sum" -> "/summarize")
      const allSkills = this.registry.list();
      const partial = allSkills.find((s) =>
        s.frontmatter.name.startsWith(commandName)
      );

      if (partial) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message: `Unknown command "${commandName}". Did you mean "${partial.frontmatter.name}"?`,
            input: trimmed,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Unknown command "${commandName}". Use /help to list available commands.`,
          input: trimmed,
        },
      };
    }

    // Parse key=value args from remaining tokens
    const args = this.parseArgs(tokens.slice(1));

    return { ok: true, result: { skill, args } };
  }

  /**
   * Returns a formatted help string listing all available commands.
   */
  help(): string {
    const skills = this.registry.list();
    if (skills.length === 0) {
      return "No skills registered.";
    }

    const lines = ["Available commands:", ""];
    for (const skill of skills) {
      lines.push(
        `  ${skill.frontmatter.name.padEnd(20)} ${skill.frontmatter.description}`
      );
    }
    return lines.join("\n");
  }

  /**
   * Tokenizes a command string respecting quoted values.
   * Example: /summarize text="hello world" -> ["/summarize", 'text="hello world"']
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (const char of input) {
      if (inQuotes) {
        current += char;
        if (char === quoteChar) {
          inQuotes = false;
        }
      } else if (char === '"' || char === "'") {
        current += char;
        inQuotes = true;
        quoteChar = char;
      } else if (char === " " || char === "\t") {
        if (current) {
          tokens.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Parses key=value tokens into a record.
   * Supports: key=value, key="value with spaces", --key=value, -key=value
   */
  private parseArgs(tokens: string[]): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    for (const token of tokens) {
      // Strip leading -- or -
      const cleaned = token.replace(/^--?/, "");
      const eqIdx = cleaned.indexOf("=");

      if (eqIdx === -1) {
        // Boolean flag
        args[cleaned] = true;
        continue;
      }

      const key = cleaned.slice(0, eqIdx);
      let value: string = cleaned.slice(eqIdx + 1);

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Try to coerce to number or boolean
      if (value === "true") {
        args[key] = true;
      } else if (value === "false") {
        args[key] = false;
      } else if (!isNaN(Number(value)) && value !== "") {
        args[key] = Number(value);
      } else {
        args[key] = value;
      }
    }

    return args;
  }
}
