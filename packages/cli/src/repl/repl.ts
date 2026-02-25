import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import type { LLMAdapter, AgentConfig, Tool } from "@the-agent/core";
import { RuntimeLoop } from "@the-agent/core";
import type { AgentRegistry } from "@the-agent/agents";
import type { SkillRegistry } from "@the-agent/skills";
import { SlashCommandDispatcher } from "../dispatch/slash-command-dispatcher.js";
import { OutputFormatter } from "./output-formatter.js";
import { resolveAlias, emitDeprecationNotice } from "../compat/aliases.js";

export interface REPLOptions {
  adapter: LLMAdapter;
  agentRegistry: AgentRegistry;
  skillRegistry: SkillRegistry;
  defaultAgentId?: string;
  compatMode?: boolean;
  color?: boolean;
}

/**
 * REPL implements the readline-based interactive session.
 *
 * Turn loop:
 *   1. Read user input
 *   2. Resolve slash commands or compat aliases
 *   3. Route to appropriate agent
 *   4. Run RuntimeLoop turn
 *   5. Stream output to terminal
 */
export class REPL {
  private readonly options: REPLOptions;
  private readonly formatter: OutputFormatter;
  private readonly dispatcher: SlashCommandDispatcher;
  private rl: readline.Interface | null = null;
  private currentAgent: AgentConfig | null = null;
  private loop: RuntimeLoop | null = null;
  private processing = false;

  constructor(options: REPLOptions) {
    this.options = options;
    this.formatter = new OutputFormatter(
      options.color !== undefined ? { color: options.color } : {}
    );
    this.dispatcher = new SlashCommandDispatcher(options.skillRegistry);
  }

  /**
   * Start the interactive REPL session.
   * Resolves when the user exits (Ctrl+C or /exit).
   */
  async start(): Promise<void> {
    // Resolve default agent
    this.currentAgent = this.resolveDefaultAgent();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    this.formatter.info(
      `the-agent v0.1.0 — type /help for commands, Ctrl+C to exit`
    );

    if (this.currentAgent) {
      this.formatter.info(`Agent: ${this.currentAgent.name}`);
    }

    this.formatter.separator();

    await this.runLoop();
  }

  private resolveDefaultAgent(): AgentConfig | null {
    const { defaultAgentId, agentRegistry } = this.options;

    if (defaultAgentId) {
      const agent = agentRegistry.get(defaultAgentId);
      if (agent) return agent;
      this.formatter.warn(
        `Default agent "${defaultAgentId}" not found. Falling back to first available.`
      );
    }

    const agents = agentRegistry.list();
    return agents[0] ?? null;
  }

  private buildToolMap(): Map<string, Tool> {
    const tools = new Map<string, Tool>();
    for (const skill of this.options.skillRegistry.list()) {
      if (skill.tool) {
        tools.set(skill.tool.name, skill.tool);
      }
    }
    return tools;
  }

  private async runLoop(): Promise<void> {
    const rl = this.rl;
    if (!rl) return;

    const sessionId = randomUUID();

    return new Promise((resolve) => {
      const promptUser = () => {
        const agentName = this.currentAgent?.name ?? "agent";
        this.formatter.prompt(agentName);
      };

      rl.on("line", async (line: string) => {
        const input = line.trim();

        if (!input) {
          promptUser();
          return;
        }

        // Concurrency guard — prevent overlapping turns
        if (this.processing) {
          this.formatter.warn("Still processing. Please wait.");
          return;
        }
        this.processing = true;

        try {
          // Handle built-in meta commands
          if (input === "/exit" || input === "/quit") {
            this.formatter.info("Goodbye.");
            rl.close();
            resolve();
            return;
          }

          if (input === "/help") {
            process.stdout.write(this.dispatcher.help() + "\n");
            promptUser();
            return;
          }

          if (input === "/agents") {
            const agents = this.options.agentRegistry.list();
            for (const a of agents) {
              process.stdout.write(`  ${a.id.padEnd(20)} ${a.name}\n`);
            }
            promptUser();
            return;
          }

          if (input.startsWith("/use ")) {
            const agentId = input.slice(5).trim();
            const agent = this.options.agentRegistry.get(agentId);
            if (agent) {
              this.currentAgent = agent;
              this.loop = null;  // Reset loop for new agent context
              this.formatter.info(`Switched to agent: ${agent.name}`);
            } else {
              this.formatter.error(`Agent "${agentId}" not found.`);
            }
            promptUser();
            return;
          }

          // Resolve compat aliases
          let resolvedInput = input;
          if (this.options.compatMode && input.startsWith("/")) {
            const aliasResult = resolveAlias(input);
            if (aliasResult) {
              emitDeprecationNotice();
              this.formatter.narration(
                `Alias: ${aliasResult.original} → ${aliasResult.capability}`
              );
              resolvedInput = aliasResult.capability;
            }
          }

          // Handle slash commands (non-alias)
          if (resolvedInput.startsWith("/")) {
            const dispatchResult = this.dispatcher.dispatch(resolvedInput);
            if (!dispatchResult.ok) {
              this.formatter.error(dispatchResult.error.message);
              promptUser();
              return;
            }

            // Execute the skill's tool handler directly
            const { skill, args } = dispatchResult.result;
            if (skill.tool) {
              try {
                const result = await skill.tool.handler(args);
                const output = result as { prompt?: string; error?: string } | null;
                if (output && typeof output === "object" && "prompt" in output && typeof output.prompt === "string") {
                  // Markdown-only skill — send interpolated prompt to LLM
                  resolvedInput = output.prompt;
                } else {
                  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
                  promptUser();
                  return;
                }
              } catch (err) {
                this.formatter.error(
                  `Skill error: ${err instanceof Error ? err.message : String(err)}`
                );
                promptUser();
                return;
              }
            } else {
              this.formatter.warn(`Skill "${skill.frontmatter.name}" has no compiled tool.`);
              promptUser();
              return;
            }
          }

          // Send to current agent via RuntimeLoop (persisted per session)
          if (!this.currentAgent) {
            this.formatter.error(
              "No agent configured. Add agent markdown files to your agents/ directory."
            );
            promptUser();
            return;
          }

          // Create or reuse RuntimeLoop for conversation continuity
          if (!this.loop) {
            const tools = this.buildToolMap();
            this.loop = new RuntimeLoop(sessionId, {
              adapter: this.options.adapter,
              agentConfig: this.currentAgent,
              tools,
              onText: (text: string) => {
                this.formatter.delta(text);
              },
              onPhaseChange: () => {
                // Could add debug logging here
              },
            });
          }

          try {
            await this.loop.run(resolvedInput);
            this.formatter.endStream();
          } catch (err) {
            this.formatter.error(
              err instanceof Error ? err.message : String(err)
            );
          }

          promptUser();
        } finally {
          this.processing = false;
        }
      });

      rl.on("close", () => {
        resolve();
      });

      rl.on("SIGINT", () => {
        process.stdout.write("\n");
        this.formatter.info("Interrupted. Use /exit to quit.");
        promptUser();
      });

      // Initial prompt
      promptUser();
    });
  }

  /**
   * Gracefully close the REPL.
   */
  close(): void {
    this.rl?.close();
  }
}
