/**
 * Engineering domain tools.
 *
 * Provides code review, debug analysis, architecture review, and
 * documentation generation backed by real file I/O.
 */

import { Type } from "@sinclair/typebox";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import type { PiTool, PiToolResult } from "../../types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function textResult(text: string): PiToolResult {
  return { type: "text", content: [{ type: "text", text }] };
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    return `[could not read file: ${(err as Error).message}]`;
  }
}

async function walkDir(
  dir: string,
  depth: number,
  maxDepth: number,
  lines: string[],
  prefix = "",
): Promise<void> {
  if (depth > maxDepth) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const ignore = new Set(["node_modules", ".git", "dist", ".next", "coverage", "__pycache__", ".cache"]);
  for (const entry of entries.sort()) {
    if (ignore.has(entry)) continue;
    const fullPath = join(dir, entry);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      lines.push(`${prefix}${entry}/`);
      await walkDir(fullPath, depth + 1, maxDepth, lines, prefix + "  ");
    } else {
      lines.push(`${prefix}${entry}`);
    }
  }
}

// ── code_review ───────────────────────────────────────────────────────────────

export const codeReviewTool: PiTool = {
  name: "code_review",
  label: "Code Review",
  description:
    "Reads the specified files and returns a structured code review with concerns, suggestions, and praise.",
  parameters: Type.Object({
    files: Type.Array(Type.String(), {
      description: "Absolute or cwd-relative file paths to review.",
      minItems: 1,
    }),
    focus: Type.Optional(
      Type.Union(
        [
          Type.Literal("frontend"),
          Type.Literal("backend"),
          Type.Literal("security"),
          Type.Literal("general"),
        ],
        {
          description:
            "Focus area that tailors review rules: 'frontend' adds accessibility/component/hook checks, 'backend' adds error handling/SQL/auth checks, 'security' adds secrets/injection/XSS checks, 'general' runs all standard checks. Default: general.",
        },
      ),
    ),
  }),

  async execute(_id, input) {
    const { files, focus } = input as { files: string[]; focus?: string };
    const sections: string[] = [];

    sections.push("# Code Review");
    if (focus) sections.push(`**Focus**: ${focus}\n`);

    for (const filePath of files) {
      const source = await readFileSafe(filePath);
      const lines = source.split("\n");
      const ext = extname(filePath).toLowerCase();

      sections.push(`\n## File: \`${filePath}\``);
      sections.push(`Lines: ${lines.length}  |  Extension: ${ext || "(none)"}\n`);

      // --- Concerns ---
      const concerns: string[] = [];

      // Long functions heuristic: consecutive non-blank lines > 60
      let consecutive = 0;
      let funcStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== "") {
          if (consecutive === 0) funcStart = i + 1;
          consecutive++;
        } else {
          if (consecutive > 60) {
            concerns.push(
              `Lines ${funcStart}–${funcStart + consecutive - 1}: Large block (${consecutive} lines) — consider extracting into smaller functions.`,
            );
          }
          consecutive = 0;
        }
      }
      if (consecutive > 60) {
        concerns.push(
          `Lines ${funcStart}–${funcStart + consecutive - 1}: Large block (${consecutive} lines) — consider extracting into smaller functions.`,
        );
      }

      // TODO / FIXME / HACK comments
      const todoLines = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /TODO|FIXME|HACK|XXX/.test(l));
      for (const { l, i } of todoLines) {
        concerns.push(`Line ${i + 1}: ${l.trim()}`);
      }

      // console.log / print statements (debug noise)
      const debugLines = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /\bconsole\.(log|warn|error|debug)\b|^(\s*)print\(/.test(l));
      for (const { l, i } of debugLines.slice(0, 5)) {
        concerns.push(`Line ${i + 1}: Debug statement — \`${l.trim()}\``);
      }
      if (debugLines.length > 5) {
        concerns.push(`…and ${debugLines.length - 5} more debug statements.`);
      }

      // Hardcoded magic numbers
      const magicLines = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /[^a-zA-Z_]\d{3,}[^a-zA-Z_]/.test(l) && !/^\s*\/\//.test(l));
      for (const { l, i } of magicLines.slice(0, 3)) {
        concerns.push(`Line ${i + 1}: Possible magic number — \`${l.trim()}\``);
      }

      // --- Focus-specific concerns ---
      if (focus === "frontend" || focus === "security") {
        // Accessibility: img without alt
        for (let i = 0; i < lines.length; i++) {
          if (/<img\b/i.test(lines[i]) && !/alt\s*=/i.test(lines[i])) {
            concerns.push(`Line ${i + 1}: <img> missing \`alt\` attribute (accessibility).`);
          }
        }
      }

      if (focus === "frontend") {
        // React hook rules
        for (let i = 0; i < lines.length; i++) {
          if (/useEffect\s*\(\s*(?:async|function)/.test(lines[i])) {
            concerns.push(`Line ${i + 1}: useEffect callback should not be async — return a cleanup function that calls the async work.`);
          }
          if (/useState\b/.test(lines[i]) && /\bfor\b|\bwhile\b/.test(lines[i])) {
            concerns.push(`Line ${i + 1}: useState inside a loop — hooks must be called at the top level.`);
          }
        }
        // dangerouslySetInnerHTML
        for (let i = 0; i < lines.length; i++) {
          if (/dangerouslySetInnerHTML/.test(lines[i])) {
            concerns.push(`Line ${i + 1}: \`dangerouslySetInnerHTML\` — verify input is sanitized.`);
          }
        }
        // Inline styles count
        const inlineStyleCount = lines.filter((l) => /style\s*=\s*\{/.test(l)).length;
        if (inlineStyleCount > 10) {
          concerns.push(`${inlineStyleCount} inline styles found — consider CSS classes or styled components.`);
        }
      }

      if (focus === "backend") {
        // SQL string concatenation
        for (let i = 0; i < lines.length; i++) {
          if (/(?:SELECT|INSERT|UPDATE|DELETE).*\+\s*(?:req|params|body|query)/i.test(lines[i])) {
            concerns.push(`Line ${i + 1}: Possible SQL injection via string concatenation — use parameterized queries.`);
          }
        }
        // Unhandled promise
        for (let i = 0; i < lines.length; i++) {
          if (/\.then\s*\(/.test(lines[i]) && !/\.catch\s*\(/.test(lines[i])) {
            // Look ahead a couple lines for .catch
            const nextLines = lines.slice(i, i + 3).join(" ");
            if (!/\.catch\s*\(/.test(nextLines)) {
              concerns.push(`Line ${i + 1}: Promise chain without .catch() — unhandled rejections may crash the process.`);
            }
          }
        }
      }

      if (focus === "security") {
        // Hardcoded secrets
        for (let i = 0; i < lines.length; i++) {
          if (/(?:password|secret|api_key|token)\s*[=:]\s*['"][^'"]{4,}['"]/i.test(lines[i])) {
            concerns.push(`Line ${i + 1}: Possible hardcoded secret — use environment variables or a secrets manager.`);
          }
        }
        // eval usage
        for (let i = 0; i < lines.length; i++) {
          if (/\beval\s*\(/.test(lines[i])) {
            concerns.push(`Line ${i + 1}: \`eval()\` usage — potential code injection risk.`);
          }
        }
        // innerHTML
        for (let i = 0; i < lines.length; i++) {
          if (/innerHTML\s*=/.test(lines[i])) {
            concerns.push(`Line ${i + 1}: Direct \`innerHTML\` assignment — potential XSS vulnerability.`);
          }
        }
      }

      // --- Suggestions ---
      const suggestions: string[] = [];

      // Missing error handling patterns
      if ([".ts", ".js", ".tsx", ".jsx"].includes(ext)) {
        const awaitLines = lines.filter((l) => /\bawait\b/.test(l));
        const tryCatchLines = lines.filter((l) => /\btry\b/.test(l));
        if (awaitLines.length > 0 && tryCatchLines.length === 0) {
          suggestions.push(
            "Async calls detected but no try/catch blocks found — consider adding error handling.",
          );
        }
      }

      // Missing type annotations in TS
      if ([".ts", ".tsx"].includes(ext)) {
        const anyLines = lines
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => /:\s*any\b/.test(l));
        for (const { i } of anyLines.slice(0, 3)) {
          suggestions.push(`Line ${i + 1}: \`any\` type — add a specific type annotation.`);
        }
      }

      // Long lines
      const longLines = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.length > 120);
      if (longLines.length > 0) {
        suggestions.push(
          `${longLines.length} line(s) exceed 120 characters — consider wrapping or extracting variables.`,
        );
      }

      // Duplicate imports
      if ([".ts", ".js", ".tsx", ".jsx"].includes(ext)) {
        const imports = lines
          .filter((l) => /^import\s/.test(l))
          .map((l) => l.replace(/\s+/g, " ").trim());
        const seen = new Set<string>();
        for (const imp of imports) {
          if (seen.has(imp)) {
            suggestions.push(`Duplicate import detected: \`${imp}\``);
          }
          seen.add(imp);
        }
      }

      // --- Praise ---
      const praise: string[] = [];

      // Type annotations present
      if ([".ts", ".tsx"].includes(ext)) {
        const typedFns = lines.filter((l) =>
          /:\s*(string|number|boolean|void|Promise|Record|Array|Map|Set)\b/.test(l),
        ).length;
        if (typedFns > 3) {
          praise.push(`Good use of TypeScript type annotations (${typedFns} typed declarations found).`);
        }
      }

      // Has tests nearby or in file
      const hasTests = lines.some((l) => /\b(describe|it|test|expect)\s*\(/.test(l));
      if (hasTests) {
        praise.push("File contains test assertions — good practice.");
      }

      // JSDoc / TSDoc
      const docBlocks = lines.filter((l) => /^\s*\*/.test(l)).length;
      if (docBlocks > 5) {
        praise.push(`Well documented — ${docBlocks} JSDoc/TSDoc comment lines found.`);
      }

      if (concerns.length === 0) {
        sections.push("### Concerns\nNone found.");
      } else {
        sections.push("### Concerns");
        sections.push(concerns.map((c) => `- ${c}`).join("\n"));
      }

      if (suggestions.length === 0) {
        sections.push("\n### Suggestions\nNone.");
      } else {
        sections.push("\n### Suggestions");
        sections.push(suggestions.map((s) => `- ${s}`).join("\n"));
      }

      if (praise.length === 0) {
        sections.push("\n### Praise\nNothing specific to highlight.");
      } else {
        sections.push("\n### Praise");
        sections.push(praise.map((p) => `- ${p}`).join("\n"));
      }
    }

    return textResult(sections.join("\n"));
  },
};

// ── debug_analyze ─────────────────────────────────────────────────────────────

export const debugAnalyzeTool: PiTool = {
  name: "debug_analyze",
  label: "Debug Analyzer",
  description:
    "Takes an error message and optional stack trace, reads relevant source files, and returns a root cause analysis.",
  parameters: Type.Object({
    error_message: Type.String({ description: "The error message." }),
    stack_trace: Type.Optional(
      Type.String({ description: "Full stack trace text." }),
    ),
    files: Type.Optional(
      Type.Array(Type.String(), {
        description: "Additional source files to read for context.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { error_message, stack_trace, files } = input as {
      error_message: string;
      stack_trace?: string;
      files?: string[];
    };

    const sections: string[] = [];
    sections.push("# Debug Analysis\n");
    sections.push(`**Error**: ${error_message}\n`);

    // Parse stack frames
    const frames: Array<{ file: string; line: number; col?: number }> = [];
    if (stack_trace) {
      const frameRe = /at\s+(?:\S+\s+\()?([^():]+):(\d+)(?::(\d+))?\)?/g;
      let m;
      while ((m = frameRe.exec(stack_trace)) !== null) {
        const [, file, lineStr, colStr] = m;
        if (!file.includes("node_modules") && !file.includes("node:")) {
          frames.push({
            file: file.trim(),
            line: parseInt(lineStr, 10),
            col: colStr ? parseInt(colStr, 10) : undefined,
          });
        }
      }
    }

    // Classify error
    sections.push("## Error Classification");
    const msg = error_message.toLowerCase();
    let classification = "Runtime Error";
    if (/typeerror/i.test(error_message)) classification = "TypeError — likely null/undefined access or wrong type passed";
    else if (/referenceerror/i.test(error_message)) classification = "ReferenceError — variable used before declaration";
    else if (/syntaxerror/i.test(error_message)) classification = "SyntaxError — malformed code or JSON";
    else if (/rangeerror/i.test(error_message)) classification = "RangeError — value out of allowable range";
    else if (/enoent/i.test(error_message)) classification = "ENOENT — file or directory not found";
    else if (/econnrefused/i.test(error_message)) classification = "ECONNREFUSED — network connection refused";
    else if (/timeout/i.test(msg)) classification = "Timeout — operation exceeded allowed time";
    else if (/cannot read prop/i.test(msg) || /cannot read properties/i.test(msg))
      classification = "Null/undefined property access";
    sections.push(`- **Type**: ${classification}\n`);

    // Stack analysis
    if (frames.length > 0) {
      sections.push("## Stack Frame Analysis");
      sections.push("Most likely call sites (user code only):\n");
      for (const frame of frames.slice(0, 5)) {
        sections.push(`- \`${frame.file}\` line ${frame.line}${frame.col ? `:${frame.col}` : ""}`);

        // Try to read the file and show context
        try {
          const content = await readFile(frame.file, "utf-8");
          const lines = content.split("\n");
          const start = Math.max(0, frame.line - 3);
          const end = Math.min(lines.length - 1, frame.line + 2);
          const snippet = lines
            .slice(start, end + 1)
            .map((l, i) => {
              const lineNum = start + i + 1;
              const marker = lineNum === frame.line ? ">>>" : "   ";
              return `  ${marker} ${lineNum.toString().padStart(4)} | ${l}`;
            })
            .join("\n");
          sections.push("  ```");
          sections.push(snippet);
          sections.push("  ```");
        } catch {
          // file not accessible, skip
        }
      }
    }

    // Read additional context files
    if (files && files.length > 0) {
      sections.push("\n## Additional Context Files");
      for (const f of files) {
        const content = await readFileSafe(f);
        const lineCount = content.split("\n").length;
        sections.push(`\n### \`${f}\` (${lineCount} lines)`);
        // Show first 50 lines for context
        const preview = content.split("\n").slice(0, 50).join("\n");
        sections.push("```");
        sections.push(preview);
        if (lineCount > 50) sections.push(`... (${lineCount - 50} more lines)`);
        sections.push("```");
      }
    }

    // Root cause hypothesis
    sections.push("\n## Root Cause Hypothesis");
    const hypotheses: string[] = [];

    if (/cannot read prop/i.test(msg) || /cannot read properties/i.test(msg)) {
      hypotheses.push("An object is `null` or `undefined` at the point of property access. Check that all async data fetches are awaited and guarded before use.");
    }
    if (/is not a function/i.test(msg)) {
      hypotheses.push("A method is being called on a value that is not a function. Verify the import/export names match and the correct module is imported.");
    }
    if (/enoent/i.test(msg)) {
      hypotheses.push("A file path is constructed incorrectly or a required file is missing. Verify the path is absolute or resolved relative to the correct base directory.");
    }
    if (/econnrefused/i.test(msg)) {
      hypotheses.push("A service dependency (database, API, etc.) is not running or not reachable. Check that all required services are started and the connection config is correct.");
    }
    if (hypotheses.length === 0) {
      hypotheses.push("Review the stack frames above and check the highlighted lines for unexpected `null`/`undefined` values, missing await, or incorrect variable scoping.");
    }

    sections.push(hypotheses.map((h) => `- ${h}`).join("\n"));

    sections.push("\n## Suggested Next Steps");
    sections.push(
      "1. Add a breakpoint or `console.log` at the highlighted stack frame.\n" +
      "2. Inspect the values of all variables involved in the failing expression.\n" +
      "3. Confirm all async operations complete before the failing line.\n" +
      "4. Check recent git changes in the affected file(s) for regressions.",
    );

    return textResult(sections.join("\n"));
  },
};

// ── architecture_review ───────────────────────────────────────────────────────

export const architectureReviewTool: PiTool = {
  name: "architecture_review",
  label: "Architecture Review",
  description:
    "Scans a directory structure and returns an architecture summary with observations and recommendations.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Root directory to scan (absolute or cwd-relative).",
    }),
    max_depth: Type.Optional(
      Type.Number({
        description: "Maximum directory depth to walk. Default 4.",
        minimum: 1,
        maximum: 10,
      }),
    ),
  }),

  async execute(_id, input) {
    const { directory, max_depth = 4 } = input as {
      directory: string;
      max_depth?: number;
    };

    const sections: string[] = [];
    sections.push(`# Architecture Review: \`${directory}\`\n`);

    // Build tree
    const treeLines: string[] = [];
    await walkDir(directory, 0, max_depth, treeLines);

    sections.push("## Directory Structure");
    sections.push("```");
    sections.push(treeLines.slice(0, 200).join("\n"));
    if (treeLines.length > 200) sections.push(`... (${treeLines.length - 200} more entries)`);
    sections.push("```\n");

    // Gather metrics
    const allFiles = treeLines.filter((l) => !l.endsWith("/"));
    const allDirs = treeLines.filter((l) => l.endsWith("/"));

    const extCounts: Record<string, number> = {};
    for (const f of allFiles) {
      const ext = extname(f.trim()) || "(no ext)";
      extCounts[ext] = (extCounts[ext] ?? 0) + 1;
    }

    sections.push("## File Composition");
    const extTable = Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `- \`${ext}\`: ${count} file(s)`)
      .join("\n");
    sections.push(extTable + "\n");

    // Check for common config files
    const rootFiles = new Set(
      (await readdir(directory).catch(() => [] as string[])).map((f) => f.toLowerCase()),
    );

    const checks: Array<{ file: string; meaning: string }> = [
      { file: "package.json", meaning: "Node.js project" },
      { file: "tsconfig.json", meaning: "TypeScript configured" },
      { file: "cargo.toml", meaning: "Rust project" },
      { file: "pyproject.toml", meaning: "Python project" },
      { file: "go.mod", meaning: "Go module" },
      { file: "dockerfile", meaning: "Docker containerized" },
      { file: "docker-compose.yml", meaning: "Multi-container Docker" },
      { file: ".github", meaning: "GitHub Actions CI/CD" },
      { file: "jest.config.js", meaning: "Jest testing" },
      { file: "vitest.config.ts", meaning: "Vitest testing" },
      { file: "eslint.config.js", meaning: "ESLint configured" },
      { file: ".eslintrc.json", meaning: "ESLint configured" },
      { file: "readme.md", meaning: "README present" },
      { file: "license", meaning: "LICENSE present" },
      { file: "security.md", meaning: "SECURITY policy present" },
    ];

    const detected = checks.filter((c) => rootFiles.has(c.file));
    sections.push("## Detected Technologies");
    if (detected.length > 0) {
      sections.push(detected.map((d) => `- ${d.meaning} (\`${d.file}\`)`).join("\n"));
    } else {
      sections.push("No standard config files detected in root.\n");
    }
    sections.push("");

    // Architecture pattern heuristics
    sections.push("## Architecture Observations");
    const observations: string[] = [];

    const hasSrc = treeLines.some((l) => l.trim().startsWith("src/") || l.trim() === "src/");
    const hasTests = treeLines.some((l) => /test|spec|__tests__/.test(l.toLowerCase()));
    const hasTypes = treeLines.some((l) => /types\.ts|types\//.test(l));
    const hasDomains = treeLines.some((l) => /domain/.test(l.toLowerCase()));
    const hasServices = treeLines.some((l) => /service/.test(l.toLowerCase()));
    const hasControllers = treeLines.some((l) => /controller/.test(l.toLowerCase()));
    const hasMiddleware = treeLines.some((l) => /middleware/.test(l.toLowerCase()));

    if (hasSrc) observations.push("Follows `src/` layout convention.");
    if (hasTests) observations.push("Test files detected — good test hygiene.");
    else observations.push("WARNING: No test files detected — consider adding tests.");
    if (hasTypes) observations.push("Shared type definitions detected.");
    if (hasDomains) observations.push("Domain-driven structure detected.");
    if (hasServices && hasControllers) observations.push("MVC-style or layered architecture (services + controllers).");
    if (hasMiddleware) observations.push("Middleware layer present.");

    if (allDirs.length > 30) {
      observations.push(`High directory count (${allDirs.length}) — may indicate over-decomposition.`);
    }
    if (allFiles.length > 500) {
      observations.push(`Large codebase (${allFiles.length} files) — ensure module boundaries are well-defined.`);
    }

    sections.push(observations.map((o) => `- ${o}`).join("\n"));

    // Recommendations
    sections.push("\n## Recommendations");
    const recs: string[] = [];

    if (!rootFiles.has("readme.md")) recs.push("Add a `README.md` with project overview, setup, and usage instructions.");
    if (!rootFiles.has("license")) recs.push("Add a `LICENSE` file.");
    if (!hasTests) recs.push("Add a test suite — even a minimal smoke test improves confidence.");
    if (!rootFiles.has("tsconfig.json") && extCounts[".ts"]) {
      recs.push("TypeScript files found but no `tsconfig.json` — add one for proper compilation.");
    }
    if (recs.length === 0) recs.push("No critical recommendations — architecture looks healthy.");

    sections.push(recs.map((r) => `- ${r}`).join("\n"));

    return textResult(sections.join("\n"));
  },
};

// ── generate_docs ──────────────────────────────────────────────────────────────

export const generateDocsTool: PiTool = {
  name: "generate_docs",
  label: "Generate Documentation",
  description:
    "Reads a source file and generates JSDoc/TSDoc documentation for all exported functions, classes, and interfaces.",
  parameters: Type.Object({
    file: Type.String({
      description: "Path to the source file to document.",
    }),
    format: Type.Optional(
      Type.Union([Type.Literal("jsdoc"), Type.Literal("tsdoc")], {
        description: "Documentation format. Default: tsdoc.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { file, format = "tsdoc" } = input as {
      file: string;
      format?: "jsdoc" | "tsdoc";
    };

    const source = await readFileSafe(file);
    if (source.startsWith("[could not read")) {
      return textResult(`Error: ${source}`);
    }

    const lines = source.split("\n");
    const sections: string[] = [];
    sections.push(`# Documentation for \`${file}\``);
    sections.push(`Format: **${format.toUpperCase()}**\n`);

    // Extract exported symbols
    type SymbolEntry = {
      kind: string;
      name: string;
      line: number;
      signature: string;
      params: string[];
      returnType?: string;
    };

    const symbols: SymbolEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // exported function
      const fnMatch = line.match(
        /^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(.+?))?(?:\s*\{|$)/,
      );
      if (fnMatch) {
        const [, name, paramsStr, ret] = fnMatch;
        const params = paramsStr
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        symbols.push({ kind: "function", name, line: i + 1, signature: line.trim(), params, returnType: ret?.trim() });
        continue;
      }

      // exported const arrow function
      const arrowMatch = line.match(
        /^export\s+const\s+(\w+)\s*(?::\s*\S+)?\s*=\s*(?:async\s+)?\(([^)]*)\)(?:\s*:\s*(.+?))?\s*=>/,
      );
      if (arrowMatch) {
        const [, name, paramsStr, ret] = arrowMatch;
        const params = paramsStr
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        symbols.push({ kind: "arrow function", name, line: i + 1, signature: line.trim(), params, returnType: ret?.trim() });
        continue;
      }

      // exported interface
      const ifaceMatch = line.match(/^export\s+interface\s+(\w+)/);
      if (ifaceMatch) {
        symbols.push({ kind: "interface", name: ifaceMatch[1], line: i + 1, signature: line.trim(), params: [] });
        continue;
      }

      // exported type
      const typeMatch = line.match(/^export\s+type\s+(\w+)/);
      if (typeMatch) {
        symbols.push({ kind: "type", name: typeMatch[1], line: i + 1, signature: line.trim(), params: [] });
        continue;
      }

      // exported class
      const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ kind: "class", name: classMatch[1], line: i + 1, signature: line.trim(), params: [] });
        continue;
      }
    }

    if (symbols.length === 0) {
      sections.push("No exported symbols found in this file.");
      return textResult(sections.join("\n"));
    }

    sections.push(`Found **${symbols.length}** exported symbol(s).\n`);

    for (const sym of symbols) {
      sections.push(`---\n\n### \`${sym.name}\` (${sym.kind}) — line ${sym.line}`);

      if (format === "tsdoc") {
        sections.push("```typescript");
        // Build TSDoc comment
        const docLines: string[] = ["/**"];
        docLines.push(` * ${sym.name} — ${sym.kind}.`);
        docLines.push(` *`);
        if (sym.kind === "function" || sym.kind === "arrow function") {
          docLines.push(` * @description TODO: describe what this ${sym.kind} does.`);
          docLines.push(` *`);
          for (const p of sym.params) {
            const pname = p.split(":")[0].replace(/^\?/, "").trim();
            const ptype = p.split(":")[1]?.trim() ?? "unknown";
            docLines.push(` * @param ${pname} - ${ptype} TODO`);
          }
          if (sym.returnType) {
            docLines.push(` * @returns ${sym.returnType} TODO`);
          } else {
            docLines.push(` * @returns TODO`);
          }
        } else if (sym.kind === "interface" || sym.kind === "type") {
          docLines.push(` * @description TODO: describe this ${sym.kind}.`);
        } else if (sym.kind === "class") {
          docLines.push(` * @description TODO: describe this class.`);
          docLines.push(` * @example`);
          docLines.push(` * const instance = new ${sym.name}();`);
        }
        docLines.push(` */`);
        docLines.push(sym.signature);
        sections.push(docLines.join("\n"));
        sections.push("```");
      } else {
        // JSDoc format
        sections.push("```javascript");
        const docLines: string[] = ["/**"];
        docLines.push(` * ${sym.name} — ${sym.kind}.`);
        if (sym.kind === "function" || sym.kind === "arrow function") {
          for (const p of sym.params) {
            const pname = p.split(":")[0].replace(/^\?/, "").trim();
            docLines.push(` * @param {*} ${pname} - TODO`);
          }
          docLines.push(` * @returns {*} TODO`);
        }
        docLines.push(` */`);
        docLines.push(sym.signature);
        sections.push(docLines.join("\n"));
        sections.push("```");
      }
    }

    return textResult(sections.join("\n"));
  },
};
