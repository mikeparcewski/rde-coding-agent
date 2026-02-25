/**
 * QE domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import {
  testStrategyTool,
  generateScenariosTool,
  testAutomationTool,
} from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /test-strategy [directory] [context=<text>]
  pi.registerCommand("test-strategy", async (args, ctx) => {
    const kvRe = /context=([^\s]+(?:\s+[^=\s][^\s]*)*)/i;
    const kvMatch = args.match(kvRe);
    const context = kvMatch ? kvMatch[1] : undefined;
    const rawDir = args.replace(kvRe, "").trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await testStrategyTool.execute(
      "cmd-test-strategy",
      { directory, context },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /scenarios <feature name> -- <description> [criteria: <ac1>; <ac2>]
  pi.registerCommand("scenarios", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage(
        "warn",
        'Usage: /scenarios <feature> -- <description> [actor=<actor>] [criteria=<ac1>;<ac2>]',
      );
      return;
    }

    // Split on " -- " to separate feature from description
    const parts = args.split(/\s+--\s+/);
    const feature = parts[0].trim();
    const rest = parts[1] ?? "";

    // Extract criteria
    const criteriaMatch = rest.match(/criteria=([^[\]]+?)(?:\s+\w+=|$)/i);
    const criteriaRaw = criteriaMatch ? criteriaMatch[1] : undefined;
    const acceptance_criteria = criteriaRaw
      ? criteriaRaw.split(";").map((s) => s.trim()).filter(Boolean)
      : [];

    // Extract actor
    const actorMatch = args.match(/actor=(\S+)/i);
    const actor = actorMatch ? actorMatch[1] : "user";

    const description = rest
      .replace(/criteria=\S+/i, "")
      .replace(/actor=\S+/i, "")
      .trim() || feature;

    const result = await generateScenariosTool.execute(
      "cmd-scenarios",
      { feature, description, actor, acceptance_criteria },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /automate <scenario text> [framework=vitest|jest|pytest|mocha] [file=<subject>]
  pi.registerCommand("automate", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage(
        "warn",
        "Usage: /automate <scenario> [framework=vitest] [file=<subject path>]",
      );
      return;
    }

    const frameworkMatch = args.match(/framework=(\S+)/i);
    const fileMatch = args.match(/file=(\S+)/i);

    const framework = (frameworkMatch?.[1] ?? "vitest") as
      | "vitest"
      | "jest"
      | "pytest"
      | "mocha";
    const subjectFile = fileMatch?.[1];
    const subjectFilePath = subjectFile
      ? subjectFile.startsWith("/")
        ? subjectFile
        : join(ctx.session.cwd, subjectFile)
      : undefined;

    const scenario = args
      .replace(/framework=\S+/i, "")
      .replace(/file=\S+/i, "")
      .trim();

    const result = await testAutomationTool.execute(
      "cmd-automate",
      { scenario, framework, subject_file: subjectFilePath },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
