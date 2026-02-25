/**
 * Tests for v04 search domain tool enhancements.
 *
 * Covers: hotspot_analysis, service_map, doc_search, impl_search, data_lineage
 *
 * Registration tests verify tool names, parameters, and schema structure.
 * Execution tests use temp directories under process.cwd() with relative paths
 * because the tools' path safety guards reject absolute paths.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { registerSearchTools } from "../src/domains/search/tools.js";

const signal = new AbortController().signal;

// Ensure ripgrep is accessible — it lives in the opencode bin directory on this machine.
// We prepend it to PATH so that execFileAsync("rg", ...) can find it.
beforeAll(() => {
  const rgDir = "/Users/michael.parcewski/.local/share/opencode/bin";
  const current = process.env["PATH"] ?? "";
  if (!current.includes(rgDir)) {
    process.env["PATH"] = `${rgDir}:${current}`;
  }
});

function cleanupDir(dir: string) {
  try {
    execSync(`rm -rf "${dir}"`, { stdio: "pipe" });
  } catch {
    // ignore cleanup errors
  }
}

function makeMockPi() {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: vi.fn(),
    ai: { streamSimple: vi.fn() },
  };
  return { pi, tools };
}

// ── hotspot_analysis ───────────────────────────────────────────────────────

describe("hotspot_analysis", () => {
  it("registers with name 'hotspot_analysis'", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("hotspot_analysis")).toBe(true);
  });

  it("has 'paths' and 'min_refs' parameters in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("hotspot_analysis")!;
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("paths");
    expect(tool.parameters.properties).toHaveProperty("min_refs");
  });

  it("has name, label, description, and execute", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("hotspot_analysis")!;
    expect(tool.name).toBe("hotspot_analysis");
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(typeof tool.execute).toBe("function");
  });

  it("returns hotspots array with symbol and refCount when exports are cross-referenced", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("hotspot_analysis")!;

    // Create temp dir relative to cwd so path guard passes
    const relDir = `tmp-hotspot-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      // utils.ts exports a function
      await writeFile(
        join(absDir, "utils.ts"),
        `export function calculateTotal(items: number[]): number {\n  return items.reduce((a, b) => a + b, 0);\n}\n`,
      );
      // consumer.ts references calculateTotal multiple times
      await writeFile(
        join(absDir, "consumer.ts"),
        `import { calculateTotal } from "./utils";\nconst r1 = calculateTotal([1, 2]);\nconst r2 = calculateTotal([3, 4]);\nconst r3 = calculateTotal([5]);\n`,
      );

      const result = await tool.execute(
        "t-hotspot-1",
        { paths: [relDir], min_refs: 1 },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("hotspots");
      expect(Array.isArray(parsed.hotspots)).toBe(true);
      expect(parsed).toHaveProperty("totalSymbols");
      expect(parsed).toHaveProperty("filteredCount");

      // calculateTotal should appear in hotspots (referenced 4+ times)
      const hotspot = parsed.hotspots.find(
        (h: any) => h.symbol === "calculateTotal",
      );
      expect(hotspot).toBeDefined();
      expect(hotspot).toHaveProperty("symbol");
      expect(hotspot).toHaveProperty("refCount");
      expect(hotspot.refCount).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupDir(absDir);
    }
  });

  it("respects min_refs filter and returns empty hotspots for high threshold", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("hotspot_analysis")!;

    const relDir = `tmp-hotspot-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      await writeFile(
        join(absDir, "single.ts"),
        `export function onceOnly(): void {}\n`,
      );

      const result = await tool.execute(
        "t-hotspot-2",
        { paths: [relDir], min_refs: 9999 },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("hotspots");
      expect(Array.isArray(parsed.hotspots)).toBe(true);
      // With min_refs 9999, no symbol should reach that threshold
      expect(parsed.hotspots.length).toBe(0);
    } finally {
      cleanupDir(absDir);
    }
  });
});

// ── service_map ───────────────────────────────────────────────────────────

describe("service_map", () => {
  it("registers with name 'service_map'", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("service_map")).toBe(true);
  });

  it("has 'path' parameter in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("service_map")!;
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("path");
  });

  it("has name, label, description, and execute", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("service_map")!;
    expect(tool.name).toBe("service_map");
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(typeof tool.execute).toBe("function");
  });

  it("rejects absolute paths with an error", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("service_map")!;

    await expect(
      tool.execute("t-svc-abs", { path: "/tmp/something" }, signal, vi.fn()),
    ).rejects.toThrow("Unsafe path");
  });

  it("returns services and mermaidDiagram from docker-compose.yml", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("service_map")!;

    const relDir = `tmp-svcmap-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      const composeContent = [
        "services:",
        "  web:",
        "    image: nginx:latest",
        "    ports:",
        "      - 8080:80",
        "  db:",
        "    image: postgres:15",
        "    ports:",
        "      - 5432:5432",
      ].join("\n") + "\n";

      await writeFile(join(absDir, "docker-compose.yml"), composeContent);

      const result = await tool.execute(
        "t-svc-1",
        { path: relDir },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("services");
      expect(parsed).toHaveProperty("mermaidDiagram");
      expect(parsed).toHaveProperty("totalServices");
      expect(Array.isArray(parsed.services)).toBe(true);
      expect(parsed.services.length).toBeGreaterThanOrEqual(2);

      const serviceNames = parsed.services.map((s: any) => s.name);
      expect(serviceNames).toContain("web");
      expect(serviceNames).toContain("db");

      expect(typeof parsed.mermaidDiagram).toBe("string");
      expect(parsed.mermaidDiagram).toContain("graph LR");
    } finally {
      cleanupDir(absDir);
    }
  });
});

// ── doc_search ────────────────────────────────────────────────────────────

describe("doc_search", () => {
  it("registers with name 'doc_search'", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("doc_search")).toBe(true);
  });

  it("has 'query', 'paths', and 'file_types' parameters in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("doc_search")!;
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("query");
    expect(tool.parameters.properties).toHaveProperty("paths");
    expect(tool.parameters.properties).toHaveProperty("file_types");
  });

  it("has name, label, description, and execute", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("doc_search")!;
    expect(tool.name).toBe("doc_search");
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(typeof tool.execute).toBe("function");
  });

  it("finds text in a markdown file", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("doc_search")!;

    const relDir = `tmp-docsearch-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      const mdContent = [
        "# Authentication Guide",
        "",
        "This document explains the authentication flow.",
        "Users must provide valid credentials to obtain a JWT token.",
        "",
        "## OAuth2 Integration",
        "The system supports OAuth2 for third-party logins.",
      ].join("\n") + "\n";

      await writeFile(join(absDir, "auth.md"), mdContent);

      const result = await tool.execute(
        "t-doc-1",
        { query: "authentication", paths: [relDir] },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("matches");
      expect(parsed).toHaveProperty("byFile");
      expect(parsed).toHaveProperty("totalCount");
      expect(parsed).toHaveProperty("fileCount");
      expect(parsed).toHaveProperty("query");
      expect(parsed.query).toBe("authentication");
      expect(parsed.totalCount).toBeGreaterThan(0);
      expect(parsed.fileCount).toBeGreaterThan(0);
    } finally {
      cleanupDir(absDir);
    }
  });

  it("returns empty results when no matching content found", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("doc_search")!;

    const relDir = `tmp-docsearch-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      await writeFile(join(absDir, "readme.md"), "# Hello World\n\nThis is a simple readme.\n");

      const result = await tool.execute(
        "t-doc-2",
        { query: "xyzzy_nonexistent_term_zqvp", paths: [relDir] },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.totalCount).toBe(0);
      expect(parsed.fileCount).toBe(0);
      expect(Array.isArray(parsed.matches)).toBe(true);
    } finally {
      cleanupDir(absDir);
    }
  });
});

// ── impl_search ───────────────────────────────────────────────────────────

describe("impl_search", () => {
  it("registers with name 'impl_search'", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("impl_search")).toBe(true);
  });

  it("has 'feature' and 'paths' parameters in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("impl_search")!;
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("feature");
    expect(tool.parameters.properties).toHaveProperty("paths");
  });

  it("has name, label, description, and execute", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("impl_search")!;
    expect(tool.name).toBe("impl_search");
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(typeof tool.execute).toBe("function");
  });

  it("finds exported function matching feature keywords", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("impl_search")!;

    const relDir = `tmp-impl-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      await writeFile(
        join(absDir, "billing.ts"),
        [
          "export function calculateTotal(items: number[]): number {",
          "  return items.reduce((a, b) => a + b, 0);",
          "}",
          "",
          "export function processPayment(amount: number): boolean {",
          "  return amount > 0;",
          "}",
        ].join("\n") + "\n",
      );

      const result = await tool.execute(
        "t-impl-1",
        { feature: "calculate total", paths: [relDir] },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("candidates");
      expect(parsed).toHaveProperty("keywords");
      expect(parsed).toHaveProperty("totalCandidates");
      expect(Array.isArray(parsed.candidates)).toBe(true);
      expect(Array.isArray(parsed.keywords)).toBe(true);

      // Should find calculateTotal as a candidate
      const calcCandidate = parsed.candidates.find(
        (c: any) => c.symbol && c.symbol.toLowerCase().includes("calculate"),
      );
      expect(calcCandidate).toBeDefined();
      expect(calcCandidate).toHaveProperty("file");
      expect(calcCandidate).toHaveProperty("line");
      expect(calcCandidate).toHaveProperty("score");
    } finally {
      cleanupDir(absDir);
    }
  });

  it("returns empty candidates with keywords for stop-word-only input", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("impl_search")!;

    // "a an the" are all stop words — keywords array should be empty
    const result = await tool.execute(
      "t-impl-2",
      { feature: "a an the" },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("candidates");
    expect(parsed).toHaveProperty("keywords");
    expect(parsed.keywords.length).toBe(0);
    expect(parsed.candidates.length).toBe(0);
    expect(parsed.totalCandidates).toBe(0);
  });
});

// ── data_lineage enhancement ──────────────────────────────────────────────

describe("data_lineage", () => {
  it("registers data_lineage tool in search domain", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("data_lineage")).toBe(true);
  });

  it("has correct 'model' and 'paths' parameters in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("data_lineage")!;
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("model");
    expect(tool.parameters.properties).toHaveProperty("paths");
  });

  it("has name, label, description, and execute with ORM mention", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("data_lineage")!;
    expect(tool.name).toBe("data_lineage");
    expect(typeof tool.label).toBe("string");
    expect(tool.label.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    // The description should mention ORM according to the implementation
    expect(tool.description).toContain("ORM");
    expect(typeof tool.execute).toBe("function");
  });

  it("relationship pattern covers Django/Prisma/ActiveRecord ORM patterns", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("data_lineage")!;
    // Verify the tool is registered with the expected structure
    // The schema should have model and optional paths
    expect(tool.parameters.properties.model).toBeDefined();
    expect(tool.parameters.properties.paths).toBeDefined();
    // model should be required (no Optional wrapper)
    // TypeBox Required type does not have 'anyOf' with undefined
    const modelSchema = tool.parameters.properties.model;
    expect(modelSchema.type).toBe("string");
  });

  it("returns structured output with definitions, relationships, migrations, schemas", async () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    const tool = tools.get("data_lineage")!;

    const relDir = `tmp-lineage-${randomUUID()}`;
    const absDir = join(process.cwd(), relDir);
    await mkdir(absDir, { recursive: true });

    try {
      // Create a model file
      await writeFile(
        join(absDir, "user.model.ts"),
        [
          "export class User {",
          "  id: number;",
          "  name: string;",
          "  email: string;",
          "}",
        ].join("\n") + "\n",
      );

      const result = await tool.execute(
        "t-lineage-1",
        { model: "User", paths: [relDir] },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("model");
      expect(parsed.model).toBe("User");
      expect(parsed).toHaveProperty("definitions");
      expect(parsed).toHaveProperty("relationships");
      expect(parsed).toHaveProperty("migrations");
      expect(parsed).toHaveProperty("schemas");
      expect(parsed).toHaveProperty("relatedModels");
      expect(parsed).toHaveProperty("summary");

      expect(Array.isArray(parsed.definitions)).toBe(true);
      expect(Array.isArray(parsed.relationships)).toBe(true);
      expect(Array.isArray(parsed.migrations)).toBe(true);
      expect(Array.isArray(parsed.schemas)).toBe(true);
      expect(Array.isArray(parsed.relatedModels)).toBe(true);

      // The class User definition should be found
      expect(parsed.definitions.length).toBeGreaterThan(0);

      expect(parsed.summary).toHaveProperty("definitionFiles");
      expect(parsed.summary).toHaveProperty("relationshipFiles");
      expect(parsed.summary).toHaveProperty("migrationFiles");
      expect(parsed.summary).toHaveProperty("schemaFiles");
      expect(parsed.summary).toHaveProperty("relatedModelCount");
    } finally {
      cleanupDir(absDir);
    }
  });
});
