/**
 * Search domain slash commands: /search, /refs, /impact
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiExtensionAPI, PiCommandContext } from "../../types.js";

const execFileAsync = promisify(execFile);

export function registerSearchCommands(pi: PiExtensionAPI): void {
  // /search <pattern> [--glob *.ts] [--path src/] [--case]
  pi.registerCommand("/search", async (args: string, ctx: PiCommandContext) => {
    const { pattern, glob, paths, caseSensitive } = parseSearchArgs(args);

    if (!pattern) {
      ctx.ui.showMessage(
        "warn",
        "Usage: /search <pattern> [--glob *.ts] [--path src/] [--case]",
      );
      return;
    }

    ctx.ui.showMessage("info", `Searching for "${pattern}"...`);

    const rgArgs = ["--json"];
    if (!caseSensitive) rgArgs.push("--ignore-case");
    if (glob) rgArgs.push(`--glob=${glob}`);
    rgArgs.push(pattern);
    rgArgs.push(...paths);

    try {
      const { stdout } = await execFileAsync("rg", rgArgs, {
        maxBuffer: 5 * 1024 * 1024,
        cwd: ctx.session.cwd,
      });

      const matches = parseRgOutput(stdout);
      if (matches.length === 0) {
        ctx.ui.showMessage("info", `No matches found for "${pattern}".`);
        return;
      }

      // Group by file for compact display
      const byFile = new Map<string, string[]>();
      for (const m of matches) {
        if (!byFile.has(m.file)) byFile.set(m.file, []);
        byFile
          .get(m.file)!
          .push(`  L${m.line}: ${m.content.trim().slice(0, 120)}`);
      }

      const lines: string[] = [`Found ${matches.length} match(es):`];
      for (const [file, fileLines] of byFile) {
        lines.push(file);
        lines.push(...fileLines.slice(0, 5));
        if (fileLines.length > 5)
          lines.push(`  ... and ${fileLines.length - 5} more`);
      }

      ctx.ui.showMessage("info", lines.join("\n"));
    } catch (err: unknown) {
      if (isExitError(err) && (err as { code: number }).code === 1) {
        ctx.ui.showMessage("info", `No matches found for "${pattern}".`);
        return;
      }
      throw err;
    }
  });

  // /refs <symbol> [--path src/]
  pi.registerCommand("/refs", async (args: string, ctx: PiCommandContext) => {
    const parts = args.trim().split(/\s+/);
    const symbol = parts[0] ?? "";
    const pathIdx = parts.indexOf("--path");
    const searchPath =
      pathIdx !== -1 && parts[pathIdx + 1]
        ? parts[pathIdx + 1]!
        : ctx.session.cwd;

    if (!symbol) {
      ctx.ui.showMessage("warn", "Usage: /refs <symbol> [--path src/]");
      return;
    }

    ctx.ui.showMessage("info", `Finding references to "${symbol}"...`);

    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rgArgs = ["--json", `\\b${escaped}\\b`, searchPath];

    try {
      const { stdout } = await execFileAsync("rg", rgArgs, {
        maxBuffer: 5 * 1024 * 1024,
        cwd: ctx.session.cwd,
      });

      const matches = parseRgOutput(stdout);
      const files = [...new Set(matches.map((m) => m.file))];

      if (files.length === 0) {
        ctx.ui.showMessage("info", `No references to "${symbol}" found.`);
        return;
      }

      const lines = [
        `Found ${matches.length} reference(s) to "${symbol}" in ${files.length} file(s):`,
        ...files.map((f) => `  ${f}`),
      ];
      ctx.ui.showMessage("info", lines.join("\n"));
    } catch (err: unknown) {
      if (isExitError(err) && (err as { code: number }).code === 1) {
        ctx.ui.showMessage("info", `No references to "${symbol}" found.`);
        return;
      }
      throw err;
    }
  });

  // /impact <target> — blast radius analysis
  pi.registerCommand(
    "/impact",
    async (args: string, ctx: PiCommandContext) => {
      const target = args.trim();

      if (!target) {
        ctx.ui.showMessage(
          "warn",
          "Usage: /impact <file-path-or-symbol-name>",
        );
        return;
      }

      ctx.ui.showMessage("info", `Analysing blast radius of "${target}"...`);

      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const importPattern = `import.*${escaped}|require.*${escaped}|from ['"].*${escaped}`;

      try {
        const [importResult, testResult] = await Promise.allSettled([
          execFileAsync("rg", ["--json", "-i", importPattern, "."], {
            maxBuffer: 5 * 1024 * 1024,
            cwd: ctx.session.cwd,
          }),
          execFileAsync(
            "rg",
            [
              "--json",
              "-i",
              "--glob=**/*.{test,spec}.{ts,js,tsx,jsx}",
              escaped,
              ".",
            ],
            {
              maxBuffer: 5 * 1024 * 1024,
              cwd: ctx.session.cwd,
            },
          ),
        ]);

        const importMatches =
          importResult.status === "fulfilled"
            ? parseRgOutput(importResult.value.stdout)
            : [];
        const testMatches =
          testResult.status === "fulfilled"
            ? parseRgOutput(testResult.value.stdout)
            : [];

        const importers = [...new Set(importMatches.map((m) => m.file))];
        const testFiles = [...new Set(testMatches.map((m) => m.file))];

        const risk =
          importers.length > 10
            ? "HIGH"
            : importers.length > 3
              ? "MEDIUM"
              : "LOW";

        const lines = [
          `Blast radius for "${target}": ${risk} risk`,
          `Importers (${importers.length}):`,
          ...importers.slice(0, 10).map((f) => `  ${f}`),
          ...(importers.length > 10
            ? [`  ... and ${importers.length - 10} more`]
            : []),
          `Test coverage (${testFiles.length} files):`,
          ...testFiles.map((f) => `  ${f}`),
        ];

        ctx.ui.showMessage("info", lines.join("\n"));
      } catch (err: unknown) {
        if (isExitError(err) && (err as { code: number }).code === 1) {
          ctx.ui.showMessage(
            "info",
            `No references to "${target}" found — blast radius is zero.`,
          );
          return;
        }
        throw err;
      }
    },
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseSearchArgs(args: string): {
  pattern: string;
  glob?: string;
  paths: string[];
  caseSensitive: boolean;
} {
  const parts = args.trim().split(/\s+/);
  let pattern = "";
  let glob: string | undefined;
  const paths: string[] = [];
  let caseSensitive = false;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--glob" && parts[i + 1]) {
      glob = parts[i + 1];
      i++;
    } else if (parts[i] === "--path" && parts[i + 1]) {
      paths.push(parts[i + 1]!);
      i++;
    } else if (parts[i] === "--case") {
      caseSensitive = true;
    } else if (!pattern) {
      pattern = parts[i]!;
    }
  }

  return { pattern, glob, paths: paths.length > 0 ? paths : ["."], caseSensitive };
}

interface ParsedMatch {
  file: string;
  line: number;
  content: string;
}

function parseRgOutput(output: string): ParsedMatch[] {
  const results: ParsedMatch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as {
        type: string;
        data: {
          path: { text: string };
          line_number: number;
          lines: { text: string };
        };
      };
      if (obj.type !== "match") continue;
      results.push({
        file: obj.data.path.text,
        line: obj.data.line_number,
        content: obj.data.lines.text,
      });
    } catch {
      continue;
    }
  }
  return results;
}

function isExitError(err: unknown): err is { code: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>)["code"] === "number"
  );
}
