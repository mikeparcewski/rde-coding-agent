/**
 * Engineering domain slash commands.
 *
 * Delegates to the registered tools via direct tool execution.
 */

import { join } from "node:path";
import type {
  PiExtensionAPI,
  PiCommandContext,
  PiToolResult,
} from "../../types.js";
import {
  codeReviewTool,
  debugAnalyzeTool,
  architectureReviewTool,
  generateDocsTool,
} from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

function parseArgs(args: string): Record<string, string> {
  // Simple key=value parser; fallback to positional "path"
  const out: Record<string, string> = {};
  const kvRe = /(\w[\w-]*)=([^\s]+)/g;
  let m;
  const remaining = args.replace(kvRe, (whole, k, v) => {
    out[k] = v;
    return "";
  }).trim();
  if (remaining) out["_"] = remaining;
  return out;
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /review [file1 file2 ...] [focus=security]
  pi.registerCommand("review", async (args, ctx) => {
    const parsed = parseArgs(args);
    const rawFiles = parsed["_"] ?? "";
    const files = rawFiles
      .split(/\s+/)
      .filter(Boolean)
      .map((f) => (f.startsWith("/") ? f : join(ctx.session.cwd, f)));

    if (files.length === 0) {
      ctx.ui.showMessage("warn", "Usage: /review <file1> [file2 ...] [focus=<area>]");
      return;
    }

    const result = await codeReviewTool.execute(
      "cmd-review",
      { files, focus: parsed["focus"] },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /debug <error message> [stack=<file>] [file=<source>]
  pi.registerCommand("debug", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage("warn", "Usage: /debug <error message> [files=file1,file2]");
      return;
    }
    const parsed = parseArgs(args);
    const errorMessage = parsed["_"] ?? args.trim();
    const files = parsed["files"]
      ? parsed["files"].split(",").map((f) => (f.startsWith("/") ? f : join(ctx.session.cwd, f)))
      : undefined;

    const result = await debugAnalyzeTool.execute(
      "cmd-debug",
      { error_message: errorMessage, files },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /arch [directory] [depth=4]
  pi.registerCommand("arch", async (args, ctx) => {
    const parsed = parseArgs(args);
    const directory = parsed["_"]
      ? parsed["_"].startsWith("/")
        ? parsed["_"]
        : join(ctx.session.cwd, parsed["_"])
      : ctx.session.cwd;

    const maxDepth = parsed["depth"] ? parseInt(parsed["depth"], 10) : 4;

    const result = await architectureReviewTool.execute(
      "cmd-arch",
      { directory, max_depth: maxDepth },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /docs <file> [format=tsdoc|jsdoc]
  pi.registerCommand("docs", async (args, ctx) => {
    const parsed = parseArgs(args);
    const rawFile = parsed["_"] ?? "";
    if (!rawFile) {
      ctx.ui.showMessage("warn", "Usage: /docs <file> [format=tsdoc|jsdoc]");
      return;
    }
    const file = rawFile.startsWith("/") ? rawFile : join(ctx.session.cwd, rawFile);
    const format = (parsed["format"] ?? "tsdoc") as "tsdoc" | "jsdoc";

    const result = await generateDocsTool.execute(
      "cmd-docs",
      { file, format },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
