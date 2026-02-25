import { describe, it, expect } from 'vitest';
import { MessageSchema } from '../dist/interfaces/message.js';
import { ToolSchema } from '../dist/interfaces/tool.js';
import { CompletionSignalSchema } from '../dist/interfaces/llm-adapter.js';
import { AgentConfigSchema } from '../dist/interfaces/agent-config.js';
import { SkillFrontmatterSchema } from '../dist/interfaces/skill-config.js';
import { CompletionContractSchema } from '../dist/interfaces/completion.js';

// ── MessageSchema ─────────────────────────────────────────────────────────────

describe('MessageSchema', () => {
  it('accepts a valid user message', () => {
    const result = MessageSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      role: 'user',
      content: 'Hello',
      timestamp: 1_700_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a tool message with toolCallId', () => {
    const result = MessageSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000002',
      role: 'tool',
      content: '{"result": "ok"}',
      timestamp: 1_700_000_001,
      toolCallId: '00000000-0000-0000-0000-000000000099',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a message with invalid role', () => {
    const result = MessageSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000003',
      role: 'bot',
      content: 'Hi',
      timestamp: 1_700_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message with a non-uuid id', () => {
    const result = MessageSchema.safeParse({
      id: 'not-a-uuid',
      role: 'user',
      content: 'Hi',
      timestamp: 1_700_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message with a negative timestamp', () => {
    const result = MessageSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000004',
      role: 'user',
      content: 'Hi',
      timestamp: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ── ToolSchema ────────────────────────────────────────────────────────────────

describe('ToolSchema', () => {
  const validTool = {
    name: 'read-file',
    description: 'Reads a file from disk',
    parameters: {
      path: {
        type: 'string',
        description: 'Absolute path to the file',
        required: true,
      },
    },
    handler: async (_args: Record<string, unknown>) => 'content',
    source: 'builtin',
  };

  it('accepts a valid tool definition', () => {
    const result = ToolSchema.safeParse(validTool);
    expect(result.success).toBe(true);
  });

  it('rejects a tool name that starts with a digit', () => {
    const result = ToolSchema.safeParse({ ...validTool, name: '1bad' });
    expect(result.success).toBe(false);
  });

  it('rejects a tool name with uppercase letters', () => {
    const result = ToolSchema.safeParse({ ...validTool, name: 'ReadFile' });
    expect(result.success).toBe(false);
  });

  it('rejects a tool with an empty description', () => {
    const result = ToolSchema.safeParse({ ...validTool, description: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a tool with an invalid source', () => {
    const result = ToolSchema.safeParse({ ...validTool, source: 'unknown' });
    expect(result.success).toBe(false);
  });
});

// ── CompletionSignalSchema ────────────────────────────────────────────────────

describe('CompletionSignalSchema — discriminated union', () => {
  it('validates the "text" variant', () => {
    const result = CompletionSignalSchema.safeParse({
      type: 'text',
      content: 'Here is the answer.',
      stopReason: 'end_turn',
    });
    expect(result.success).toBe(true);
  });

  it('validates the "tool_use" variant', () => {
    const result = CompletionSignalSchema.safeParse({
      type: 'tool_use',
      calls: [
        {
          id: 'call-1',
          name: 'read-file',
          arguments: { path: '/tmp/test.txt' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates the "error" variant', () => {
    const result = CompletionSignalSchema.safeParse({
      type: 'error',
      code: 'RATE_LIMIT',
      message: 'Too many requests',
      retryable: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = CompletionSignalSchema.safeParse({
      type: 'stream',
      delta: 'partial text',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a "text" variant missing stopReason', () => {
    const result = CompletionSignalSchema.safeParse({
      type: 'text',
      content: 'Hi',
    });
    expect(result.success).toBe(false);
  });
});

// ── AgentConfigSchema ─────────────────────────────────────────────────────────

describe('AgentConfigSchema', () => {
  const validConfig = {
    id: 'my-agent',
    name: 'My Agent',
  };

  it('accepts a minimal agent config', () => {
    const result = AgentConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('applies default values (allowedTools=["*"], maxTurns=30)', () => {
    const result = AgentConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowedTools).toEqual(['*']);
      expect(result.data.maxTurns).toBe(30);
    }
  });

  it('rejects an id that starts with a digit', () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, id: '1bad' });
    expect(result.success).toBe(false);
  });

  it('rejects an id with uppercase letters', () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, id: 'MyAgent' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects temperature above 2', () => {
    const result = AgentConfigSchema.safeParse({ ...validConfig, temperature: 2.1 });
    expect(result.success).toBe(false);
  });
});

// ── SkillFrontmatterSchema ────────────────────────────────────────────────────

describe('SkillFrontmatterSchema', () => {
  const validFrontmatter = {
    name: '/commit',
    description: 'Creates a git commit',
  };

  it('accepts a minimal skill frontmatter', () => {
    const result = SkillFrontmatterSchema.safeParse(validFrontmatter);
    expect(result.success).toBe(true);
  });

  it('rejects a name that does not start with /', () => {
    const result = SkillFrontmatterSchema.safeParse({ ...validFrontmatter, name: 'commit' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty description', () => {
    const result = SkillFrontmatterSchema.safeParse({ ...validFrontmatter, description: '' });
    expect(result.success).toBe(false);
  });

  it('defaults requiresHandler to false', () => {
    const result = SkillFrontmatterSchema.safeParse(validFrontmatter);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiresHandler).toBe(false);
    }
  });

  it('accepts inline parameters', () => {
    const result = SkillFrontmatterSchema.safeParse({
      ...validFrontmatter,
      parameters: {
        message: { type: 'string', description: 'Commit message', required: true },
      },
    });
    expect(result.success).toBe(true);
  });
});

// ── CompletionContractSchema ──────────────────────────────────────────────────

describe('CompletionContractSchema', () => {
  const validContract = {
    capability: 'code-review',
    conditions: [
      {
        id: 'cond-1',
        description: 'All files reviewed',
        check: 'assertion',
      },
    ],
  };

  it('accepts a valid completion contract', () => {
    const result = CompletionContractSchema.safeParse(validContract);
    expect(result.success).toBe(true);
  });

  it('applies default maxTurns=30 and timeoutMs=300000', () => {
    const result = CompletionContractSchema.safeParse(validContract);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxTurns).toBe(30);
      expect(result.data.timeoutMs).toBe(300_000);
    }
  });

  it('rejects a contract with zero conditions', () => {
    const result = CompletionContractSchema.safeParse({ ...validContract, conditions: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a contract with an invalid check value', () => {
    const result = CompletionContractSchema.safeParse({
      ...validContract,
      conditions: [
        { id: 'c1', description: 'done', check: 'magic' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
