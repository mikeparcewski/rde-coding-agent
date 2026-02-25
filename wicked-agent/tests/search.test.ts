/**
 * Tests for the Search domain tool registration.
 *
 * Verifies that code_search, symbol_refs, and blast_radius tools are registered
 * with correct schemas. The actual rg invocations are not tested here (no child_process mock).
 */

import { describe, it, expect, vi } from "vitest";
import { registerSearchTools } from "../src/domains/search/tools.js";

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

describe("registerSearchTools", () => {
  it("registers code_search tool", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("code_search")).toBe(true);
  });

  it("registers symbol_refs tool", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("symbol_refs")).toBe(true);
  });

  it("registers blast_radius tool", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);
    expect(tools.has("blast_radius")).toBe(true);
  });

  it("code_search tool has required 'pattern' parameter in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);

    const tool = tools.get("code_search")!;
    expect(tool.parameters).toBeDefined();
    // TypeBox schema has properties field
    expect(tool.parameters.properties).toHaveProperty("pattern");
  });

  it("symbol_refs tool has required 'symbol' parameter in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);

    const tool = tools.get("symbol_refs")!;
    expect(tool.parameters.properties).toHaveProperty("symbol");
  });

  it("blast_radius tool has required 'target' parameter in schema", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);

    const tool = tools.get("blast_radius")!;
    expect(tool.parameters.properties).toHaveProperty("target");
  });

  it("all three tools have name, label, description, and execute", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);

    for (const toolName of ["code_search", "symbol_refs", "blast_radius"]) {
      const tool = tools.get(toolName)!;
      expect(tool.name).toBe(toolName);
      expect(typeof tool.label).toBe("string");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("code_search tool has optional file_glob, case_sensitive, context_lines parameters", () => {
    const { pi, tools } = makeMockPi();
    registerSearchTools(pi as any);

    const tool = tools.get("code_search")!;
    expect(tool.parameters.properties).toHaveProperty("file_glob");
    expect(tool.parameters.properties).toHaveProperty("case_sensitive");
    expect(tool.parameters.properties).toHaveProperty("context_lines");
  });
});
