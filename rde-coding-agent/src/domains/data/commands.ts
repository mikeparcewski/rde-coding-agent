/**
 * Data domain slash commands.
 */

import { join } from "node:path";
import type { PiExtensionAPI, PiCommandContext, PiToolResult } from "../../types.js";
import { analyzeDatasetTool, pipelineReviewTool, mlGuidanceTool } from "./tools.js";

function printResult(result: PiToolResult, ctx: PiCommandContext): void {
  for (const block of result.content) {
    ctx.ui.showMessage("info", block.text);
  }
}

export function registerCommands(pi: PiExtensionAPI): void {
  // /analyze <csv-file> [delimiter=,] [max_rows=10000]
  pi.registerCommand("analyze", async (args, ctx) => {
    const delimMatch = args.match(/delimiter=(\S+)/i);
    const rowsMatch = args.match(/max_rows=(\d+)/i);
    const rawFile = args.replace(/delimiter=\S+/i, "").replace(/max_rows=\d+/i, "").trim();

    if (!rawFile) {
      ctx.ui.showMessage("warn", "Usage: /analyze <csv-file> [delimiter=,] [max_rows=10000]");
      return;
    }

    const file = rawFile.startsWith("/") ? rawFile : join(ctx.session.cwd, rawFile);
    const delimiter = delimMatch?.[1] ?? ",";
    const max_rows = rowsMatch ? parseInt(rowsMatch[1], 10) : 10000;

    const result = await analyzeDatasetTool.execute(
      "cmd-analyze",
      { file, delimiter, max_rows },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /pipeline <file> [type=airflow|dbt|spark|generic]
  pi.registerCommand("pipeline", async (args, ctx) => {
    const typeMatch = args.match(/type=(\S+)/i);
    const rawFile = args.replace(/type=\S+/i, "").trim();

    if (!rawFile) {
      ctx.ui.showMessage("warn", "Usage: /pipeline <file> [type=airflow|dbt|spark|generic]");
      return;
    }

    const file = rawFile.startsWith("/") ? rawFile : join(ctx.session.cwd, rawFile);
    const pipeline_type = (typeMatch?.[1] ?? "generic") as "airflow" | "dbt" | "spark" | "generic";

    const result = await pipelineReviewTool.execute(
      "cmd-pipeline",
      { file, pipeline_type },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });

  // /ml <problem description> [data=<description>] [constraints=<text>]
  pi.registerCommand("ml", async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui.showMessage("warn", "Usage: /ml <problem description> [data=<description>] [constraints=<text>]");
      return;
    }

    const dataMatch = args.match(/data=(.+?)(?=\s+\w+=|$)/i);
    const constraintsMatch = args.match(/constraints=(.+?)(?=\s+\w+=|$)/i);

    const data_description = dataMatch?.[1]?.trim();
    const constr = constraintsMatch?.[1]?.trim();
    const problem = args
      .replace(/data=.+?(?=\s+\w+=|$)/i, "")
      .replace(/constraints=.+?(?=\s+\w+=|$)/i, "")
      .trim();

    const result = await mlGuidanceTool.execute(
      "cmd-ml",
      { problem, data_description, constraints: constr },
      new AbortController().signal,
    );
    printResult(result, ctx);
  });
}
