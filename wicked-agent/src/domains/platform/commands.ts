/**
 * Platform domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import { securityScanTool, complianceCheckTool, ciCdReviewTool } from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /security [directory]
  pi.registerCommand("security", async (args, ctx) => {
    const rawDir = args.trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    ctx.ui.showMessage("info", `Running security scan on \`${directory}\`...`);

    const result = await securityScanTool.execute(
      "cmd-security",
      { directory },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /compliance [directory]
  pi.registerCommand("compliance", async (args, ctx) => {
    const rawDir = args.trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await complianceCheckTool.execute(
      "cmd-compliance",
      { directory },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /ci-review [directory]
  pi.registerCommand("ci-review", async (args, ctx) => {
    const rawDir = args.trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await ciCdReviewTool.execute(
      "cmd-ci-review",
      { directory },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
