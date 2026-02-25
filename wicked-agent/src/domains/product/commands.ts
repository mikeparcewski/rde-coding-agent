/**
 * Product domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import {
  elicitRequirementsTool,
  uxReviewTool,
  acceptanceCriteriaTool,
} from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /elicit <feature idea> [personas=user,admin] [constraints=<text>]
  pi.registerCommand("elicit", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage("warn", "Usage: /elicit <feature idea> [personas=user,admin] [constraints=<text>]");
      return;
    }

    const personasMatch = args.match(/personas=([^\s]+)/i);
    const constraintsMatch = args.match(/constraints=(.+?)(?=\s+\w+=|$)/i);

    const personas = personasMatch
      ? personasMatch[1].split(",").map((p) => p.trim())
      : undefined;
    const constraints = constraintsMatch ? constraintsMatch[1].trim() : undefined;

    const feature_idea = args
      .replace(/personas=\S+/i, "")
      .replace(/constraints=.+?(?=\s+\w+=|$)/i, "")
      .trim();

    const result = await elicitRequirementsTool.execute(
      "cmd-elicit",
      { feature_idea, personas, constraints },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /ux-review <file> [focus=accessibility|usability|performance|all]
  pi.registerCommand("ux-review", async (args, ctx) => {
    const focusMatch = args.match(/focus=(\S+)/i);
    const focus = (focusMatch?.[1] ?? "all") as "accessibility" | "usability" | "performance" | "all";
    const rawFile = args.replace(/focus=\S+/i, "").trim();

    if (!rawFile) {
      ctx.ui.showMessage("warn", "Usage: /ux-review <file> [focus=accessibility|usability|performance|all]");
      return;
    }

    const file = rawFile.startsWith("/") ? rawFile : join(ctx.session.cwd, rawFile);
    const result = await uxReviewTool.execute(
      "cmd-ux-review",
      { file, focus },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /ac <user story>
  pi.registerCommand("ac", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage("warn", "Usage: /ac <user story>");
      return;
    }
    const result = await acceptanceCriteriaTool.execute(
      "cmd-ac",
      { user_story: args.trim() },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
