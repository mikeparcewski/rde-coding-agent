# rde-coding-agent

A [pi-mono](https://github.com/nicepkg/pi-mono) extension that adds domain-specific coding tools for software delivery teams. Covers engineering, QE, platform, product, data, delivery, and more — 14 domains in a single extension.

## Prerequisites

- Node.js >= 20
- [pi-mono](https://github.com/nicepkg/pi-mono) (`@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` >= 0.55.0)

## Install

```bash
npm install rde-coding-agent
```

## Setup

Register the extension in your pi-mono config:

```typescript
// ~/.pi/agent/extensions/rde.ts
import { rdeCodingAgent } from "rde-coding-agent";

export default rdeCodingAgent({ capabilities: "all" });
```

### Configuration options

```typescript
rdeCodingAgent({
  // Which domains to enable (default: "all")
  capabilities: "all" | ["engineering", "qe", "platform", ...],

  // Base path for persistent stores (default: ~/.pi/agent/rde)
  storePath: "~/.pi/agent/rde",

  // Enable security guardrail hooks (default: true)
  guardrails: true,
});
```

## Domains

| Domain | Description |
|---|---|
| `engineering` | Code review, architecture patterns, refactoring guidance |
| `qe` | Test strategy, quality gates, test generation |
| `platform` | CI/CD, infrastructure, security, compliance |
| `product` | Requirements, UX review, accessibility, stakeholder alignment |
| `data` | Data pipelines, schema validation, ML guidance |
| `delivery` | Sprint tracking, cost analysis, release coordination |
| `search` | Code search, symbol lookup, dependency analysis |
| `agentic` | Agent architecture review, safety patterns |
| `memory` | Persistent memory across sessions |
| `brainstorm` | AI-powered brainstorming with focus groups |
| `project` | Project lifecycle and phase management |
| `kanban` | Task boards and work tracking |
| `scenarios` | Scenario-based validation and simulation |
| `patch` | Code patching and diff management |

## Development

```bash
# Install dependencies
cd rde-coding-agent
npm install

# Build
npm run build

# Run tests
npm test

# Clean build artifacts
npm run clean
```

## Project structure

```
rde-coding-agent/
├── src/
│   ├── index.ts              # Public entry point
│   ├── extension.ts          # Extension factory
│   ├── types.ts              # Shared types and pi-mono API surface
│   ├── context/
│   │   └── assembler.ts      # Cross-domain context injection per turn
│   ├── domains/
│   │   ├── engineering/      # Each domain has index.ts + tools.ts
│   │   ├── qe/
│   │   ├── platform/
│   │   ├── product/
│   │   ├── data/
│   │   ├── delivery/
│   │   ├── search/
│   │   ├── agentic/
│   │   ├── memory/
│   │   ├── brainstorm/
│   │   ├── project/
│   │   ├── kanban/
│   │   ├── scenarios/
│   │   └── patch/
│   └── store/                # Persistence layer
├── tests/                    # Vitest test files
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## License

MIT
