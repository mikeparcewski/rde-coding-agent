/**
 * Shared test helpers: mock PiContext and tool execution context.
 */

import { vi } from "vitest";
import type {
  PiExtensionAPI,
  PiTool,
  PiCommandHandler,
  PiEventHandler,
  PiCommandContext,
  PiUI,
  PiSession,
} from "../../src/types.js";

// ── Mock PiContext ─────────────────────────────────────────────────────────────

export interface MockPi extends PiExtensionAPI {
  _tools: Map<string, PiTool>;
  _commands: Map<string, PiCommandHandler>;
  _hooks: Map<string, PiEventHandler[]>;
  ai: {
    streamSimple: ReturnType<typeof vi.fn>;
  };
}

export function makeMockPi(): MockPi {
  const tools = new Map<string, PiTool>();
  const commands = new Map<string, PiCommandHandler>();
  const hooks = new Map<string, PiEventHandler[]>();

  return {
    registerTool: vi.fn((def: PiTool) => tools.set(def.name, def)),
    registerCommand: vi.fn((name: string, handler: PiCommandHandler) =>
      commands.set(name, handler),
    ),
    on: vi.fn((event: string, handler: PiEventHandler) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    }),
    ai: { streamSimple: vi.fn() },
    _tools: tools,
    _commands: commands,
    _hooks: hooks,
  };
}

// ── Mock command context ───────────────────────────────────────────────────────

export function makeMockCtx(
  overrides?: Partial<PiCommandContext>,
): PiCommandContext {
  const ui: PiUI = {
    confirm: vi.fn().mockResolvedValue(true),
    showMessage: vi.fn(),
  };

  const session: PiSession = {
    id: "test-session-001",
    cwd: "/tmp/test-project",
  };

  return {
    ui,
    session,
    getModel: vi.fn().mockResolvedValue({ id: "test-model", provider: "test" }),
    ...overrides,
  };
}
