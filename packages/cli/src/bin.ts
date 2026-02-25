import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { FrameworkLoader, startREPL } from "./loader/framework-loader.js";
import { runValidate, printValidationReport } from "./commands/validate.js";
import type { FrameworkConfig } from "./define-framework.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectRoot = process.cwd();

  // Handle subcommands
  if (args[0] === "validate") {
    const verbose = args.includes("--verbose") || args.includes("-v");
    const report = await runValidate({ projectRoot, verbose });
    const exitCode = printValidationReport(report, verbose);
    process.exit(exitCode);
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
    return;
  }

  if (args[0] === "--version" || args[0] === "-V") {
    console.log("0.1.0");
    process.exit(0);
    return;
  }

  // Load framework config from agent.config.ts / agent.config.js
  const config = await loadConfig(projectRoot);

  if (!config) {
    console.error(
      "[the-agent] No agent.config.ts found in current directory.\n" +
        "Create one with defineFramework() to get started.\n\n" +
        "Example:\n" +
        "  import { defineFramework } from '@the-agent/cli';\n" +
        "  export default defineFramework({ llm: { provider: 'anthropic', ... } });"
    );
    process.exit(1);
    return;
  }

  // Load the framework (skills, agents, adapter)
  const loader = new FrameworkLoader(config, projectRoot);
  const framework = await loader.load();

  // Start the REPL
  await startREPL(framework);
}

async function loadConfig(projectRoot: string): Promise<FrameworkConfig | undefined> {
  const candidates = [
    resolve(projectRoot, "agent.config.ts"),
    resolve(projectRoot, "agent.config.js"),
    resolve(projectRoot, "agent.config.mjs"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      const mod = await import(candidate) as { default?: FrameworkConfig };
      if (mod.default) {
        return mod.default;
      }
    } catch {
      // Not found or failed to load — try next
    }
  }

  return undefined;
}

function printHelp(): void {
  console.log(`
the-agent — CLI-native AI agent framework

Usage:
  the-agent              Start interactive REPL
  the-agent validate     Validate all configuration (no LLM calls)
  the-agent --help       Show this help
  the-agent --version    Show version

Configuration:
  Place agent.config.ts in your project root:
    import { defineFramework } from '@the-agent/cli';
    export default defineFramework({ ... });

  Optional team config at .agent/config.yaml for overrides.

In the REPL:
  /help            List available skill commands
  /agents          List available agents
  /use <id>        Switch to a different agent
  /exit            Exit the REPL
  <command> ...    Run a registered skill command
  <text>           Send a message to the current agent
`);
}

main().catch((err: unknown) => {
  console.error(
    "[the-agent] Fatal error:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
