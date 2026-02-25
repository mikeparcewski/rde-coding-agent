/**
 * Tests for the Patch domain (AC-5).
 *
 * Verifies tool registration, parameter schemas, and path safety.
 */

import { describe, it, expect, vi } from "vitest";
import { registerPatchTools } from "../src/domains/patch/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: vi.fn(),
  };
  return { pi, tools };
}

// ── Tool Registration ───────────────────────────────────────────────────────

describe("registerPatchTools — registration", () => {
  it("registers rename_symbol tool", () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);
    expect(tools.has("rename_symbol")).toBe(true);
  });

  it("registers remove_symbol tool", () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);
    expect(tools.has("remove_symbol")).toBe(true);
  });

  it("rename_symbol has old_name, new_name, paths, file_glob parameters", () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    const tool = tools.get("rename_symbol")!;
    expect(tool.parameters.properties).toHaveProperty("old_name");
    expect(tool.parameters.properties).toHaveProperty("new_name");
    expect(tool.parameters.properties).toHaveProperty("paths");
    expect(tool.parameters.properties).toHaveProperty("file_glob");
  });

  it("remove_symbol has symbol, paths, file_glob parameters", () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    const tool = tools.get("remove_symbol")!;
    expect(tool.parameters.properties).toHaveProperty("symbol");
    expect(tool.parameters.properties).toHaveProperty("paths");
    expect(tool.parameters.properties).toHaveProperty("file_glob");
  });

  it("tools have name, label, description, and execute function", () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    for (const toolName of ["rename_symbol", "remove_symbol"]) {
      const tool = tools.get(toolName)!;
      expect(tool.name).toBe(toolName);
      expect(typeof tool.label).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
    }
  });
});

// ── Path Safety ────────────────────────────────────────────────────────────

describe("patch tools — path safety", () => {
  it("rename_symbol rejects absolute paths", async () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    const tool = tools.get("rename_symbol")!;
    const signal = new AbortController().signal;

    await expect(
      tool.execute(
        "id",
        { old_name: "foo", new_name: "bar", paths: ["/etc/secret"] },
        signal,
      ),
    ).rejects.toThrow("Unsafe path");
  });

  it("rename_symbol rejects parent traversal paths", async () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    const tool = tools.get("rename_symbol")!;
    const signal = new AbortController().signal;

    await expect(
      tool.execute(
        "id",
        { old_name: "foo", new_name: "bar", paths: ["../../secret"] },
        signal,
      ),
    ).rejects.toThrow("Unsafe path");
  });

  it("remove_symbol rejects tilde paths", async () => {
    const { pi, tools } = makeMockPi();
    registerPatchTools(pi as any);

    const tool = tools.get("remove_symbol")!;
    const signal = new AbortController().signal;

    await expect(
      tool.execute(
        "id",
        { symbol: "foo", paths: ["~/.ssh/keys"] },
        signal,
      ),
    ).rejects.toThrow("Unsafe path");
  });
});
