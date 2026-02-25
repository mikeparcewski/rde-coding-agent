/**
 * Tests for memory context injection via the cross-domain assembler.
 *
 * Verifies that memory entries are properly formatted and injected,
 * and that the assembler handles various memory store states correctly.
 * (Migrated from legacy memory hooks to assembler-based injection.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  appendFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { registerContextAssembler } from "../src/context/assembler.js";
import type { ResolvedConfig } from "../src/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const hooks = new Map<string, any[]>();
  const pi = {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: (event: string, handler: any) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
  };
  return { pi, hooks };
}

function makeMockCtx() {
  return {
    ui: { confirm: vi.fn(), showMessage: vi.fn() },
    session: { id: "test-session-1", cwd: "/tmp/test" },
    getModel: vi.fn(),
  };
}

function makeConfig(storeRegistry?: Map<string, unknown>): ResolvedConfig {
  return {
    storePath: "/tmp/test-store",
    guardrails: true,
    capabilities: new Set(["memory"]),
    storeRegistry: storeRegistry ?? new Map(),
  };
}

function makeMemoryStore(entries: any[] = []) {
  return {
    recall: vi.fn().mockResolvedValue(entries),
    readAll: vi.fn().mockResolvedValue(entries),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("memory context injection via assembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("multiple memories are formatted as typed entries with tags", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    registry.set("memory", makeMemoryStore([
      { id: "m1", content: "first memory", type: "decision", importance: "high", tags: ["arch"] },
      { id: "m2", content: "second memory", type: "procedural", importance: "medium", tags: [] },
      { id: "m3", content: "third memory", type: "episodic", importance: "low", tags: ["debug", "test"] },
    ]));

    registerContextAssembler(pi as any, makeConfig(registry));

    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    await contextHandlers[0]!(
      {
        messages: [{ role: "user", content: "test query" }],
        injectSystemMessage: (msg: string) => { injectedMessage = msg; },
      },
      makeMockCtx(),
    );

    expect(injectedMessage).toContain("## Memory");
    expect(injectedMessage).toContain("first memory");
    expect(injectedMessage).toContain("second memory");
    expect(injectedMessage).toContain("third memory");
    // Check formatting includes type/importance
    expect(injectedMessage).toContain("[decision/high]");
    expect(injectedMessage).toContain("[arch]");
  });

  it("recall is called with the last user message for relevance", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    const memStore = makeMemoryStore([]);
    registry.set("memory", memStore);

    registerContextAssembler(pi as any, makeConfig(registry));

    const contextHandlers = hooks.get("context")!;
    await contextHandlers[0]!(
      {
        messages: [
          { role: "user", content: "first message" },
          { role: "assistant", content: "reply" },
          { role: "user", content: "search for memories" },
        ],
        injectSystemMessage: vi.fn(),
      },
      makeMockCtx(),
    );

    expect(memStore.recall).toHaveBeenCalledWith("search for memories", { limit: 20 });
  });

  it("skips injection when no memories are available", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    registry.set("memory", makeMemoryStore([]));

    registerContextAssembler(pi as any, makeConfig(registry));

    const contextHandlers = hooks.get("context")!;
    let called = false;
    await contextHandlers[0]!(
      {
        messages: [{ role: "user", content: "test" }],
        injectSystemMessage: () => { called = true; },
      },
      makeMockCtx(),
    );

    expect(called).toBe(false);
  });
});
