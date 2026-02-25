/**
 * Search domain tools: code_search, symbol_refs, blast_radius.
 *
 * All three tools use ripgrep (rg) via child_process for fast codebase search.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI, PiCommandContext } from "../../types.js";

const execFileAsync = promisify(execFile);

// ── rg JSON output types ───────────────────────────────────────────────────────

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

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
  matchText: string;
}

// ── ripgrep runner ─────────────────────────────────────────────────────────────

async function runRg(rgArgs: string[]): Promise<SearchMatch[]> {
  try {
    const { stdout } = await execFileAsync("rg", rgArgs, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseRgJson(stdout);
  } catch (err: unknown) {
    // rg exits with code 1 when no matches — not an error
    if (isExitError(err) && (err as { code: number }).code === 1) {
      return [];
    }
    throw err;
  }
}

function parseRgJson(output: string): SearchMatch[] {
  const results: SearchMatch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    let obj: RgLine;
    try {
      obj = JSON.parse(line) as RgLine;
    } catch {
      continue;
    }
    if (obj.type !== "match") continue;
    const data = obj.data as RgMatchData;
    results.push({
      file: data.path.text,
      line: data.line_number,
      content: data.lines.text.trimEnd(),
      matchStart: data.submatches[0]?.start ?? 0,
      matchEnd: data.submatches[0]?.end ?? 0,
      matchText: data.submatches[0]?.match.text ?? "",
    });
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

function buildRgArgs(opts: {
  pattern: string;
  paths?: string[];
  fileGlob?: string;
  caseSensitive?: boolean;
  contextLines?: number;
}): string[] {
  const args: string[] = ["--json"];

  if (!opts.caseSensitive) {
    args.push("--ignore-case");
  }

  if (opts.fileGlob) {
    args.push(`--glob=${opts.fileGlob}`);
  }

  if (opts.contextLines != null && opts.contextLines > 0) {
    args.push(`--context=${opts.contextLines}`);
  }

  args.push(opts.pattern);

  // Path traversal guard: reject paths that escape the working directory
  const safePaths = (opts.paths ?? ["."]).map((p) => {
    // Reject absolute paths and parent directory traversals
    if (p.startsWith("/") || p.startsWith("~") || p.includes("..")) {
      throw new Error(`Unsafe path rejected: "${p}". Paths must be relative to the working directory.`);
    }
    return p;
  });
  args.push(...safePaths);

  return args;
}

// ── Group matches by file ──────────────────────────────────────────────────────

function groupByFile(
  matches: SearchMatch[],
): Array<{ file: string; matches: SearchMatch[] }> {
  const map = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    if (!map.has(m.file)) map.set(m.file, []);
    map.get(m.file)!.push(m);
  }
  return [...map.entries()].map(([file, fileMatches]) => ({
    file,
    matches: fileMatches,
  }));
}

// ── Tool registrar ─────────────────────────────────────────────────────────────

export function registerSearchTools(pi: PiExtensionAPI): void {
  // ── code_search ──────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description:
      "Search the codebase for a pattern using ripgrep. Returns matching lines with " +
      "file path and line number. Supports regex patterns and file glob filtering.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regex or literal search pattern" }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Directories or files to search; defaults to current directory",
        }),
      ),
      file_glob: Type.Optional(
        Type.String({
          description: "Glob pattern to filter files, e.g. '**/*.ts'",
        }),
      ),
      case_sensitive: Type.Optional(
        Type.Boolean({
          description: "Whether to use case-sensitive matching; defaults false",
        }),
      ),
      context_lines: Type.Optional(
        Type.Number({
          description: "Lines of context around each match; default 0",
          minimum: 0,
          maximum: 10,
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const matches = await runRg(
        buildRgArgs({
          pattern: input["pattern"] as string,
          paths: input["paths"] as string[] | undefined,
          fileGlob: input["file_glob"] as string | undefined,
          caseSensitive: input["case_sensitive"] as boolean | undefined,
          contextLines: input["context_lines"] as number | undefined,
        }),
      );

      const byFile = groupByFile(matches);

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              matches,
              byFile,
              totalCount: matches.length,
              fileCount: byFile.length,
            }),
          },
        ],
      };
    },
  });

  // ── symbol_refs ──────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "symbol_refs",
    label: "Symbol References",
    description:
      "Find all references to a symbol (function, class, variable, type) across the codebase. " +
      "Uses word-boundary matching to avoid partial matches.",
    parameters: Type.Object({
      symbol: Type.String({
        description: "Symbol name to find references for",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
      file_glob: Type.Optional(
        Type.String({
          description:
            "Glob to filter files, e.g. '**/*.ts' for TypeScript only",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const symbol = input["symbol"] as string;
      // Escape special regex chars in symbol name
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const matches = await runRg(
        buildRgArgs({
          pattern: `\\b${escaped}\\b`,
          paths: input["paths"] as string[] | undefined,
          fileGlob: input["file_glob"] as string | undefined,
          caseSensitive: true,
        }),
      );

      const byFile = groupByFile(matches);

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              symbol,
              references: byFile,
              totalCount: matches.length,
              fileCount: byFile.length,
            }),
          },
        ],
      };
    },
  });

  // ── blast_radius ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "blast_radius",
    label: "Blast Radius",
    description:
      "Estimate the blast radius of changing a file or symbol: which files import it, " +
      "and which test files cover it. Helps assess risk before refactoring.",
    parameters: Type.Object({
      target: Type.String({
        description:
          "File path (e.g. 'src/auth.ts') or symbol name to analyse",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
      depth: Type.Optional(
        Type.Integer({
          description:
            "Transitive import depth to follow (1=direct only, 2-3=transitive). Default: 1.",
          minimum: 1,
          maximum: 3,
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const target = input["target"] as string;
      const paths = input["paths"] as string[] | undefined;
      const depth = (input["depth"] as number | undefined) ?? 1;

      // Escape for regex
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Find direct importers
      const [importMatches, testMatches] = await Promise.all([
        runRg(
          buildRgArgs({
            pattern: `import.*${escaped}|require.*${escaped}|from ['"].*${escaped}`,
            paths,
            caseSensitive: false,
          }),
        ),
        runRg(
          buildRgArgs({
            pattern: escaped,
            paths,
            fileGlob: "**/*.{test,spec}.{ts,js,tsx,jsx}",
            caseSensitive: false,
          }),
        ),
      ]);

      const directImporters = [...new Set(importMatches.map((m) => m.file))];
      const testFiles = [...new Set(testMatches.map((m) => m.file))];

      // Transitive import chain following
      const allImporters = new Set(directImporters);
      let frontier = directImporters;

      for (let d = 1; d < depth && frontier.length > 0; d++) {
        const nextFrontier: string[] = [];
        for (const file of frontier) {
          const fileEscaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // Strip extension for import matching
          const noExt = fileEscaped.replace(/\.[^.]+$/, "");
          try {
            const transitiveMatches = await runRg(
              buildRgArgs({
                pattern: `import.*${noExt}|require.*${noExt}|from ['"].*${noExt}`,
                paths,
                caseSensitive: false,
              }),
            );
            for (const m of transitiveMatches) {
              if (!allImporters.has(m.file)) {
                allImporters.add(m.file);
                nextFrontier.push(m.file);
              }
            }
          } catch {
            // skip files that fail
          }
        }
        frontier = nextFrontier;
      }

      const transitiveImporters = [...allImporters].filter(
        (f) => !directImporters.includes(f),
      );

      // Summarise risk level
      const totalCount = allImporters.size;
      const risk =
        totalCount > 10
          ? "high"
          : totalCount > 3
            ? "medium"
            : "low";

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              target,
              directImporters,
              transitiveImporters,
              testFiles,
              directCount: directImporters.length,
              transitiveCount: transitiveImporters.length,
              totalCount,
              testCoverage: testFiles.length,
              depth,
              risk,
              summary: `${directImporters.length} direct + ${transitiveImporters.length} transitive importer(s) of ${target}; ${testFiles.length} test file(s). Risk: ${risk}.`,
            }),
          },
        ],
      };
    },
  });

  // ── data_lineage ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: "data_lineage",
    label: "Data Lineage",
    description:
      "Trace data flow through ORM model definitions, database schemas, and migration files. " +
      "Finds model definitions, relationships (hasMany, belongsTo, references), and migration files.",
    parameters: Type.Object({
      model: Type.String({
        description: "Model or table name to trace (e.g. 'User', 'orders').",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory.",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const model = input["model"] as string;
      const paths = input["paths"] as string[] | undefined;
      const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Search for model definitions, relationships, and migrations in parallel
      const [
        definitionMatches,
        relationshipMatches,
        migrationMatches,
        schemaMatches,
      ] = await Promise.all([
        // Model class/schema definitions
        runRg(
          buildRgArgs({
            pattern: `(?:class|model|schema|table|entity)\\s+${escaped}\\b|\\b${escaped}\\s*=\\s*(?:define|model|schema)`,
            paths,
            caseSensitive: false,
          }),
        ),
        // Relationship declarations
        runRg(
          buildRgArgs({
            pattern: `(?:hasMany|belongsTo|hasOne|belongsToMany|references|foreignKey|ManyToOne|OneToMany|ManyToMany|OneToOne|ForeignKey|relation).*${escaped}|${escaped}.*(?:hasMany|belongsTo|hasOne|belongsToMany|references|foreignKey)`,
            paths,
            caseSensitive: false,
          }),
        ),
        // Migration files
        runRg(
          buildRgArgs({
            pattern: `(?:create|alter|drop|add).*${escaped}|${escaped}`,
            paths,
            fileGlob: "**/*migration*",
            caseSensitive: false,
          }),
        ),
        // Schema/type references
        runRg(
          buildRgArgs({
            pattern: `\\b${escaped}(?:Schema|Type|Model|Entity|Table|Record)\\b`,
            paths,
            caseSensitive: false,
          }),
        ),
      ]);

      const definitions = groupByFile(definitionMatches);
      const relationships = groupByFile(relationshipMatches);
      const migrations = groupByFile(migrationMatches);
      const schemas = groupByFile(schemaMatches);

      // Extract related models from relationship matches
      const relatedModels = new Set<string>();
      for (const m of relationshipMatches) {
        // Look for other capitalized words near relationship keywords
        const words = m.content.match(/\b[A-Z][a-zA-Z]+\b/g) ?? [];
        for (const w of words) {
          if (w !== model && w.length > 2 && !["String", "Number", "Boolean", "Array", "Promise", "Type", "Schema"].includes(w)) {
            relatedModels.add(w);
          }
        }
      }

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              model,
              definitions: definitions.map((d) => ({
                file: d.file,
                lines: d.matches.map((m) => ({ line: m.line, content: m.content })),
              })),
              relationships: relationships.map((r) => ({
                file: r.file,
                lines: r.matches.map((m) => ({ line: m.line, content: m.content })),
              })),
              migrations: migrations.map((m) => ({
                file: m.file,
                lines: m.matches.map((mm) => ({ line: mm.line, content: mm.content })),
              })),
              schemas: schemas.map((s) => ({
                file: s.file,
                lines: s.matches.map((m) => ({ line: m.line, content: m.content })),
              })),
              relatedModels: [...relatedModels],
              summary: {
                definitionFiles: definitions.length,
                relationshipFiles: relationships.length,
                migrationFiles: migrations.length,
                schemaFiles: schemas.length,
                relatedModelCount: relatedModels.size,
              },
            }),
          },
        ],
      };
    },
  });
}
