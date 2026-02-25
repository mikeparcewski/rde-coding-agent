/**
 * Delivery domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import { experimentDesignTool, riskAssessTool, progressReportTool } from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

function extractKv(args: string, key: string): string | undefined {
  const m = args.match(new RegExp(`${key}=([^\\s]+)`, "i"));
  return m?.[1];
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /experiment <feature> -- <hypothesis> primary=<metric> [baseline=0.05] [mde=0.05] [traffic=1000]
  pi.registerCommand("experiment", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage(
        "warn",
        "Usage: /experiment <feature> -- <hypothesis> primary=<metric> [baseline=0.05] [mde=0.05] [traffic=1000]",
      );
      return;
    }

    const parts = args.split(/\s+--\s+/);
    const feature = parts[0].trim();
    const rest = parts[1] ?? args;

    const primary_metric = extractKv(rest, "primary") ?? "conversion rate";
    const baselineStr = extractKv(rest, "baseline");
    const mdeStr = extractKv(rest, "mde");
    const trafficStr = extractKv(rest, "traffic");

    const hypothesis = rest
      .replace(/\w+=\S+/g, "")
      .trim() || `${feature} improves ${primary_metric}`;

    const result = await experimentDesignTool.execute(
      "cmd-experiment",
      {
        feature,
        hypothesis,
        primary_metric,
        baseline_rate: baselineStr ? parseFloat(baselineStr) : undefined,
        minimum_detectable_effect: mdeStr ? parseFloat(mdeStr) : 0.05,
        daily_traffic: trafficStr ? parseInt(trafficStr, 10) : undefined,
      },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /risk [directory]
  pi.registerCommand("risk", async (args, ctx) => {
    const rawDir = args.trim();
    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await riskAssessTool.execute(
      "cmd-risk",
      { directory },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /progress [directory] [days=7] [author=<name>]
  pi.registerCommand("progress", async (args, ctx) => {
    const daysStr = extractKv(args, "days");
    const author = extractKv(args, "author");
    const rawDir = args.replace(/days=\S+/i, "").replace(/author=\S+/i, "").trim();

    const directory = rawDir
      ? rawDir.startsWith("/")
        ? rawDir
        : join(ctx.session.cwd, rawDir)
      : ctx.session.cwd;

    const result = await progressReportTool.execute(
      "cmd-progress",
      {
        directory,
        days: daysStr ? parseInt(daysStr, 10) : 7,
        author,
      },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
