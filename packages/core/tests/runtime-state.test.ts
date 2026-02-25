import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeState } from '../dist/runtime/runtime-state.js';
import type { Message } from '../dist/interfaces/message.js';
import type { ToolResult } from '../dist/interfaces/tool.js';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    role: 'user',
    content: 'Hello',
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolCallId: '00000000-0000-0000-0000-000000000010',
    name: 'read-file',
    output: 'file contents',
    durationMs: 12,
    ...overrides,
  };
}

describe('RuntimeState', () => {
  let state: RuntimeState;

  beforeEach(() => {
    state = new RuntimeState('session-1', 'agent-a');
  });

  it('creates with idle phase and turn 0', () => {
    const snap = state.snapshot;
    expect(snap.phase).toBe('idle');
    expect(snap.turnNumber).toBe(0);
    expect(snap.sessionId).toBe('session-1');
    expect(snap.agentId).toBe('agent-a');
  });

  it('creates with empty messages and tool arrays', () => {
    const snap = state.snapshot;
    expect(snap.messages).toHaveLength(0);
    expect(snap.pendingToolCalls).toHaveLength(0);
    expect(snap.completedToolResults).toHaveLength(0);
  });

  it('appendMessage adds to the messages array', () => {
    const msg = makeMessage();
    state.appendMessage(msg);
    expect(state.snapshot.messages).toHaveLength(1);
    expect(state.snapshot.messages[0]).toEqual(msg);
  });

  it('appendMessage is non-destructive — previous messages remain', () => {
    state.appendMessage(makeMessage({ id: '00000000-0000-0000-0000-000000000001' }));
    state.appendMessage(makeMessage({ id: '00000000-0000-0000-0000-000000000002' }));
    expect(state.snapshot.messages).toHaveLength(2);
  });

  it('advanceTurn increments turnNumber', () => {
    state.advanceTurn();
    expect(state.snapshot.turnNumber).toBe(1);
    state.advanceTurn();
    expect(state.snapshot.turnNumber).toBe(2);
  });

  it('advanceTurn clears pendingToolCalls and completedToolResults', () => {
    state.recordToolCall('call-id-1');
    state.recordToolResult(makeToolResult({ toolCallId: '00000000-0000-0000-0000-000000000010' }));
    // Before advance: results exist
    expect(state.snapshot.completedToolResults).toHaveLength(1);
    state.advanceTurn();
    expect(state.snapshot.pendingToolCalls).toHaveLength(0);
    expect(state.snapshot.completedToolResults).toHaveLength(0);
  });

  it('setPhase updates the phase', () => {
    state.setPhase('dispatching_tools');
    expect(state.snapshot.phase).toBe('dispatching_tools');
    state.setPhase('error');
    expect(state.snapshot.phase).toBe('error');
  });

  it('snapshot returns a frozen copy — mutations do not affect state', () => {
    const snap = state.snapshot;
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('snapshot is a new object on each call — no stale references', () => {
    const snap1 = state.snapshot;
    state.setPhase('assembling_context');
    const snap2 = state.snapshot;
    // Original snapshot remains unchanged
    expect(snap1.phase).toBe('idle');
    expect(snap2.phase).toBe('assembling_context');
  });

  it('recordToolCall adds call id to pendingToolCalls', () => {
    state.recordToolCall('call-abc');
    expect(state.snapshot.pendingToolCalls).toContain('call-abc');
  });

  it('recordToolCall accumulates multiple ids', () => {
    state.recordToolCall('call-1');
    state.recordToolCall('call-2');
    expect(state.snapshot.pendingToolCalls).toHaveLength(2);
  });

  it('recordToolResult moves call id from pending to completed', () => {
    const callId = '00000000-0000-0000-0000-000000000010';
    state.recordToolCall(callId);
    expect(state.snapshot.pendingToolCalls).toContain(callId);

    const result = makeToolResult({ toolCallId: callId });
    state.recordToolResult(result);

    expect(state.snapshot.pendingToolCalls).not.toContain(callId);
    expect(state.snapshot.completedToolResults).toHaveLength(1);
    expect(state.snapshot.completedToolResults[0]).toEqual(result);
  });

  it('recordToolResult with unknown callId does not corrupt state', () => {
    const result = makeToolResult({ toolCallId: '00000000-0000-0000-0000-000000000099' });
    state.recordToolResult(result);
    // No pending calls were removed (there were none), result still appended
    expect(state.snapshot.completedToolResults).toHaveLength(1);
  });
});
