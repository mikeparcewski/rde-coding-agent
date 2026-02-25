/**
 * Patch domain tools: rename_symbol, add_field, remove_symbol.
 *
 * Uses ripgrep for reference discovery and produces structured patch plans
 * that can be reviewed before applying.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI } from "../../types.js";

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────────────────

interface PatchLocation {
  file: string;
  line: number;
  column: number;
  content: string;
  proposed: string;
}

interface PatchPlan {
  operation: string;
  oldName: string;
  newName?: string;
  locations: PatchLocation[];
  fileCount: number;
  totalChanges: number;
  preview: string;
}

// ── ripgrep helpers ─────────────────────────────────────────────────────────

interface RgMatchData {
  path: { text: string };
  line_number: number;
  lines: { text: string };
  submatches: Array<{ start: number; end: number; match: { text: string } }>;
}

interface RgLine {
  type: string;
  data: unknown;
}

async function findReferences(
  symbol: string,
  paths: string[],
  fileGlob?: string,
): Promise<Array<{ file: string; line: number; column: number; content: string }>> {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const args: string[] = ["--json", `\\b${escaped}\\b`];

  if (fileGlob) {
    args.push(`--glob=${fileGlob}`);
  }

  // Path safety
  const safePaths = paths.map((p) => {
    if (p.startsWith("/") || p.startsWith("~") || p.includes("..")) {
      throw new Error(
        `Unsafe path rejected: "${p}". Paths must be relative to the working directory.`,
      );
    }
    return p;
  });
  args.push(...safePaths);

  try {
    const { stdout } = await execFileAsync("rg", args, {
      maxBuffer: 10 * 1024 * 1024,
    });

    const results: Array<{ file: string; line: number; column: number; content: string }> = [];

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      let obj: RgLine;
      try {
        obj = JSON.parse(line) as RgLine;
      } catch {
        continue;
      }
      if (obj.type !== "match") continue;
      const data = obj.data as RgMatchData;
      const submatch = data.submatches[0];
      results.push({
        file: data.path.text,
        line: data.line_number,
        column: submatch?.start ?? 0,
        content: data.lines.text.trimEnd(),
      });
    }

    return results;
  } catch (err: unknown) {
    // rg exits 1 when no matches
    if (isExitError(err) && (err as { code: number }).code === 1) {
      return [];
    }
    throw err;
  }
}

function isExitError(err: unknown): err is { code: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>)["code"] === "number"
  );
}

// ── Tool registrar ──────────────────────────────────────────────────────────

export function registerPatchTools(pi: PiExtensionAPI): void {
  // ── rename_symbol ─────────────────────────────────────────────────────────

  pi.registerTool({
    name: "rename_symbol",
    label: "Rename Symbol",
    description:
      "Find all references to a symbol across the codebase and produce a structured " +
      "rename patch plan. Shows every file and line where the symbol appears with " +
      "the proposed replacement. Does NOT apply changes — returns a plan for review.",
    parameters: Type.Object({
      old_name: Type.String({
        description: "Current symbol name to rename",
      }),
      new_name: Type.String({
        description: "New name for the symbol",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
      file_glob: Type.Optional(
        Type.String({
          description: "Glob to filter files, e.g. '**/*.ts'",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      onUpdate,
    ) {
      const oldName = input["old_name"] as string;
      const newName = input["new_name"] as string;
      const paths = (input["paths"] as string[] | undefined) ?? ["."];
      const fileGlob = input["file_glob"] as string | undefined;

      onUpdate?.({
        type: "text",
        text: `Finding references to "${oldName}"...`,
      });

      const refs = await findReferences(oldName, paths, fileGlob);

      const locations: PatchLocation[] = refs.map((ref) => ({
        file: ref.file,
        line: ref.line,
        column: ref.column,
        content: ref.content,
        proposed: ref.content.replace(
          new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
          newName,
        ),
      }));

      const uniqueFiles = new Set(locations.map((l) => l.file));

      const previewLines = locations.slice(0, 10).map(
        (l) =>
          `${l.file}:${l.line}\n  - ${l.content}\n  + ${l.proposed}`,
      );
      if (locations.length > 10) {
        previewLines.push(`... and ${locations.length - 10} more`);
      }

      const plan: PatchPlan = {
        operation: "rename",
        oldName,
        newName,
        locations,
        fileCount: uniqueFiles.size,
        totalChanges: locations.length,
        preview: previewLines.join("\n\n"),
      };

      return {
        type: "text" as const,
        content: [{ type: "text" as const, text: JSON.stringify(plan) }],
      };
    },
  });

  // ── remove_symbol ─────────────────────────────────────────────────────────

  pi.registerTool({
    name: "remove_symbol",
    label: "Remove Symbol",
    description:
      "Find all references to a symbol that needs to be removed. Returns a plan " +
      "showing every location where the symbol is referenced, helping identify " +
      "what needs to be cleaned up.",
    parameters: Type.Object({
      symbol: Type.String({
        description: "Symbol name to find for removal",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
      file_glob: Type.Optional(
        Type.String({
          description: "Glob to filter files, e.g. '**/*.ts'",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      onUpdate,
    ) {
      const symbol = input["symbol"] as string;
      const paths = (input["paths"] as string[] | undefined) ?? ["."];
      const fileGlob = input["file_glob"] as string | undefined;

      onUpdate?.({
        type: "text",
        text: `Finding references to "${symbol}" for removal...`,
      });

      const refs = await findReferences(symbol, paths, fileGlob);

      const locations: PatchLocation[] = refs.map((ref) => ({
        file: ref.file,
        line: ref.line,
        column: ref.column,
        content: ref.content,
        proposed: "// [REMOVE] " + ref.content,
      }));

      const uniqueFiles = new Set(locations.map((l) => l.file));

      const plan: PatchPlan = {
        operation: "remove",
        oldName: symbol,
        locations,
        fileCount: uniqueFiles.size,
        totalChanges: locations.length,
        preview: locations
          .slice(0, 10)
          .map((l) => `${l.file}:${l.line}: ${l.content}`)
          .join("\n"),
      };

      return {
        type: "text" as const,
        content: [{ type: "text" as const, text: JSON.stringify(plan) }],
      };
    },
  });
}
