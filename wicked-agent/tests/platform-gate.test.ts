/**
 * Tests for the Platform security gate hook.
 *
 * Verifies that dangerous operations are blocked when guardrails are enabled,
 * safe operations pass through, and guardrails: false skips all registration.
 *
 * Contract assumption: our hook throws to signal cancellation. pi-mono is
 * responsible for propagating the throw. This test verifies our hook's behaviour,
 * not pi-mono's hook runner.
 *
 * NOTE: The platform hooks.ts returns { block: true, reason: ... } rather than
 * throwing. This is the correct pi-mono pattern — the hook returns a block signal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerHooks } from "../src/domains/platform/hooks.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const hooks = new Map<string, any[]>();
  const pi = {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: any) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    }),
  };
  return { pi, hooks };
}

function makeCtx(confirmResponse = true) {
  return {
    ui: {
      confirm: vi.fn().mockResolvedValue(confirmResponse),
      showMessage: vi.fn(),
    },
    session: { id: "sess-001", cwd: "/tmp" },
    getModel: vi.fn(),
  };
}

// ── Guardrails disabled ────────────────────────────────────────────────────────

describe("registerHooks — guardrails disabled", () => {
  it("does not register any hooks when guardrails is false", () => {
    const { pi, hooks } = makeMockPi();
    registerHooks(pi as any, false);

    expect(pi.on).not.toHaveBeenCalled();
    expect(hooks.size).toBe(0);
  });
});

// ── Guardrails enabled ─────────────────────────────────────────────────────────

describe("registerHooks — guardrails enabled", () => {
  let pi: ReturnType<typeof makeMockPi>["pi"];
  let hooks: Map<string, any[]>;

  beforeEach(() => {
    const mock = makeMockPi();
    pi = mock.pi;
    hooks = mock.hooks;
    registerHooks(pi as any, true);
  });

  it("registers tool_call hook", () => {
    expect(hooks.has("tool_call")).toBe(true);
    expect(hooks.get("tool_call")!.length).toBe(1);
  });

  it("safe operation passes through without calling confirm", async () => {
    const ctx = makeCtx();
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "read_file",
        input: { path: "/tmp/safe-file.txt" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("dangerous command (rm -rf) prompts user for confirmation", async () => {
    const ctx = makeCtx(true); // user confirms
    const handler = hooks.get("tool_call")![0]!;

    await handler(
      {
        name: "bash",
        input: { command: "rm -rf /tmp/old-stuff" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
  });

  it("dangerous command + user confirms → handler returns undefined (allows)", async () => {
    const ctx = makeCtx(true);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "rm -rf /tmp/deleteme" },
      },
      ctx,
    );

    // When user confirms, handler returns without blocking
    // The return value is undefined (allow) after logging warning
    expect(result).toBeUndefined();
  });

  it("dangerous command + user declines → handler returns block signal", async () => {
    const ctx = makeCtx(false); // user declines
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "rm -rf /important/data" },
      },
      ctx,
    );

    expect(result).toBeDefined();
    expect((result as any).block).toBe(true);
    expect((result as any).reason).toContain("platform guardrail");
  });

  it("DROP TABLE command is detected as dangerous", async () => {
    const ctx = makeCtx(false);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "execute_sql",
        input: { sql: "DROP TABLE users" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect((result as any).block).toBe(true);
  });

  it("git push --force is detected as dangerous", async () => {
    const ctx = makeCtx(false);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "git push --force origin main" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect((result as any).block).toBe(true);
  });

  it("git reset --hard is detected as dangerous", async () => {
    const ctx = makeCtx(false);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "git reset --hard HEAD~3" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect((result as any).block).toBe(true);
  });

  it("block reason contains a description of the dangerous operation", async () => {
    const ctx = makeCtx(false);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "rm -rf /tmp/data" },
      },
      ctx,
    );

    const reason = (result as any).reason as string;
    expect(reason.toLowerCase()).toMatch(/recursive file deletion|rm -rf/i);
  });

  it("kubectl delete is detected as critical dangerous operation", async () => {
    const ctx = makeCtx(false);
    const handler = hooks.get("tool_call")![0]!;

    const result = await handler(
      {
        name: "bash",
        input: { command: "kubectl delete deployment my-app" },
      },
      ctx,
    );

    expect(ctx.ui.confirm).toHaveBeenCalledOnce();
    expect((result as any).block).toBe(true);
  });
});
