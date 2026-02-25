/**
 * Scenarios domain slash commands: /scenario
 */

import { readFile } from "node:fs/promises";
import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import { parseScenario } from "./parser.js";

export function registerScenariosCommands(pi: PiExtensionAPI): void {
  // /scenario run <path> — parse and run a scenario
  pi.registerCommand(
    "/scenario",
    async (args: string, ctx: PiCommandContext) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] ?? "";
      const path = parts[1] ?? "";

      if (subcommand !== "run" || !path) {
        ctx.ui.showMessage(
          "warn",
          "Usage: /scenario run <path/to/scenario.md>",
        );
        return;
      }

      // Path safety
      if (path.startsWith("/") || path.startsWith("~") || path.includes("..")) {
        ctx.ui.showMessage(
          "error",
          `Unsafe path: "${path}". Use a relative path.`,
        );
        return;
      }

      ctx.ui.showMessage("info", `Parsing scenario: ${path}`);

      try {
        const content = await readFile(path, "utf-8");
        const scenario = parseScenario(content);

        const stepCount =
          scenario.setup.length +
          scenario.steps.length +
          scenario.expected.length +
          scenario.teardown.length;

        const lines = [
          `Scenario: ${scenario.title}`,
          `Steps: ${stepCount} (${scenario.setup.length} setup, ${scenario.steps.length} steps, ${scenario.expected.length} expected, ${scenario.teardown.length} teardown)`,
          "",
          ...scenario.steps.map(
            (s) => `  ${s.index}. ${s.text}`,
          ),
        ];

        if (scenario.expected.length > 0) {
          lines.push("", "Expected:");
          lines.push(
            ...scenario.expected.map((s) => `  - ${s.text}`),
          );
        }

        ctx.ui.showMessage("info", lines.join("\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.showMessage("error", `Failed to parse scenario: ${message}`);
      }
    },
  );
}
