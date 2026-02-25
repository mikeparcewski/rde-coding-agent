# Directory Structure: the-agent Monorepo

## Monorepo Root

```
the-agent/
├── package.json                    # npm workspaces root
├── tsconfig.base.json              # shared compiler options
├── tsconfig.json                   # project references to all packages
├── vitest.config.ts                # shared test config
├── .eslintrc.json
├── .gitignore
│
├── packages/
│   ├── core/
│   ├── providers/
│   ├── skills/
│   ├── agents/
│   └── cli/
│
└── examples/
    └── basic-project/              # shows a consumer project layout
        ├── agent.config.ts
        ├── skills/
        │   ├── summarize.md
        │   └── commit/
        │       ├── index.md
        │       └── handler.ts
        └── agents/
            ├── default.md
            └── coder.md
```

## Package: @the-agent/core

```
packages/core/
├── package.json
├── tsconfig.json                   # "composite": true, no outDir deps
├── src/
│   ├── index.ts                    # barrel: re-exports everything public
│   │
│   ├── interfaces/
│   │   ├── message.ts              # MessageSchema, Message, Role
│   │   ├── tool.ts                 # ToolSchema, Tool, ToolCall, ToolResult
│   │   ├── llm-adapter.ts          # LLMAdapter interface, CompletionSignal
│   │   ├── agent-config.ts         # AgentConfigSchema, AgentConfig
│   │   └── skill-config.ts         # SkillConfigSchema, SkillConfig, SkillMode
│   │
│   ├── runtime/
│   │   ├── runtime-loop.ts         # RuntimeLoop class — owns the turn loop
│   │   ├── runtime-state.ts        # RuntimeState, RuntimeSnapshot, RuntimePhase
│   │   └── context-assembler.ts    # ContextAssembler — builds Message[] per turn
│   │
│   ├── dispatch/
│   │   └── tool-dispatcher.ts      # ToolDispatcher — parallel execution, allowedTools
│   │
│   ├── memory/
│   │   ├── memory-store.ts         # MemoryStore interface
│   │   ├── json-file-memory.ts     # JsonFileMemoryStore implementation
│   │   └── sqlite-memory.ts        # SqliteMemoryStore implementation
│   │
│   ├── cache/
│   │   └── cache-layer.ts          # CacheLayer — LRU, sha256 keyed
│   │
│   └── logger/
│       └── logger.ts               # Logger interface + default console impl
│
└── tests/
    ├── runtime-loop.test.ts
    ├── runtime-state.test.ts
    ├── context-assembler.test.ts
    └── tool-dispatcher.test.ts
```

## Package: @the-agent/providers

```
packages/providers/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # barrel: exports all adapters + createAdapter()
│   │
│   ├── anthropic/
│   │   └── anthropic-adapter.ts    # AnthropicAdapter implements LLMAdapter
│   │
│   ├── openai/
│   │   └── openai-adapter.ts       # OpenAIAdapter implements LLMAdapter
│   │
│   ├── google/
│   │   └── google-adapter.ts       # GoogleAdapter implements LLMAdapter
│   │
│   ├── ollama/
│   │   └── ollama-adapter.ts       # OllamaAdapter implements LLMAdapter
│   │
│   └── factory.ts                  # createAdapter(config) -> LLMAdapter
│
└── tests/
    ├── anthropic-adapter.test.ts   # mocks fetch, tests signal normalization
    ├── openai-adapter.test.ts
    └── factory.test.ts
```

## Package: @the-agent/skills

```
packages/skills/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # barrel: loadSkills(), SkillRegistry, defineSkill()
│   │
│   ├── interfaces/
│   │   └── handler.ts              # SkillHandler interface, defineSkill() helper
│   │
│   ├── loader/
│   │   ├── skill-loader.ts         # SkillLoader — discover, parse, compile, register
│   │   ├── frontmatter-parser.ts   # gray-matter wrapper + SkillFrontmatterSchema validation
│   │   ├── handler-resolver.ts     # finds co-located .ts/.js handler by convention
│   │   └── template-interpolator.ts # {{param}} interpolation for markdown-only skills
│   │
│   └── registry/
│       └── skill-registry.ts       # SkillRegistry — get(name), list(), register(skill)
│
└── tests/
    ├── skill-loader.test.ts
    ├── frontmatter-parser.test.ts
    ├── template-interpolator.test.ts
    └── fixtures/
        ├── summarize.md            # valid markdown-only skill
        ├── commit/
        │   ├── index.md
        │   └── handler.ts          # valid handler
        └── malformed.md            # invalid frontmatter for error path tests
```

## Package: @the-agent/agents

```
packages/agents/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # barrel: loadAgents(), AgentRegistry, defineAgent()
│   │
│   ├── interfaces/
│   │   └── agent-frontmatter.ts    # AgentFrontmatterSchema, AgentFrontmatter
│   │
│   ├── loader/
│   │   ├── agent-loader.ts         # AgentLoader — discover, parse, build, register
│   │   ├── frontmatter-parser.ts   # gray-matter wrapper + AgentFrontmatterSchema validation
│   │   ├── system-prompt-builder.ts # merges frontmatter.systemPrompt + markdownBody
│   │   └── hooks-resolver.ts       # finds co-located .hooks.ts file by convention
│   │
│   └── registry/
│       └── agent-registry.ts       # AgentRegistry — get(id), list(), register(agent)
│
└── tests/
    ├── agent-loader.test.ts
    ├── system-prompt-builder.test.ts
    └── fixtures/
        ├── default.md
        ├── coder.md
        └── coder.hooks.ts
```

## Package: @the-agent/cli

```
packages/cli/
├── package.json
├── tsconfig.json
├── bin/
│   └── the-agent.js                # node shebang wrapper -> src/bin.ts
├── src/
│   ├── index.ts                    # public API: createCLI(), defineFramework()
│   ├── bin.ts                      # entry point: load config, call createCLI().start()
│   │
│   ├── define-framework.ts         # defineFramework() + FrameworkConfigSchema
│   │
│   ├── loader/
│   │   └── framework-loader.ts     # orchestrates all startup: skills, agents, adapter
│   │
│   ├── repl/
│   │   ├── repl.ts                 # readline REPL, turn loop
│   │   └── output-formatter.ts     # formats LLM text, tool results for terminal
│   │
│   └── dispatch/
│       └── slash-command-dispatcher.ts  # maps /command to SkillRegistry entries
│
└── tests/
    ├── define-framework.test.ts
    └── slash-command-dispatcher.test.ts
```

## Example Consumer Project

```
examples/basic-project/
├── agent.config.ts
│
├── skills/
│   ├── summarize.md
│   └── commit/
│       ├── index.md
│       └── handler.ts
│
└── agents/
    ├── default.md
    └── coder.md
```

### agent.config.ts

```typescript
import { defineFramework } from "@the-agent/cli";

export default defineFramework({
  llm: {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultModel: "claude-opus-4-6",
  },
  skillsDir: "./skills",
  agentsDir: "./agents",
  skillMode: "permissive",
  defaultAgent: "default",
  memory: {
    enabled: true,
    backend: "sqlite",
  },
});
```

### skills/summarize.md

```markdown
---
name: /summarize
description: Summarize a piece of text to a target length
parameters:
  text:
    type: string
    description: The text to summarize
    required: true
  length:
    type: string
    description: "Target length: short | medium | long"
    required: false
---

Summarize the following text.
Target length: {{length | "medium"}}.

Text:
{{text}}
```

### skills/commit/index.md

```markdown
---
name: /commit
description: Generate a conventional commit message from staged git diff
requiresHandler: true
---

Generate a conventional commit message for the provided git diff.
```

### skills/commit/handler.ts

```typescript
import { defineSkill } from "@the-agent/skills";
import { execSync } from "node:child_process";

export default defineSkill({
  tool: {
    name: "commit",
    description: "Generate a conventional commit message from staged git diff",
    parameters: {
      dryRun: {
        type: "boolean",
        description: "If true, print the message without committing",
        required: false,
      },
    },
    source: "skill",
    handler: async ({ dryRun }) => {
      const diff = execSync("git diff --cached").toString();
      if (!diff.trim()) {
        return { error: "No staged changes found. Run git add first." };
      }
      return { diff, dryRun: Boolean(dryRun) };
    },
  },
});
```

### agents/coder.md

```markdown
---
id: coder
name: Code Assistant
description: Expert TypeScript and systems programmer
model: claude-opus-4-6
allowedTools:
  - read_file
  - write_file
  - commit
maxTurns: 50
---

You are an expert TypeScript programmer with deep knowledge of Node.js,
type systems, and software architecture.

Always write strict TypeScript. Handle errors explicitly. Write tests.
```

## Root package.json

```json
{
  "name": "the-agent",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint packages/*/src",
    "clean": "tsc --build --clean"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.0.0",
    "eslint": "^8.0.0"
  }
}
```

## tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "lib": ["ES2022"]
  }
}
```

## Dependency Count Projection

| Package | Direct runtime dependencies |
|---|---|
| `@the-agent/core` | `zod` |
| `@the-agent/providers` | `@anthropic-ai/sdk`, `openai`, `@google/generative-ai` |
| `@the-agent/skills` | `gray-matter`, `marked` |
| `@the-agent/agents` | `gray-matter` |
| `@the-agent/cli` | (none beyond internal) |
| **Total direct** | **6 unique packages** |

Well within the 30 direct dependency budget. Transitive dependencies from SDK packages will
constitute the majority of install size but remain within the 50MB budget given that each SDK
is approximately 2-4MB unpacked.
