import type { FrameworkConfig } from "./define-framework.js";
import { FrameworkLoader, startREPL } from "./loader/framework-loader.js";

export interface CLIInstance {
  /**
   * Start the interactive REPL session.
   * Loads all skills, agents, and the LLM adapter, then enters the REPL loop.
   */
  start(projectRoot?: string): Promise<void>;
}

/**
 * createCLI() creates a runnable CLI instance from a FrameworkConfig.
 * This is the entry point for framework consumers who want to programmatically
 * embed the CLI rather than use the bin script.
 *
 * @example
 * import { defineFramework, createCLI } from "@the-agent/cli";
 *
 * const config = defineFramework({ ... });
 * const cli = createCLI(config);
 * await cli.start();
 */
export function createCLI(config: FrameworkConfig): CLIInstance {
  return {
    async start(projectRoot: string = process.cwd()): Promise<void> {
      const loader = new FrameworkLoader(config, projectRoot);
      const framework = await loader.load();
      await startREPL(framework);
    },
  };
}
