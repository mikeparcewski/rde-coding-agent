import { describe, it, expect, vi } from 'vitest';
import { ToolDispatcher } from '../dist/dispatch/tool-dispatcher.js';
import type { Tool, ToolCall } from '../dist/interfaces/tool.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string, handler: Tool['handler']): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: {},
    handler,
    source: 'builtin',
  };
}

function makeCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name, arguments: args };
}

function makeRegistry(...tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.name, t]));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ToolDispatcher', () => {
  const dispatcher = new ToolDispatcher();

  it('dispatches a single tool call and returns its output', async () => {
    const registry = makeRegistry(
      makeTool('echo', async (args) => args['message'])
    );
    const calls = [makeCall('call-1', 'echo', { message: 'hello' })];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results).toHaveLength(1);
    expect(results[0]?.output).toBe('hello');
    expect(results[0]?.error).toBeUndefined();
  });

  it('dispatches multiple tools in parallel', async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const registry = makeRegistry(
      makeTool('slow', async () => { await delay(30); order.push('slow'); return 'slow'; }),
      makeTool('fast', async () => { await delay(5); order.push('fast'); return 'fast'; })
    );

    const calls = [
      makeCall('c1', 'slow'),
      makeCall('c2', 'fast'),
    ];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results).toHaveLength(2);
    // Both should succeed
    const outputs = results.map((r) => r.output);
    expect(outputs).toContain('slow');
    expect(outputs).toContain('fast');
    // Fast finishes before slow (parallel execution)
    expect(order).toEqual(['fast', 'slow']);
  });

  it('enforces allowedTools — rejects calls not in the list', async () => {
    const registry = makeRegistry(
      makeTool('read-file', async () => 'content'),
      makeTool('delete-file', async () => 'deleted')
    );
    const calls = [makeCall('c1', 'delete-file')];

    const results = await dispatcher.dispatch(calls, registry, ['read-file']);
    expect(results[0]?.error).toMatch(/not in the agent's allowedTools/);
    expect(results[0]?.output).toBeNull();
  });

  it('allows all tools when allowedTools contains "*"', async () => {
    const registry = makeRegistry(
      makeTool('any-tool', async () => 'ok')
    );
    const calls = [makeCall('c1', 'any-tool')];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.error).toBeUndefined();
    expect(results[0]?.output).toBe('ok');
  });

  it('returns error result when tool is not found in registry', async () => {
    const registry = makeRegistry(); // empty
    const calls = [makeCall('c1', 'ghost-tool')];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.error).toMatch(/not registered/);
  });

  it('handles tool execution errors gracefully — no throw', async () => {
    const registry = makeRegistry(
      makeTool('crash', async () => { throw new Error('Boom!'); })
    );
    const calls = [makeCall('c1', 'crash')];

    // Should not throw
    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.error).toBe('Boom!');
    expect(results[0]?.output).toBeNull();
  });

  it('handles non-Error throws from tool handlers', async () => {
    const registry = makeRegistry(
      makeTool('bad', async () => { throw 'string error'; })
    );
    const calls = [makeCall('c1', 'bad')];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.error).toBe('string error');
  });

  it('respects timeout — returns error result instead of hanging', async () => {
    // Create a dispatcher and a handler that never resolves
    const registry = makeRegistry(
      makeTool('hang', () => new Promise(() => { /* never resolves */ }))
    );
    const calls = [makeCall('c1', 'hang')];

    // The default timeout is 30 s, which is too long for a test.
    // We reach into the private method via a subclass override to shorten it.
    class FastTimeoutDispatcher extends ToolDispatcher {
      // Override withTimeout to use 50ms
      protected override withTimeout(
        promise: Promise<unknown>,
        _timeoutMs: number,
        toolName: string
      ): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Tool '${toolName}' timed out after 50ms.`));
          }, 50);
          promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e: unknown) => { clearTimeout(timer); reject(e); }
          );
        });
      }
    }

    const fastDispatcher = new FastTimeoutDispatcher();
    const results = await fastDispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.error).toMatch(/timed out/);
  }, 2000);

  it('records accurate durationMs in results', async () => {
    const registry = makeRegistry(
      makeTool('instant', async () => 'done')
    );
    const calls = [makeCall('c1', 'instant')];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns results in the same order as calls', async () => {
    const registry = makeRegistry(
      makeTool('alpha', async () => 'a'),
      makeTool('beta', async () => 'b'),
      makeTool('gamma', async () => 'c')
    );
    const calls = [
      makeCall('c1', 'alpha'),
      makeCall('c2', 'beta'),
      makeCall('c3', 'gamma'),
    ];

    const results = await dispatcher.dispatch(calls, registry, ['*']);
    expect(results[0]?.name).toBe('alpha');
    expect(results[1]?.name).toBe('beta');
    expect(results[2]?.name).toBe('gamma');
  });
});
