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

  // ── hotspot_analysis ──────────────────────────────────────────────────────

  pi.registerTool({
    name: "hotspot_analysis",
    label: "Hotspot Analysis",
    description:
      "Find the most-referenced exported symbols in the codebase. " +
      "Scans for exported functions, classes, types, and interfaces, then counts " +
      "references to each. Returns a ranked list of hotspots by reference count.",
    parameters: Type.Object({
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to scan; defaults to ['.']",
        }),
      ),
      min_refs: Type.Optional(
        Type.Number({
          description: "Minimum reference count to include in results; default 3",
          minimum: 1,
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const paths = (input["paths"] as string[] | undefined) ?? ["."];
      const minRefs = (input["min_refs"] as number | undefined) ?? 3;

      // Step 1: Find all exported symbol definitions
      const exportMatches = await runRg(
        buildRgArgs({
          pattern: `export\\s+(?:function|class|type|interface|const|enum)\\s+(\\w+)`,
          paths,
          fileGlob: "**/*.{ts,tsx,js,jsx,py,java,go}",
          caseSensitive: true,
        }),
      );

      // Extract symbol names with their definition locations
      interface SymbolDef {
        symbol: string;
        file: string;
        line: number;
      }

      const symbolMap = new Map<string, SymbolDef>();
      for (const m of exportMatches) {
        // Extract the symbol name from the match
        const match = m.content.match(
          /export\s+(?:function|class|type|interface|const|enum)\s+(\w+)/,
        );
        if (match && match[1]) {
          const sym = match[1];
          if (!symbolMap.has(sym)) {
            symbolMap.set(sym, { symbol: sym, file: m.file, line: m.line });
          }
        }
      }

      const allSymbols = [...symbolMap.values()].slice(0, 100);

      // Step 2: Count references for each symbol in parallel batches of 10
      const BATCH_SIZE = 10;
      interface HotspotResult {
        symbol: string;
        definedIn: string;
        line: number;
        refCount: number;
        referencedBy: string[];
      }

      const hotspots: HotspotResult[] = [];

      for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
        const batch = allSymbols.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (def) => {
            const escapedSym = def.symbol.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            try {
              const refs = await runRg(
                buildRgArgs({
                  pattern: `\\b${escapedSym}\\b`,
                  paths,
                  caseSensitive: true,
                }),
              );
              const referencedBy = [...new Set(refs.map((r) => r.file))];
              return {
                symbol: def.symbol,
                definedIn: def.file,
                line: def.line,
                refCount: refs.length,
                referencedBy,
              };
            } catch {
              return {
                symbol: def.symbol,
                definedIn: def.file,
                line: def.line,
                refCount: 0,
                referencedBy: [] as string[],
              };
            }
          }),
        );
        hotspots.push(...batchResults);
      }

      const filtered = hotspots
        .filter((h) => h.refCount >= minRefs)
        .sort((a, b) => b.refCount - a.refCount);

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              hotspots: filtered,
              totalSymbols: allSymbols.length,
              filteredCount: filtered.length,
            }),
          },
        ],
      };
    },
  });

  // ── service_map ───────────────────────────────────────────────────────────

  pi.registerTool({
    name: "service_map",
    label: "Service Map",
    description:
      "Discover services defined in Docker Compose and Kubernetes manifests. " +
      "Parses compose files and K8s YAML to extract service names, ports, and dependencies, " +
      "then generates a Mermaid diagram of connections.",
    parameters: Type.Object({
      path: Type.String({
        description: "Project root to scan for service definition files",
      }),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const scanPath = input["path"] as string;

      // Safety check on path
      if (
        scanPath.startsWith("/") ||
        scanPath.startsWith("~") ||
        scanPath.includes("..")
      ) {
        throw new Error(
          `Unsafe path rejected: "${scanPath}". Paths must be relative to the working directory.`,
        );
      }

      // Find Docker Compose files
      const composeMatches = await runRg(
        buildRgArgs({
          pattern: "services:",
          paths: [scanPath],
          fileGlob: "**/{docker-compose,compose}*.{yml,yaml}",
          caseSensitive: true,
        }),
      );

      // Find K8s manifests
      const k8sMatches = await runRg(
        buildRgArgs({
          pattern: "^apiVersion:",
          paths: [scanPath],
          fileGlob: "**/*.{yml,yaml}",
          caseSensitive: true,
        }),
      );

      // Collect unique files
      const composeFiles = [...new Set(composeMatches.map((m) => m.file))];
      const k8sFiles = [...new Set(k8sMatches.map((m) => m.file))].filter(
        (f) => !composeFiles.includes(f),
      );

      interface ServiceInfo {
        name: string;
        image?: string;
        ports: string[];
        dependsOn: string[];
        environment: string[];
        source: string;
        kind?: string;
      }

      const services: ServiceInfo[] = [];
      const connections: Array<{ from: string; to: string; type: string }> = [];

      // ── Parse Docker Compose files line-by-line ──
      for (const composeFile of composeFiles) {
        try {
          const { stdout } = await execFileAsync("cat", [composeFile], {
            maxBuffer: 2 * 1024 * 1024,
          });
          const lines = stdout.split("\n");

          let inServicesSection = false;
          let currentService: ServiceInfo | null = null;
          let currentSection = "";

          for (const rawLine of lines) {
            const trimmed = rawLine.trimEnd();

            if (trimmed === "services:") {
              inServicesSection = true;
              continue;
            }

            if (!inServicesSection) continue;

            // Top-level key at indent 0 that is not services ends services section
            if (trimmed.length > 0 && !trimmed.startsWith(" ") && !trimmed.startsWith("\t") && !trimmed.startsWith("#")) {
              if (!trimmed.startsWith("services:")) {
                inServicesSection = false;
                if (currentService) services.push(currentService);
                currentService = null;
              }
              continue;
            }

            // Detect service name (2-space indent, no leading dash)
            const serviceNameMatch = trimmed.match(/^  (\w[\w-]*):\s*$/);
            if (serviceNameMatch) {
              if (currentService) services.push(currentService);
              currentService = {
                name: serviceNameMatch[1],
                ports: [],
                dependsOn: [],
                environment: [],
                source: composeFile,
              };
              currentSection = "";
              continue;
            }

            if (!currentService) continue;

            // Detect subsection keys at 4-space indent
            const sectionMatch = trimmed.match(/^    (image|ports|depends_on|environment):\s*(.*)?$/);
            if (sectionMatch) {
              currentSection = sectionMatch[1];
              const inlineValue = sectionMatch[2]?.trim();
              if (currentSection === "image" && inlineValue) {
                currentService.image = inlineValue;
              }
              continue;
            }

            // List items at 6-space indent
            const listItemMatch = trimmed.match(/^      -\s+(.+)$/);
            if (listItemMatch) {
              const val = listItemMatch[1].trim();
              if (currentSection === "ports") currentService.ports.push(val);
              else if (currentSection === "depends_on") {
                currentService.dependsOn.push(val);
                connections.push({ from: currentService.name, to: val, type: "depends_on" });
              } else if (currentSection === "environment") {
                currentService.environment.push(val);
              }
            }
          }
          if (currentService) services.push(currentService);
        } catch {
          // skip unreadable files
        }
      }

      // ── Parse K8s manifests line-by-line ──
      for (const k8sFile of k8sFiles) {
        try {
          const { stdout } = await execFileAsync("cat", [k8sFile], {
            maxBuffer: 2 * 1024 * 1024,
          });
          const lines = stdout.split("\n");

          let currentKind = "";
          let currentName = "";
          const ports: string[] = [];

          for (const rawLine of lines) {
            const trimmed = rawLine.trim();

            if (trimmed.startsWith("---")) {
              // New document — save previous if any
              if (currentName) {
                services.push({
                  name: currentName,
                  kind: currentKind,
                  ports,
                  dependsOn: [],
                  environment: [],
                  source: k8sFile,
                });
              }
              currentKind = "";
              currentName = "";
              ports.length = 0;
              continue;
            }

            const kindMatch = trimmed.match(/^kind:\s+(\w+)/);
            if (kindMatch) {
              currentKind = kindMatch[1];
              continue;
            }

            const nameMatch = trimmed.match(/^name:\s+(\S+)/);
            if (nameMatch && !currentName) {
              currentName = nameMatch[1];
              continue;
            }

            const portMatch = trimmed.match(/^(?:containerPort|port):\s+(\d+)/);
            if (portMatch) {
              ports.push(portMatch[1]);
            }
          }

          // Save last document
          if (currentName) {
            services.push({
              name: currentName,
              kind: currentKind,
              ports: [...ports],
              dependsOn: [],
              environment: [],
              source: k8sFile,
            });
          }
        } catch {
          // skip unreadable files
        }
      }

      // ── Generate Mermaid diagram ──
      // Build collision-free Mermaid node IDs from service names
      const idMap = new Map<string, string>();
      const usedIds = new Set<string>();
      const toMermaidId = (name: string): string => {
        if (idMap.has(name)) return idMap.get(name)!;
        let base = name.replace(/[^a-zA-Z0-9_]/g, "_");
        let id = base;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${base}_${suffix++}`;
        }
        usedIds.add(id);
        idMap.set(name, id);
        return id;
      };

      const mermaidLines = ["graph LR"];
      const serviceNames = new Set(services.map((s) => s.name));
      for (const svc of services) {
        const id = toMermaidId(svc.name);
        const label = svc.kind ? `${svc.name}<br/>${svc.kind}` : svc.name;
        mermaidLines.push(`  ${id}["${label}"]`);
      }
      for (const conn of connections) {
        if (serviceNames.has(conn.from) && serviceNames.has(conn.to)) {
          mermaidLines.push(`  ${toMermaidId(conn.from)} -->|${conn.type}| ${toMermaidId(conn.to)}`);
        }
      }
      const mermaidDiagram = mermaidLines.join("\n");

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              services,
              connections,
              mermaidDiagram,
              totalServices: services.length,
              format_counts: {
                compose: composeFiles.length,
                k8s: k8sFiles.length,
              },
            }),
          },
        ],
      };
    },
  });

  // ── doc_search ────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "doc_search",
    label: "Documentation Search",
    description:
      "Search documentation files (Markdown, plain text, reStructuredText, AsciiDoc) " +
      "for a query. Returns matching snippets with surrounding context.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query or pattern to find in documentation",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
      file_types: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "File extensions to search (without dot); defaults to ['md','txt','rst','adoc']",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const query = input["query"] as string;
      const paths = input["paths"] as string[] | undefined;
      const fileTypes = (input["file_types"] as string[] | undefined) ?? [
        "md",
        "txt",
        "rst",
        "adoc",
      ];

      const fileGlob = `**/*.{${fileTypes.join(",")}}`;

      const matches = await runRg(
        buildRgArgs({
          pattern: query,
          paths,
          fileGlob,
          caseSensitive: false,
          contextLines: 2,
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
              query,
            }),
          },
        ],
      };
    },
  });

  // ── impl_search ───────────────────────────────────────────────────────────

  pi.registerTool({
    name: "impl_search",
    label: "Implementation Search",
    description:
      "Find code implementations related to a feature description. " +
      "Extracts meaningful keywords from the description and searches for " +
      "function/class/method definitions containing those keywords.",
    parameters: Type.Object({
      feature: Type.String({
        description: "Description of the feature or functionality to find",
      }),
      paths: Type.Optional(
        Type.Array(Type.String(), {
          description: "Directories to search; defaults to current directory",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const feature = input["feature"] as string;
      const paths = input["paths"] as string[] | undefined;

      // Extract meaningful keywords
      const STOPWORDS = new Set([
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
        "that", "this", "it", "its", "as", "do", "does", "did", "have", "has",
        "had", "will", "would", "could", "should", "may", "might", "can", "get",
        "set", "new", "all", "any", "not", "no", "if", "use", "used", "using",
        "how", "what", "when", "where", "which", "who", "add", "make", "create",
      ]);

      const keywords = feature
        .toLowerCase()
        .split(/[\s\-_./\\,;:!?()[\]{}'"]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        .slice(0, 8);

      if (keywords.length === 0) {
        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                candidates: [],
                keywords,
                totalCandidates: 0,
              }),
            },
          ],
        };
      }

      // Search for definitions matching each keyword in parallel
      const keywordResults = await Promise.all(
        keywords.map(async (kw) => {
          const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const [defMatches, exportMatches] = await Promise.all([
            runRg(
              buildRgArgs({
                pattern: `(?:function|class|def|func)\\s+\\w*${escapedKw}\\w*`,
                paths,
                caseSensitive: false,
              }),
            ).catch(() => [] as SearchMatch[]),
            runRg(
              buildRgArgs({
                pattern: `(?:export\\s+(?:default\\s+)?(?:function|class|const))\\s+\\w*${escapedKw}\\w*`,
                paths,
                caseSensitive: false,
              }),
            ).catch(() => [] as SearchMatch[]),
          ]);
          return { keyword: kw, matches: [...defMatches, ...exportMatches] };
        }),
      );

      // Build candidate map: file+line -> candidate
      interface Candidate {
        file: string;
        symbol: string;
        line: number;
        lineRange: { start: number; end: number };
        matchedKeywords: string[];
        score: number;
      }

      const candidateMap = new Map<string, Candidate>();

      for (const { keyword, matches } of keywordResults) {
        for (const m of matches) {
          const key = `${m.file}:${m.line}`;

          // Extract symbol name from match content
          const symMatch = m.content.match(
            /(?:export\s+(?:default\s+)?)?(?:function|class|def|func|const)\s+(\w+)/i,
          );
          const symbol = symMatch ? symMatch[1] : m.matchText;

          if (candidateMap.has(key)) {
            const existing = candidateMap.get(key)!;
            if (!existing.matchedKeywords.includes(keyword)) {
              existing.matchedKeywords.push(keyword);
              existing.score += 1;
            }
          } else {
            candidateMap.set(key, {
              file: m.file,
              symbol,
              line: m.line,
              lineRange: { start: Math.max(1, m.line - 2), end: m.line + 5 },
              matchedKeywords: [keyword],
              score: 1,
            });
          }
        }
      }

      const candidates = [...candidateMap.values()].sort(
        (a, b) => b.score - a.score,
      );

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              candidates,
              keywords,
              totalCandidates: candidates.length,
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
        // Relationship declarations (JS/TS ORMs + Django + Prisma + ActiveRecord)
        runRg(
          buildRgArgs({
            pattern: `(?:hasMany|belongsTo|hasOne|belongsToMany|references|foreignKey|ManyToOne|OneToMany|ManyToMany|OneToOne|ForeignKey|relation|models\\.\\w+Field|ForeignKey|ManyToManyField|OneToOneField|@relation|@@map|@@id|has_many|belongs_to|has_one|has_and_belongs_to_many).*${escaped}|${escaped}.*(?:hasMany|belongsTo|hasOne|belongsToMany|references|foreignKey|models\\.\\w+Field|ForeignKey|ManyToManyField|OneToOneField|@relation|has_many|belongs_to|has_one)`,
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
