import { describe, it, expect } from 'vitest';
import { TwoTierIntentRouter, CONFIDENCE_THRESHOLD } from '../dist/intent/router.js';
import type { RuntimeSnapshot } from '../dist/runtime/runtime-state.js';
import type { IntentSignal } from '../dist/interfaces/intent.js';

// Minimal snapshot — the router only uses it for type compliance in Tier 1
const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  sessionId: 'test-session',
  agentId: 'test-agent',
  turnNumber: 0,
  messages: [],
  pendingToolCalls: [],
  completedToolResults: [],
  phase: 'idle',
};

describe('TwoTierIntentRouter — fast path (Tier 1)', () => {
  // No LLM adapter provided — Tier 2 falls back gracefully
  const router = new TwoTierIntentRouter();

  it('routes "review this code" to the code-review capability', async () => {
    const result = await router.route('review this code', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('code-review');
    expect(result.tier).toBe('fast');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('routes "please review my code" to the code-review capability', async () => {
    const result = await router.route('please review my code', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('code-review');
    expect(result.tier).toBe('fast');
  });

  it('routes "debug this error" to the debug capability', async () => {
    const result = await router.route('debug this error', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('debug');
    expect(result.tier).toBe('fast');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('routes "fix bug in auth module" to the debug capability', async () => {
    const result = await router.route('fix bug in auth module', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('debug');
    expect(result.tier).toBe('fast');
  });

  it('returns a valid agentId for matched capabilities', async () => {
    const result = await router.route('review this code', EMPTY_SNAPSHOT);
    expect(typeof result.agentId).toBe('string');
    expect(result.agentId.length).toBeGreaterThan(0);
  });

  it('returns a narration string for matched capabilities', async () => {
    const result = await router.route('review this code', EMPTY_SNAPSHOT);
    expect(typeof result.narration).toBe('string');
    expect(result.narration.length).toBeGreaterThan(0);
  });

  it('unknown gibberish input falls below confidence threshold — triggers LLM tier', async () => {
    // With no adapter, Tier 2 falls back to "general" with low confidence
    const result = await router.route('xyzzy frobnicator blorb', EMPTY_SNAPSHOT);
    // Tier 1 should find no high-confidence match, so Tier 2 fires
    expect(result.tier).toBe('llm');
    // With no adapter the fallback confidence is 0.5
    expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
  });

  it('custom signals registered via registerSignals take precedence over builtins', async () => {
    const customRouter = new TwoTierIntentRouter();

    const customSignal: IntentSignal = {
      pattern: 'frobnicator',
      capability: 'brainstorm',
      confidence: 0.95,
      keywords: ['frobnicator'],
    };

    customRouter.registerSignals([customSignal]);

    const result = await customRouter.route('frobnicator', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('brainstorm');
    expect(result.tier).toBe('fast');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('getRoutingTable returns a Map with known capabilities', () => {
    const table = router.getRoutingTable();
    expect(table).toBeInstanceOf(Map);
    expect(table.has('code-review')).toBe(true);
    expect(table.has('debug')).toBe(true);
    expect(table.has('general')).toBe(true);
  });

  it('getRoutingTable returns a copy — mutations do not affect internal state', () => {
    const table = router.getRoutingTable();
    table.set('code-review', 'hacked-agent');
    // Internal routing table should not be changed
    const table2 = router.getRoutingTable();
    expect(table2.get('code-review')).not.toBe('hacked-agent');
  });

  it('routes "refactor this module" to refactor capability', async () => {
    const result = await router.route('refactor this module', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('refactor');
    expect(result.tier).toBe('fast');
  });

  it('routes "run tests" to test-execution capability', async () => {
    const result = await router.route('run tests now', EMPTY_SNAPSHOT);
    expect(result.capability).toBe('test-execution');
    expect(result.tier).toBe('fast');
  });
});
