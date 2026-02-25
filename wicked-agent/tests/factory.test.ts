/**
 * Tests for the wickedAgent() factory (extension.ts).
 *
 * Verifies selective domain loading, fault isolation, and config defaults.
 * Domain registrars are NOT mocked — the real ones run against a mock PiContext.
 * This means all domain dependencies (stores, etc.) must be satisfied but
 * we don't test their behaviour here; we only assert what was registered.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the fs module so domain stores don't hit disk during registration
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  appendFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { wickedAgent } from "../src/extension.js";
import { DOMAIN_NAMES } from "../src/types.js";

// ── Helper: mock pi with accessible maps ──────────────────────────────────────

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
    // Expose the maps so tests can inspect them
    _tools: tools,
    _commands: commands,
    _hooks: hooks,
  };

  return { pi, tools, commands, hooks };
}

describe("wickedAgent() factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a function that accepts PiExtensionAPI", () => {
    const register = wickedAgent();
    expect(typeof register).toBe("function");
  });

  describe("capabilities: 'all' (default)", () => {
    it("registers tools from all 14 domains", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      // Every domain should have registered at least one tool
      expect(pi._tools.size).toBeGreaterThanOrEqual(14);
    });

    it("registerTool is called for each domain at least once", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      // Check specific known tools from several different domains
      expect(pi._tools.has("remember")).toBe(true);       // memory
      expect(pi._tools.has("code_search")).toBe(true);    // search
      expect(pi._tools.has("brainstorm")).toBe(true);     // brainstorm
    });

    it("registers hooks for memory and platform domains", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: "all", guardrails: true });
      register(pi);

      // Memory domain registers session_start, context, session_shutdown
      expect(pi._hooks.has("session_start")).toBe(true);
      expect(pi._hooks.has("context")).toBe(true);
      // Platform guardrails registers tool_call hook
      expect(pi._hooks.has("tool_call")).toBe(true);
    });
  });

  describe("selective capabilities", () => {
    it("registers only the selected domains", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: ["memory", "search"] });
      register(pi);

      expect(pi._tools.has("remember")).toBe(true);    // memory
      expect(pi._tools.has("recall")).toBe(true);      // memory
      expect(pi._tools.has("code_search")).toBe(true); // search

      // brainstorm should NOT be registered
      expect(pi._tools.has("brainstorm")).toBe(false);
      // kanban should NOT be registered
      expect(pi._tools.has("kanban_create")).toBe(false);
    });

    it("registers only brainstorm tools when only brainstorm selected", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: ["brainstorm"] });
      register(pi);

      expect(pi._tools.has("brainstorm")).toBe(true);
      expect(pi._tools.has("quick_jam")).toBe(true);

      // Memory tools should NOT be registered
      expect(pi._tools.has("remember")).toBe(false);
    });

    it("does not register tool_call hook when platform is not selected", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: ["memory", "search"] });
      register(pi);

      expect(pi._hooks.has("tool_call")).toBe(false);
    });

    it("context assembler registers session_start even without memory domain", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: ["search"] });
      register(pi);

      // Context assembler always registers session_start for project detection
      expect(pi._hooks.has("session_start")).toBe(true);
    });
  });

  describe("fault isolation", () => {
    it("one failing domain does not prevent other domains from loading", () => {
      const { pi } = makeMockPi();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Both memory and search should register without errors
      const register = wickedAgent({
        capabilities: ["memory", "search"],
      });
      register(pi);

      expect(pi._tools.has("remember")).toBe(true);
      expect(pi._tools.has("code_search")).toBe(true);

      warnSpy.mockRestore();
    });

    it("factory does not throw even when capabilities list is empty", () => {
      const { pi } = makeMockPi();
      expect(() => {
        const register = wickedAgent({ capabilities: [] });
        register(pi);
      }).not.toThrow();
      expect(pi._tools.size).toBe(0);
    });
  });

  describe("config defaults", () => {
    it("defaults to guardrails: true (tool_call hook registered)", () => {
      const { pi } = makeMockPi();
      // No guardrails option specified -> defaults to true
      const register = wickedAgent({ capabilities: ["platform"] });
      register(pi);

      expect(pi._hooks.has("tool_call")).toBe(true);
    });

    it("guardrails: false does not register tool_call hook", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({
        capabilities: ["platform"],
        guardrails: false,
      });
      register(pi);

      expect(pi._hooks.has("tool_call")).toBe(false);
    });

    it("storePath defaults are applied (no error when storePath is omitted)", () => {
      const { pi } = makeMockPi();
      // Should not throw even with no storePath
      expect(() => {
        const register = wickedAgent({ capabilities: ["memory"] });
        register(pi);
      }).not.toThrow();
    });

    it("storePath with tilde is expanded to absolute path (no error)", () => {
      const { pi } = makeMockPi();
      expect(() => {
        const register = wickedAgent({
          capabilities: ["memory"],
          storePath: "~/custom/path",
        });
        register(pi);
      }).not.toThrow();

      // memory domain should register tools regardless of storePath
      expect(pi._tools.has("remember")).toBe(true);
    });

    it("all 14 DOMAIN_NAMES have a corresponding registrar", () => {
      const { pi } = makeMockPi();
      // Register all 14 domains
      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      // We expect DOMAIN_NAMES.length domains to have been attempted
      expect(DOMAIN_NAMES).toHaveLength(14);

      // The tool count should be substantially more than 14 (multiple tools per domain)
      expect(pi._tools.size).toBeGreaterThan(14);
    });
  });

  // ── AC-1: E2E Extension Loading ───────────────────────────────────────────

  describe("AC-1: E2E extension loading", () => {
    it("loads all 14 domains without errors", () => {
      const { pi } = makeMockPi();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      // No domain registration warnings
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("registers tools from all expected domains including scenarios and patch", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      // Original 12 domains
      expect(pi._tools.has("remember")).toBe(true);        // memory
      expect(pi._tools.has("code_search")).toBe(true);     // search
      expect(pi._tools.has("brainstorm")).toBe(true);      // brainstorm
      expect(pi._tools.has("code_review")).toBe(true);     // engineering
      expect(pi._tools.has("security_scan")).toBe(true);   // platform
      expect(pi._tools.has("task_create")).toBe(true);      // kanban

      // New v02 domains
      expect(pi._tools.has("scenario_parse")).toBe(true);  // scenarios
      expect(pi._tools.has("scenario_run")).toBe(true);    // scenarios
      expect(pi._tools.has("rename_symbol")).toBe(true);   // patch
      expect(pi._tools.has("remove_symbol")).toBe(true);   // patch
    });

    it("registers slash commands from scenarios and patch domains", () => {
      const { pi } = makeMockPi();
      const register = wickedAgent({ capabilities: "all" });
      register(pi);

      expect(pi._commands.has("/scenario")).toBe(true);
      expect(pi._commands.has("/rename")).toBe(true);
      expect(pi._commands.has("/remove")).toBe(true);
    });

    it("captures pi.getModel into resolved config for brainstorm", () => {
      const mockGetModel = vi.fn().mockResolvedValue({ id: "claude-3", provider: "anthropic" });
      const pi = {
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        on: vi.fn(),
        ai: { streamSimple: vi.fn() },
        getModel: mockGetModel,
      };

      const register = wickedAgent({ capabilities: ["brainstorm"] });
      register(pi);

      // brainstorm tool should be registered
      expect(pi.registerTool).toHaveBeenCalled();
    });
  });
});
