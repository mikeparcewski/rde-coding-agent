/**
 * Agentic domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import { agentReviewTool, safetyAuditTool, patternCheckTool } from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /agent-review [directory] [files=file1,file2]
  pi.registerCommand("agent-review", async (args, ctx) => {
    const filesMatch = args.match(/files=(\S+)/i);
    const rawDir = args.replace(/files=\S+/i, "").trim();

    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const files = filesMatch
      ? filesMatch[1].split(",").map((f) => (f.startsWith("/") ? f : join(ctx.session.cwd, f)))
      : undefined;

    const result = await agentReviewTool.execute(
      "cmd-agent-review",
      { directory, files },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /safety [directory] [no-prompts]
  pi.registerCommand("safety", async (args, ctx) => {
    const noPrompts = /no-prompts/.test(args);
    const rawDir = args.replace(/no-prompts/i, "").trim();

    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await safetyAuditTool.execute(
      "cmd-safety",
      { directory, check_prompts: !noPrompts },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /patterns [directory]
  pi.registerCommand("patterns", async (args, ctx) => {
    const rawDir = args.trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await patternCheckTool.execute(
      "cmd-patterns",
      { directory },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
