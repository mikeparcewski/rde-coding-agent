/**
 * Tests for the Memory domain: MemoryStore and memory tool registration.
 *
 * Uses vi.mock('node:fs/promises') to avoid real file I/O.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  appendFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from "node:fs/promises";
import { MemoryStore } from "../src/domains/memory/store.js";
import { registerMemoryTools } from "../src/domains/memory/tools.js";
import { registerMemoryHooks } from "../src/domains/memory/hooks.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const hooks = new Map<string, any[]>();

  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, handler: any) => commands.set(name, handler),
    on: (event: string, handler: any) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
    ai: { streamSimple: vi.fn() },
  };

  return { pi, tools, commands, hooks };
}

function makeCtx(overrides?: Record<string, any>) {
  return {
    ui: {
      confirm: vi.fn().mockResolvedValue(true),
      showMessage: vi.fn(),
    },
    session: { id: "sess-001", cwd: "/tmp/test-project" },
    getModel: vi.fn().mockResolvedValue({ id: "test", provider: "test" }),
    ...overrides,
  };
}

function makeDummyEntry(id = "entry-001", content = "test content") {
  return {
    schemaVersion: 1 as const,
    id,
    content,
    type: "episodic" as const,
    tags: ["tag1"],
    importance: "medium" as const,
    createdAt: new Date().toISOString(),
    accessCount: 0,
    projectId: null,
    sessionId: "sess-001",
  };
}

// ── MemoryStore tests ──────────────────────────────────────────────────────────

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: file doesn't exist (empty store)
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    store = new MemoryStore("/tmp/test-store");
  });

  describe("remember and recall round-trip", () => {
    it("appends entry and recalls it back via text search", async () => {
      // After remember, readFile returns the appended entry
      let storedContent = "";

      vi.mocked(fs.appendFile).mockImplementation(async (_path, data) => {
        storedContent += data;
      });

      vi.mocked(fs.readFile).mockImplementation(async () => {
        if (!storedContent) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return storedContent as never;
      });

      const entry = await store.remember("use TypeScript for type safety");
      expect(entry.id).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
      expect(entry.content).toBe("use TypeScript for type safety");

      const results = await store.recall("TypeScript");
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe("use TypeScript for type safety");
    });

    it("remember assigns a UUID id and ISO createdAt timestamp", async () => {
      const entry = await store.remember("some fact");
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(() => new Date(entry.createdAt)).not.toThrow();
      expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt);
    });
  });

  describe("recall filtering", () => {
    beforeEach(() => {
      // Set up store with multiple entries
      const entries = [
        {
          schemaVersion: 1,
          id: "mem-1",
          content: "use React for frontend",
          type: "decision",
          tags: ["frontend", "react"],
          importance: "high",
          createdAt: "2024-01-01T00:00:00.000Z",
          accessCount: 0,
          projectId: "proj-alpha",
          sessionId: "sess-001",
        },
        {
          schemaVersion: 1,
          id: "mem-2",
          content: "prefer async/await over callbacks",
          type: "procedural",
          tags: ["async", "javascript"],
          importance: "medium",
          createdAt: "2024-01-02T00:00:00.000Z",
          accessCount: 0,
          projectId: null, // global memory
          sessionId: "sess-001",
        },
        {
          schemaVersion: 1,
          id: "mem-3",
          content: "database uses PostgreSQL",
          type: "episodic",
          tags: ["database", "backend"],
          importance: "medium",
          createdAt: "2024-01-03T00:00:00.000Z",
          accessCount: 0,
          projectId: "proj-beta",
          sessionId: "sess-002",
        },
      ];
      const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      vi.mocked(fs.readFile).mockResolvedValue(content as never);
    });

    it("filters by tags — only entries with matching tag returned", async () => {
      const results = await store.recall("", { tags: ["frontend"] });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("mem-1");
    });

    it("filters by type — only entries of that type returned", async () => {
      const results = await store.recall("", { type: "procedural" });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("mem-2");
    });

    it("filters by projectId — includes project entries AND global (projectId: null)", async () => {
      const results = await store.recall("", { projectId: "proj-alpha" });
      // mem-1 (proj-alpha) + mem-2 (global/null) should both appear
      const ids = results.map((r) => r.id);
      expect(ids).toContain("mem-1");
      expect(ids).toContain("mem-2");
      // mem-3 (proj-beta) should NOT appear
      expect(ids).not.toContain("mem-3");
    });

    it("excludes entries from a different project", async () => {
      const results = await store.recall("", { projectId: "proj-alpha" });
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain("mem-3");
    });

    it("text search matches against content (case-insensitive)", async () => {
      const results = await store.recall("react");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("mem-1");
    });

    it("text search matches against tags", async () => {
      const results = await store.recall("database");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("mem-3");
    });
  });

  describe("forget", () => {
    it("removes entry by id via deleteById", async () => {
      const entry = makeDummyEntry("del-001");
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(entry) + "\n") as never,
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await store.forget("del-001");
      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("returns false for unknown id", async () => {
      const entry = makeDummyEntry("known-id");
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(entry) + "\n") as never,
      );

      const result = await store.forget("nonexistent");
      expect(result).toBe(false);
    });
  });
});

// ── Memory tool registration ────────────────────────────────────────────────────

describe("registerMemoryTools", () => {
  it("registers remember, recall, and forget tools", () => {
    const { pi, tools } = makeMockPi();
    const store = new MemoryStore("/tmp/test");
    registerMemoryTools(pi as any, store);

    expect(tools.has("remember")).toBe(true);
    expect(tools.has("recall")).toBe(true);
    expect(tools.has("forget")).toBe(true);
  });

  it("remember tool execute stores and returns entry metadata", async () => {
    const { pi, tools } = makeMockPi();
    const store = new MemoryStore("/tmp/test");
    registerMemoryTools(pi as any, store);

    const rememberTool = tools.get("remember")!;
    const signal = new AbortController().signal;
    const result = await rememberTool.execute(
      "call-1",
      { content: "use vitest for testing", type: "decision", tags: ["testing"] },
      signal,
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.stored).toBe(true);
    expect(parsed.id).toBeTruthy();
    expect(parsed.type).toBe("decision");
    expect(parsed.tags).toEqual(["testing"]);
  });

  it("recall tool execute returns entries array", async () => {
    const { pi, tools } = makeMockPi();

    // Set up a store with one entry
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    const store = new MemoryStore("/tmp/test");
    registerMemoryTools(pi as any, store);

    const recallTool = tools.get("recall")!;
    const signal = new AbortController().signal;
    const result = await recallTool.execute(
      "call-2",
      { query: "anything" },
      signal,
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(typeof parsed.count).toBe("number");
  });
});

// ── Memory hooks registration ─────────────────────────────────────────────────

describe("registerMemoryHooks", () => {
  it("registers session_start and session_shutdown hooks (context handled by assembler)", () => {
    const { pi, hooks } = makeMockPi();
    const store = new MemoryStore("/tmp/test");
    registerMemoryHooks(pi as any, store);

    expect(hooks.has("session_start")).toBe(true);
    expect(hooks.has("session_shutdown")).toBe(true);
    // Context injection moved to cross-domain assembler (src/context/assembler.ts)
    expect(hooks.has("context")).toBe(false);
  });

  it("session_start initializes session state with project detection", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const { pi, hooks } = makeMockPi();
    const store = new MemoryStore("/tmp/test");
    registerMemoryHooks(pi as any, store);

    const ctx = makeCtx();

    // Should not throw even when no .pi/project file exists
    await hooks.get("session_start")![0]!(
      { sessionId: "sess-001", cwd: "/tmp/test-project" },
      ctx,
    );
  });

  it("session_shutdown clears session state without error", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const { pi, hooks } = makeMockPi();
    const store = new MemoryStore("/tmp/test");
    registerMemoryHooks(pi as any, store);

    const ctx = makeCtx();

    // Start session
    await hooks.get("session_start")![0]!(
      { sessionId: "sess-001", cwd: "/tmp" },
      ctx,
    );

    // Shutdown should not throw
    await hooks.get("session_shutdown")![0]!({}, ctx);
  });
});
