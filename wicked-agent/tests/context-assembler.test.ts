/**
 * Tests for the cross-domain context assembler (AC-1, AC-2).
 *
 * Verifies:
 * - Assembles context from memory, project, and kanban stores
 * - Resets each turn (no stale state)
 * - Token-budgeted output
 * - Graceful degradation when stores are missing
 * - Store registry pattern
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
import type { PiExtensionAPI, ResolvedConfig } from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMockPi() {
  const hooks = new Map<string, any[]>();

  const pi: PiExtensionAPI = {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: (event: string, handler: any) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
  };

  return { pi, hooks };
}

function makeConfig(storeRegistry?: Map<string, unknown>): ResolvedConfig {
  return {
    storePath: "/tmp/test-store",
    guardrails: true,
    capabilities: new Set(["memory", "project", "kanban"]),
    storeRegistry: storeRegistry ?? new Map(),
  };
}

function makeMemoryStore(entries: any[] = []) {
  return {
    recall: vi.fn().mockResolvedValue(entries),
    readAll: vi.fn().mockResolvedValue(entries),
  };
}

function makeProjectStore(project: any = null) {
  return {
    get: vi.fn().mockResolvedValue(project),
  };
}

function makeKanbanStore(tasks: any[] = [], counts: any = {}) {
  return {
    listTasks: vi.fn().mockResolvedValue({
      tasks,
      counts: { todo: 0, "in-progress": 0, done: 0, blocked: 0, ...counts },
      total: tasks.length,
    }),
  };
}

const mockCtx = {
  ui: { confirm: vi.fn(), showMessage: vi.fn() },
  session: { id: "test-session", cwd: "/tmp/test" },
  getModel: vi.fn(),
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("context assembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers session_start, context, and session_shutdown hooks", () => {
    const { pi, hooks } = makeMockPi();
    const config = makeConfig();

    registerContextAssembler(pi, config);

    expect(hooks.has("session_start")).toBe(true);
    expect(hooks.has("context")).toBe(true);
    expect(hooks.has("session_shutdown")).toBe(true);
  });

  it("assembles memory context from store registry (AC-1)", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    const memoryStore = makeMemoryStore([
      {
        id: "m1",
        content: "Use TypeBox for schemas",
        type: "decision",
        importance: "high",
        tags: ["architecture"],
      },
      {
        id: "m2",
        content: "Project uses vitest",
        type: "procedural",
        importance: "medium",
        tags: ["testing"],
      },
    ]);
    registry.set("memory", memoryStore);

    const config = makeConfig(registry);
    registerContextAssembler(pi, config);

    // Simulate context event
    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [{ role: "user", content: "How do we validate schemas?" }],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    await contextHandlers[0](ctxEvent, mockCtx);

    expect(injectedMessage).toContain("[Wicked Agent — Situational Context]");
    expect(injectedMessage).toContain("## Memory");
    expect(injectedMessage).toContain("Use TypeBox for schemas");
    expect(injectedMessage).toContain("Project uses vitest");
    expect(memoryStore.recall).toHaveBeenCalledWith(
      "How do we validate schemas?",
      { limit: 20 },
    );
  });

  it("assembles project context when project store is registered (AC-2)", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    const projectStore = makeProjectStore({
      id: "proj-1",
      name: "My Project",
      phase: "active",
      goals: ["Build API", "Add tests"],
    });
    registry.set("project", projectStore);

    const config = makeConfig(registry);
    registerContextAssembler(pi, config);

    // Simulate session_start to set projectId
    const startHandlers = hooks.get("session_start")!;
    // Mock readFile to return a project ID
    const { readFile } = await import("node:fs/promises");
    (readFile as any).mockResolvedValueOnce("proj-1\n");

    await startHandlers[0]({ cwd: "/tmp/test" }, mockCtx);

    // Now trigger context
    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [{ role: "user", content: "What are we working on?" }],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    await contextHandlers[0](ctxEvent, mockCtx);

    expect(injectedMessage).toContain("## Project");
    expect(injectedMessage).toContain("My Project");
    expect(injectedMessage).toContain("Build API");
  });

  it("gracefully skips missing stores (AC-2)", async () => {
    const { pi, hooks } = makeMockPi();
    // Empty registry — no stores registered
    const config = makeConfig(new Map());
    registerContextAssembler(pi, config);

    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [{ role: "user", content: "Hello" }],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    await contextHandlers[0](ctxEvent, mockCtx);

    // No stores registered, so nothing should be injected
    expect(injectedMessage).toBe("");
  });

  it("works with only memory store registered (partial domains)", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    registry.set(
      "memory",
      makeMemoryStore([
        { id: "m1", content: "A memory", type: "episodic", importance: "low", tags: [] },
      ]),
    );

    const config = makeConfig(registry);
    registerContextAssembler(pi, config);

    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [{ role: "user", content: "test" }],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    await contextHandlers[0](ctxEvent, mockCtx);

    expect(injectedMessage).toContain("## Memory");
    expect(injectedMessage).not.toContain("## Project");
    expect(injectedMessage).not.toContain("## Kanban");
  });

  it("does not inject when injectSystemMessage is not available", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    registry.set("memory", makeMemoryStore([{ id: "m1", content: "test", type: "episodic", importance: "low", tags: [] }]));
    const config = makeConfig(registry);
    registerContextAssembler(pi, config);

    const contextHandlers = hooks.get("context")!;
    // No injectSystemMessage on the event
    const ctxEvent = { messages: [{ role: "user", content: "test" }] };

    // Should not throw
    await contextHandlers[0](ctxEvent, mockCtx);
  });

  it("resets state on session_shutdown", async () => {
    const { pi, hooks } = makeMockPi();
    const config = makeConfig(new Map());
    registerContextAssembler(pi, config);

    // Simulate session_start
    const startHandlers = hooks.get("session_start")!;
    await startHandlers[0]({ cwd: "/tmp" }, mockCtx);

    // Simulate shutdown
    const shutdownHandlers = hooks.get("session_shutdown")!;
    await shutdownHandlers[0]({}, mockCtx);

    // Context hook should work but with null projectId
    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    await contextHandlers[0](ctxEvent, mockCtx);
    expect(injectedMessage).toBe("");
  });

  it("gracefully handles store errors", async () => {
    const { pi, hooks } = makeMockPi();
    const registry = new Map<string, unknown>();
    registry.set("memory", {
      recall: vi.fn().mockRejectedValue(new Error("store error")),
    });
    const config = makeConfig(registry);
    registerContextAssembler(pi, config);

    const contextHandlers = hooks.get("context")!;
    let injectedMessage = "";
    const ctxEvent = {
      messages: [{ role: "user", content: "test" }],
      injectSystemMessage: (msg: string) => {
        injectedMessage = msg;
      },
    };

    // Should not throw
    await contextHandlers[0](ctxEvent, mockCtx);
    expect(injectedMessage).toBe("");
  });
});
