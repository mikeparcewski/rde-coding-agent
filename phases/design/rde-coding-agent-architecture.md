# Architecture: rde-coding-agent

**Date**: 2026-02-25
**Status**: Design / Review
**Scope**: npm package `rde-coding-agent` — a pi-mono extension that brings all wicked-garden
capabilities to any pi-mono agent

---

## 1. Overview

`rde-coding-agent` is a single npm package. It installs into `~/.pi/agent/extensions/` (global) or
`.pi/extensions/` (project-local) and registers itself with pi-mono on startup via the extension
factory function `rdeCodingAgent(config)`.

The package maps one-to-one onto the existing wicked-garden capability taxonomy: engineering, qe,
platform, product, data, search, delivery, agentic, memory, brainstorm, project, and kanban. Each
domain is a self-contained module that registers its tools, commands, and lifecycle hooks through
pi-mono's extension API.

The architecture has three structural priorities:

1. **Additive only** — `rdeCodingAgent(config)` registers only the domains you select. Nothing is
   loaded that is not configured. A user who wants only `memory` and `search` gets exactly those.
2. **pi-mono native** — Tools use TypeBox schemas (pi-mono's validation layer), commands use
   `pi.registerCommand`, hooks use `pi.on`. No custom runtime is introduced.
3. **Persistent store is explicit** — Memory and project state live in well-defined directories
   under `~/.pi/agent/wicked/`. Concurrent writes are safe. Schema versions travel with data.

---

## 2. Package Structure

```
rde-coding-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # public entry: export { rdeCodingAgent }
│   ├── extension.ts                # rdeCodingAgent() factory
│   ├── types.ts                    # RdeConfig, DomainName, shared types
│   │
│   ├── domains/
│   │   ├── engineering/
│   │   │   ├── index.ts            # registerDomain(pi, store, config)
│   │   │   ├── tools.ts            # code_review, debug_analyze, architecture_review, generate_docs
│   │   │   └── commands.ts         # /review, /debug, /arch, /docs
│   │   ├── qe/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # test_strategy, generate_scenarios, test_automation
│   │   │   └── commands.ts         # /test-strategy, /scenarios
│   │   ├── platform/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # security_scan, compliance_check, ci_cd_review
│   │   │   ├── commands.ts         # /security, /compliance
│   │   │   └── hooks.ts            # tool_call gate hook
│   │   ├── product/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # elicit_requirements, ux_review, acceptance_criteria
│   │   │   └── commands.ts         # /elicit, /ux-review
│   │   ├── data/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # analyze_dataset, pipeline_review, ml_guidance
│   │   │   └── commands.ts         # /analyze
│   │   ├── search/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # code_search, symbol_refs, blast_radius
│   │   │   └── commands.ts         # /search, /refs, /impact
│   │   ├── delivery/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # experiment_design, risk_assess, progress_report
│   │   │   └── commands.ts         # /experiment, /risk
│   │   ├── agentic/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # agent_review, safety_audit, pattern_check
│   │   │   └── commands.ts         # /agent-review, /safety
│   │   ├── memory/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # remember, recall, forget
│   │   │   ├── commands.ts         # /remember, /recall
│   │   │   ├── hooks.ts            # session_start, context, session_shutdown
│   │   │   └── store.ts            # MemoryStore (JSONL read/write)
│   │   ├── brainstorm/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # brainstorm, quick_jam
│   │   │   ├── commands.ts         # /brainstorm, /jam
│   │   │   └── personas.ts         # built-in persona definitions
│   │   ├── project/
│   │   │   ├── index.ts
│   │   │   ├── tools.ts            # project_start, project_status, project_advance
│   │   │   ├── commands.ts         # /project
│   │   │   ├── hooks.ts            # session_start, session_shutdown
│   │   │   └── store.ts            # ProjectStore (JSON per project)
│   │   └── kanban/
│   │       ├── index.ts
│   │       ├── tools.ts            # task_create, task_list, task_update
│   │       ├── commands.ts         # /task, /board
│   │       └── store.ts            # KanbanStore (JSON, project-scoped)
│   │
│   └── store/
│       ├── base-store.ts           # atomic write, schema version, migration runner
│       ├── jsonl-store.ts          # append-only JSONL for memory
│       └── json-store.ts           # versioned JSON object for project/kanban
└── dist/                           # compiled output (referenced by package.json "main")
```

**Entry point** — `src/index.ts` exports a single symbol:

```typescript
// src/index.ts
export { rdeCodingAgent } from "./extension.js";
export type { RdeConfig, DomainName } from "./types.js";
```

Users drop one file into their extensions directory:

```typescript
// ~/.pi/agent/extensions/wicked.ts
import { rdeCodingAgent } from "rde-coding-agent";

export default rdeCodingAgent({
  capabilities: "all",
  storePath: "~/.pi/agent/wicked",
});
```

---

## 3. Extension Factory

```typescript
// src/types.ts
import { Type, type Static } from "@sinclair/typebox";

export const DomainNameSchema = Type.Union([
  Type.Literal("engineering"),
  Type.Literal("qe"),
  Type.Literal("platform"),
  Type.Literal("product"),
  Type.Literal("data"),
  Type.Literal("search"),
  Type.Literal("delivery"),
  Type.Literal("agentic"),
  Type.Literal("memory"),
  Type.Literal("brainstorm"),
  Type.Literal("project"),
  Type.Literal("kanban"),
]);
export type DomainName = Static<typeof DomainNameSchema>;

export interface RdeConfig {
  // "all" or an explicit list of domains to activate
  capabilities: "all" | DomainName[];
  // base directory for all persistent stores; defaults to ~/.pi/agent/wicked
  storePath?: string;
  // brainstorm-specific: model to use for persona sub-calls
  brainstormModel?: string;
  // platform-specific: if true, tool_call hook blocks dangerous operations
  platformGuardrails?: boolean;
}

// The shape pi-mono expects from an extension module's default export
export interface PiExtension {
  name: string;
  version: string;
  register(pi: PiContext): void | Promise<void>;
}

// Minimal pi-mono context surface used by rde-coding-agent
// (pi-mono provides the real implementation at runtime)
export interface PiContext {
  registerTool(def: ToolDef): void;
  registerCommand(name: string, handler: CommandHandler): void;
  on(event: PiEvent, handler: EventHandler): void;
  ai: PiAI;  // access to @mariozechner/pi-ai
}

export type PiEvent =
  | "session_start"
  | "context"
  | "tool_call"
  | "tool_result"
  | "session_shutdown";

export interface ToolDef {
  name: string;
  label: string;
  description: string;
  parameters: unknown;  // TypeBox TSchema
  execute(args: Record<string, unknown>, ctx: ToolExecuteContext): Promise<unknown>;
}

export interface ToolExecuteContext {
  ui: {
    confirm(message: string): Promise<boolean>;
    showMessage(message: string): void;
  };
  sessionId: string;
}

export type CommandHandler = (args: string, ctx: ToolExecuteContext) => Promise<void>;
export type EventHandler = (event: unknown, ctx: ToolExecuteContext) => Promise<void>;

export interface PiAI {
  streamSimple(options: StreamSimpleOptions): Promise<string>;
}

export interface StreamSimpleOptions {
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
}
```

```typescript
// src/extension.ts
import type { RdeConfig, PiExtension, PiContext, DomainName } from "./types.js";
import { resolveStorePath, expandHome } from "./store/base-store.js";
import { registerEngineering } from "./domains/engineering/index.js";
import { registerQe } from "./domains/qe/index.js";
import { registerPlatform } from "./domains/platform/index.js";
import { registerProduct } from "./domains/product/index.js";
import { registerData } from "./domains/data/index.js";
import { registerSearch } from "./domains/search/index.js";
import { registerDelivery } from "./domains/delivery/index.js";
import { registerAgentic } from "./domains/agentic/index.js";
import { registerMemory } from "./domains/memory/index.js";
import { registerBrainstorm } from "./domains/brainstorm/index.js";
import { registerProject } from "./domains/project/index.js";
import { registerKanban } from "./domains/kanban/index.js";

const ALL_DOMAINS: DomainName[] = [
  "engineering", "qe", "platform", "product", "data",
  "search", "delivery", "agentic", "memory", "brainstorm",
  "project", "kanban",
];

const DOMAIN_REGISTRARS: Record<DomainName, DomainRegistrar> = {
  engineering: registerEngineering,
  qe:          registerQe,
  platform:    registerPlatform,
  product:     registerProduct,
  data:        registerData,
  search:      registerSearch,
  delivery:    registerDelivery,
  agentic:     registerAgentic,
  memory:      registerMemory,
  brainstorm:  registerBrainstorm,
  project:     registerProject,
  kanban:      registerKanban,
};

export type DomainRegistrar = (
  pi: PiContext,
  storePath: string,
  config: RdeConfig
) => void | Promise<void>;

export function rdeCodingAgent(config: RdeConfig): PiExtension {
  const domains: DomainName[] =
    config.capabilities === "all" ? ALL_DOMAINS : config.capabilities;

  const storePath = expandHome(config.storePath ?? "~/.pi/agent/wicked");

  return {
    name: "rde-coding-agent",
    version: "1.0.0",

    async register(pi: PiContext): Promise<void> {
      // Domains activate sequentially so hook registration order is deterministic.
      // If a domain fails to register, it logs a warning and the rest continue.
      for (const domain of domains) {
        const registrar = DOMAIN_REGISTRARS[domain];
        try {
          await registrar(pi, storePath, config);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[rde-coding-agent] Failed to register domain "${domain}": ${message}`);
        }
      }
    },
  };
}
```

---

## 4. Tool Registration Pattern

Every domain follows the same three-file pattern: `tools.ts` defines tool descriptors, `commands.ts`
registers slash commands, and `index.ts` wires them to pi-mono.

### Domain Index (canonical pattern)

```typescript
// src/domains/engineering/index.ts
import type { PiContext } from "../../types.js";
import type { RdeConfig } from "../../types.js";
import { registerEngineeringTools } from "./tools.js";
import { registerEngineeringCommands } from "./commands.js";

export async function registerEngineering(
  pi: PiContext,
  storePath: string,
  config: RdeConfig
): Promise<void> {
  registerEngineeringTools(pi);
  registerEngineeringCommands(pi);
}
```

### Tool Descriptor Pattern (TypeBox schema + typed execute)

Each tool is a plain object literal. The `execute` function receives fully-typed arguments after
pi-mono validates them against the TypeBox schema.

```typescript
// src/domains/engineering/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext, ToolExecuteContext } from "../../types.js";

export function registerEngineeringTools(pi: PiContext): void {
  pi.registerTool({
    name: "code_review",
    label: "Code Review",
    description:
      "Review code for quality, correctness, security issues, and adherence to best practices. " +
      "Returns structured findings grouped by severity.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), {
        description: "File or directory paths to review",
        minItems: 1,
      }),
      focus: Type.Optional(
        Type.Union([
          Type.Literal("security"),
          Type.Literal("performance"),
          Type.Literal("correctness"),
          Type.Literal("style"),
          Type.Literal("all"),
        ], { description: "Review focus area; defaults to 'all'" })
      ),
      context: Type.Optional(
        Type.String({ description: "Additional context about the change intent" })
      ),
    }),
    execute: codeReviewExecute,
  });

  pi.registerTool({
    name: "debug_analyze",
    label: "Debug Analyzer",
    description:
      "Analyze an error, stack trace, or unexpected behaviour. Returns a root cause hypothesis " +
      "and ordered list of investigation steps.",
    parameters: Type.Object({
      error: Type.String({ description: "Error message or stack trace" }),
      code_context: Type.Optional(
        Type.String({ description: "Relevant code snippet where the error occurs" })
      ),
      repro_steps: Type.Optional(
        Type.String({ description: "Steps to reproduce the problem" })
      ),
    }),
    execute: debugAnalyzeExecute,
  });

  pi.registerTool({
    name: "architecture_review",
    label: "Architecture Review",
    description:
      "Validate a system architecture against the five-layer model. Identifies topology " +
      "anti-patterns, missing layers, and scalability risks.",
    parameters: Type.Object({
      description: Type.String({
        description: "Architecture description or path to architecture document",
      }),
      diagram: Type.Optional(
        Type.String({ description: "Mermaid or ASCII diagram of the architecture" })
      ),
    }),
    execute: architectureReviewExecute,
  });

  pi.registerTool({
    name: "generate_docs",
    label: "Generate Documentation",
    description:
      "Generate or update documentation for the given code paths. Supports README, " +
      "API reference, and inline JSDoc/TSDoc.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1 }),
      format: Type.Union([
        Type.Literal("readme"),
        Type.Literal("api"),
        Type.Literal("inline"),
      ], { description: "Documentation format to generate" }),
    }),
    execute: generateDocsExecute,
  });
}

// ── execute implementations ───────────────────────────────────────────────────

async function codeReviewExecute(
  args: { paths: string[]; focus?: string; context?: string },
  _ctx: ToolExecuteContext
): Promise<{ findings: Finding[]; summary: string }> {
  // The execute function returns structured data.
  // pi-mono serialises this and feeds it back to the LLM as a tool result.
  // The actual analysis prompt is handled by the LLM in the next turn.
  // Here we do any file-system work (reading files) and return content.
  const files = await readPaths(args.paths);
  return {
    findings: [],         // populated by LLM in subsequent turn
    summary: `Ready to review ${files.length} file(s). Focus: ${args.focus ?? "all"}.`,
  };
}

async function debugAnalyzeExecute(
  args: { error: string; code_context?: string; repro_steps?: string },
  _ctx: ToolExecuteContext
): Promise<{ hypothesis: string; steps: string[] }> {
  return {
    hypothesis: "",  // LLM fills this
    steps: [],
  };
}

async function architectureReviewExecute(
  args: { description: string; diagram?: string },
  _ctx: ToolExecuteContext
): Promise<{ layers: LayerAssessment[]; topology: string; recommendations: string[] }> {
  return { layers: [], topology: "", recommendations: [] };
}

async function generateDocsExecute(
  args: { paths: string[]; format: string },
  _ctx: ToolExecuteContext
): Promise<{ docs: string; filePath: string }> {
  return { docs: "", filePath: "" };
}

// ── supporting types ──────────────────────────────────────────────────────────

interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

interface LayerAssessment {
  layer: number;
  name: string;
  status: "pass" | "fail" | "warning";
  notes: string;
}

async function readPaths(paths: string[]): Promise<{ path: string; content: string }[]> {
  const { readFile } = await import("node:fs/promises");
  return Promise.all(
    paths.map(async (p) => ({
      path: p,
      content: await readFile(p, "utf-8").catch(() => `<could not read ${p}>`),
    }))
  );
}
```

### Command Registration Pattern

Commands are thin wrappers: they parse the slash-command argument string and invoke the
corresponding tool, or directly call the LLM if no tool is needed.

```typescript
// src/domains/engineering/commands.ts
import type { PiContext, ToolExecuteContext } from "../../types.js";

export function registerEngineeringCommands(pi: PiContext): void {
  pi.registerCommand("/review", async (args: string, ctx: ToolExecuteContext) => {
    // /review <path> [--focus security]
    const { paths, focus } = parseReviewArgs(args);
    ctx.ui.showMessage(`Starting code review for: ${paths.join(", ")}`);
    // Commands delegate to their tool — avoids duplicating logic
    // pi-mono dispatches the tool call back through the LLM turn
  });

  pi.registerCommand("/debug", async (args: string, ctx: ToolExecuteContext) => {
    ctx.ui.showMessage("Debug analyzer ready. Paste error or describe the problem.");
  });

  pi.registerCommand("/arch", async (args: string, ctx: ToolExecuteContext) => {
    ctx.ui.showMessage("Architecture review starting. Provide path or describe the system.");
  });

  pi.registerCommand("/docs", async (args: string, ctx: ToolExecuteContext) => {
    ctx.ui.showMessage("Documentation generator ready.");
  });
}

function parseReviewArgs(args: string): { paths: string[]; focus?: string } {
  const parts = args.trim().split(/\s+/);
  const focusIdx = parts.indexOf("--focus");
  const focus = focusIdx !== -1 ? parts[focusIdx + 1] : undefined;
  const paths = parts.filter((p, i) => p !== "--focus" && i !== focusIdx + 1);
  return { paths: paths.length > 0 ? paths : ["."], focus };
}
```

---

## 5. Value Gate Condition 1 — Multi-Persona Sub-Calls (brainstorm)

The brainstorm domain implements the `/brainstorm` command. Inside the `brainstorm` tool's
`execute()`, it fires parallel persona sub-calls using `pi.ai.streamSimple()` (from
`@mariozechner/pi-ai`), collects all results with `Promise.allSettled`, and synthesises a final
response.

### Why streamSimple

`streamSimple` from `@mariozechner/pi-ai` is a single-shot, non-streaming completion function. It
accepts a system prompt, a user prompt, and an optional model name, and returns a `Promise<string>`.
This is the correct choice for persona calls because:

- Each persona call is independent and fires in parallel — streaming output to the terminal is not
  useful when results are aggregated into a synthesis.
- `streamSimple` is simpler to race against a timeout than the streaming variant.
- `Promise.allSettled` means one persona timing out or erroring does not cancel the others.

### Tool definition

```typescript
// src/domains/brainstorm/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext, PiContext as Ctx, ToolExecuteContext } from "../../types.js";
import { BUILT_IN_PERSONAS, type PersonaDef } from "./personas.js";

const PERSONA_TIMEOUT_MS = 45_000;

export function registerBrainstormTools(pi: PiContext): void {
  pi.registerTool({
    name: "brainstorm",
    label: "Brainstorm",
    description:
      "Run a multi-perspective brainstorm session. Fires parallel persona sub-calls " +
      "then synthesises their outputs into a structured decision record.",
    parameters: Type.Object({
      topic: Type.String({ description: "The question or decision to brainstorm" }),
      personas: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Persona names to engage. Defaults to: architect, skeptic, user-advocate, " +
            "pragmatist, innovator.",
        })
      ),
      context: Type.Optional(
        Type.String({ description: "Background context for the personas" })
      ),
      format: Type.Optional(
        Type.Union([Type.Literal("summary"), Type.Literal("full")], {
          description: "Output format: 'summary' (default) or 'full' with all persona responses",
        })
      ),
    }),
    execute: (args, ctx) => brainstormExecute(args as BrainstormArgs, ctx, pi),
  });

  pi.registerTool({
    name: "quick_jam",
    label: "Quick Jam",
    description: "Fast two-persona jam: critic vs advocate on a specific proposal.",
    parameters: Type.Object({
      proposal: Type.String({ description: "The proposal to evaluate" }),
      context: Type.Optional(Type.String()),
    }),
    execute: (args, ctx) => quickJamExecute(args as QuickJamArgs, ctx, pi),
  });
}

// ── brainstorm execute ────────────────────────────────────────────────────────

interface BrainstormArgs {
  topic: string;
  personas?: string[];
  context?: string;
  format?: "summary" | "full";
}

async function brainstormExecute(
  args: BrainstormArgs,
  ctx: ToolExecuteContext,
  pi: Ctx
): Promise<BrainstormResult> {
  const personaNames = args.personas ?? [
    "architect", "skeptic", "user-advocate", "pragmatist", "innovator",
  ];

  const personas = personaNames.map(
    (name) => BUILT_IN_PERSONAS[name] ?? buildCustomPersona(name)
  );

  ctx.ui.showMessage(`Brainstorming "${args.topic}" with ${personas.length} personas...`);

  // Fire all persona calls in parallel.
  // Promise.allSettled ensures one failure does not cancel others.
  const settled = await Promise.allSettled(
    personas.map((persona) =>
      callPersonaWithTimeout(pi.ai, persona, args.topic, args.context)
    )
  );

  // Collect results, noting any failures.
  const responses: PersonaResponse[] = settled.map((result, i) => {
    const persona = personas[i]!;
    if (result.status === "fulfilled") {
      return { persona: persona.name, content: result.value, error: null };
    }
    const message = result.reason instanceof Error
      ? result.reason.message
      : String(result.reason);
    return { persona: persona.name, content: null, error: message };
  });

  const successful = responses.filter((r) => r.content !== null);

  if (successful.length === 0) {
    throw new Error("All persona calls failed. Cannot produce synthesis.");
  }

  // Synthesise — one final streamSimple call that reads all persona outputs.
  const synthesis = await pi.ai.streamSimple({
    system: SYNTHESIS_SYSTEM_PROMPT,
    prompt: buildSynthesisPrompt(args.topic, responses),
    maxTokens: 2048,
  });

  return {
    topic: args.topic,
    personaResponses: args.format === "full" ? responses : [],
    synthesis,
    successCount: successful.length,
    failureCount: responses.length - successful.length,
  };
}

async function callPersonaWithTimeout(
  ai: Ctx["ai"],
  persona: PersonaDef,
  topic: string,
  context: string | undefined
): Promise<string> {
  const personaPromise = ai.streamSimple({
    system: persona.systemPrompt,
    prompt: buildPersonaPrompt(topic, context),
    maxTokens: 1024,
  });

  // Race against a timeout so one slow persona does not block synthesis.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Persona "${persona.name}" timed out after ${PERSONA_TIMEOUT_MS}ms`)),
      PERSONA_TIMEOUT_MS
    )
  );

  return Promise.race([personaPromise, timeoutPromise]);
}

// ── quick_jam execute ─────────────────────────────────────────────────────────

interface QuickJamArgs {
  proposal: string;
  context?: string;
}

async function quickJamExecute(
  args: QuickJamArgs,
  _ctx: ToolExecuteContext,
  pi: Ctx
): Promise<{ critique: string; advocacy: string; verdict: string }> {
  const [settled] = await Promise.allSettled([
    Promise.all([
      pi.ai.streamSimple({
        system: BUILT_IN_PERSONAS["skeptic"]!.systemPrompt,
        prompt: buildPersonaPrompt(args.proposal, args.context),
        maxTokens: 512,
      }),
      pi.ai.streamSimple({
        system: BUILT_IN_PERSONAS["user-advocate"]!.systemPrompt,
        prompt: buildPersonaPrompt(args.proposal, args.context),
        maxTokens: 512,
      }),
    ]),
  ]);

  if (settled?.status !== "fulfilled") {
    throw new Error("Quick jam failed to complete.");
  }

  const [critique, advocacy] = settled.value;

  const verdict = await pi.ai.streamSimple({
    system: "You are a pragmatic decision maker. Given a critique and advocacy of a proposal, produce a one-paragraph verdict with a clear recommendation.",
    prompt: `Proposal: ${args.proposal}\n\nCritique:\n${critique}\n\nAdvocacy:\n${advocacy}`,
    maxTokens: 256,
  });

  return { critique, advocacy, verdict };
}

// ── prompt builders ───────────────────────────────────────────────────────────

function buildPersonaPrompt(topic: string, context: string | undefined): string {
  return [
    context ? `Context: ${context}` : null,
    `Topic: ${topic}`,
    "Provide your perspective in 3-5 concise paragraphs. Be specific and opinionated.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSynthesisPrompt(topic: string, responses: PersonaResponse[]): string {
  const personaBlock = responses
    .map((r) =>
      r.content
        ? `## ${r.persona}\n${r.content}`
        : `## ${r.persona}\n[FAILED: ${r.error}]`
    )
    .join("\n\n");

  return `Synthesise the following multi-persona brainstorm on the topic: "${topic}"\n\n${personaBlock}\n\nProduce: (1) key themes, (2) points of consensus, (3) points of tension, (4) recommended direction with rationale.`;
}

const SYNTHESIS_SYSTEM_PROMPT =
  "You are a synthesis facilitator. Your role is to distil multiple expert perspectives " +
  "into a coherent, actionable summary. Avoid repeating each perspective verbatim. " +
  "Focus on patterns, tensions, and a clear recommendation.";

// ── supporting types ──────────────────────────────────────────────────────────

interface PersonaResponse {
  persona: string;
  content: string | null;
  error: string | null;
}

interface BrainstormResult {
  topic: string;
  personaResponses: PersonaResponse[];
  synthesis: string;
  successCount: number;
  failureCount: number;
}

function buildCustomPersona(name: string): PersonaDef {
  return {
    name,
    systemPrompt: `You are ${name}. Analyse the topic from your perspective and provide concrete, specific feedback.`,
  };
}
```

```typescript
// src/domains/brainstorm/personas.ts
export interface PersonaDef {
  name: string;
  systemPrompt: string;
}

export const BUILT_IN_PERSONAS: Record<string, PersonaDef> = {
  architect: {
    name: "architect",
    systemPrompt:
      "You are a senior software architect with 20 years of experience designing large-scale " +
      "distributed systems. You think in terms of trade-offs, long-term maintainability, and " +
      "system boundaries. You are sceptical of over-engineering but equally sceptical of " +
      "shortcuts that create future debt.",
  },
  skeptic: {
    name: "skeptic",
    systemPrompt:
      "You are a rigorous critical thinker. Your role is to identify risks, assumptions, " +
      "missing evidence, and failure modes. You are not contrarian — you genuinely want the " +
      "best outcome — but you will challenge every claim that lacks supporting evidence.",
  },
  "user-advocate": {
    name: "user-advocate",
    systemPrompt:
      "You represent the end users of the system. You think about usability, accessibility, " +
      "cognitive load, and whether the solution actually solves the user's problem. You " +
      "consistently ask: 'what does the user actually need here?'",
  },
  pragmatist: {
    name: "pragmatist",
    systemPrompt:
      "You are focused on shipping. You evaluate proposals through the lens of: how long " +
      "will this take, what is the simplest version that delivers value, and what are the " +
      "delivery risks. You respect quality but balance it against time-to-value.",
  },
  innovator: {
    name: "innovator",
    systemPrompt:
      "You think unconventionally. You challenge assumptions about what is technically " +
      "possible and look for solutions that others might dismiss as too ambitious. You " +
      "back up creative ideas with concrete rationale.",
  },
};
```

---

## 6. Value Gate Condition 2 — Persistent Store Schema

All persistent state lives under `~/.pi/agent/wicked/`. Two file formats are used:

- **JSONL** (append-only) for memory entries — safe for concurrent appends, trivially diffable
- **JSON** (versioned object) for project and kanban state — single writer per session,
  written atomically via a temp file + rename

### Directory layout

```
~/.pi/agent/wicked/
├── memory/
│   └── memories.jsonl          # all memory entries, one JSON object per line
├── projects/
│   └── {project-id}.json       # one file per project
└── kanban/
    └── {project-id}.kanban.json
```

### Memory store schema (JSONL)

Each line is one `MemoryEntry` object. The schema version is embedded in each entry so
individual entries can be migrated independently.

```typescript
// src/store/jsonl-store.ts
import { readFile, appendFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface MemoryEntry {
  schemaVersion: 1;                   // increment when shape changes
  id: string;                         // uuid v4
  content: string;                    // the remembered fact
  tags: string[];                     // for recall filtering
  projectId: string | null;           // null = global memory
  createdAt: string;                  // ISO 8601
  sessionId: string;                  // pi-mono session that created this
}

export class JsonlStore<T extends { id: string; schemaVersion: number }> {
  constructor(
    private readonly filePath: string,
    private readonly currentVersion: number,
    private readonly migrate: (raw: Record<string, unknown>) => T
  ) {}

  async append(entry: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    // appendFile is atomic per POSIX on most local filesystems.
    // Concurrent appends from separate processes interleave at line boundaries,
    // which is safe because each line is a complete JSON object.
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async readAll(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") return [];
      throw err;
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const obj = JSON.parse(line) as Record<string, unknown>;
        // Run migration if the entry is on an older version
        return obj["schemaVersion"] === this.currentVersion
          ? (obj as unknown as T)
          : this.migrate(obj);
      });
  }

  async deleteById(id: string): Promise<void> {
    const all = await this.readAll();
    const kept = all.filter((e) => e.id !== id);
    // Rewrite the file. This is the only operation that uses a temp-file rename
    // to be safe. Concurrent readers see either the old or new complete file.
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    await rename(tmp, this.filePath);
  }
}

function dirname(p: string): string {
  return p.split("/").slice(0, -1).join("/");
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}
```

### Project store schema (JSON)

```typescript
// src/store/json-store.ts
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";

export interface ProjectRecord {
  schemaVersion: 1;
  id: string;                        // slug, e.g. "auth-refactor"
  name: string;
  description: string;
  phase: "active" | "paused" | "complete";
  goals: string[];
  createdAt: string;
  updatedAt: string;
  sessionIds: string[];              // all sessions that touched this project
  advances: ProjectAdvance[];        // ordered log of progress entries
}

export interface ProjectAdvance {
  id: string;
  timestamp: string;
  summary: string;
  completedGoals: string[];
  addedGoals: string[];
}

export class JsonStore<T extends { schemaVersion: number }> {
  constructor(
    private readonly currentVersion: number,
    private readonly migrate: (raw: Record<string, unknown>) => T
  ) {}

  async read(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      return obj["schemaVersion"] === this.currentVersion
        ? (obj as unknown as T)
        : this.migrate(obj);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async write(filePath: string, data: T): Promise<void> {
    // Atomic write: write to .tmp then rename.
    // rename(2) is atomic on POSIX. On Windows it is not, but pi-mono targets macOS/Linux.
    // Concurrent write safety: single writer per session (pi-mono is single-process per
    // terminal session). No additional locking is needed.
    const dir = filePath.split("/").slice(0, -1).join("/");
    await mkdir(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmp, filePath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}
```

### Migration strategy

Migrations are synchronous, per-record functions. There is no separate migration runner binary.

```typescript
// src/domains/memory/store.ts
import { join } from "node:path";
import { JsonlStore, type MemoryEntry } from "../../store/jsonl-store.js";

// When the MemoryEntry schema changes:
// 1. Increment schemaVersion in the MemoryEntry interface (e.g., 1 -> 2)
// 2. Add a case to migrateMemoryEntry for version 1 -> 2
// 3. The next readAll() call will migrate entries transparently in memory;
//    they are persisted only if a write operation (deleteById) triggers a rewrite.
function migrateMemoryEntry(raw: Record<string, unknown>): MemoryEntry {
  const version = raw["schemaVersion"] as number | undefined;

  if (version === undefined || version < 1) {
    // Pre-versioned entry — apply base shape
    return {
      schemaVersion: 1,
      id: (raw["id"] as string) ?? crypto.randomUUID(),
      content: (raw["content"] as string) ?? "",
      tags: (raw["tags"] as string[]) ?? [],
      projectId: null,
      createdAt: (raw["createdAt"] as string) ?? new Date().toISOString(),
      sessionId: (raw["sessionId"] as string) ?? "unknown",
    };
  }

  // Future versions: add cases here
  // if (version === 1) { ... migrate to 2 ... }

  return raw as unknown as MemoryEntry;
}

export class MemoryStore {
  private readonly store: JsonlStore<MemoryEntry>;

  constructor(storePath: string) {
    this.store = new JsonlStore<MemoryEntry>(
      join(storePath, "memory", "memories.jsonl"),
      1,
      migrateMemoryEntry
    );
  }

  async remember(
    content: string,
    tags: string[],
    projectId: string | null,
    sessionId: string
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      content,
      tags,
      projectId,
      createdAt: new Date().toISOString(),
      sessionId,
    };
    await this.store.append(entry);
    return entry;
  }

  async recall(query: string, projectId?: string | null): Promise<MemoryEntry[]> {
    const all = await this.store.readAll();
    const lower = query.toLowerCase();

    return all.filter((e) => {
      const matchesProject =
        projectId === undefined ||
        e.projectId === projectId ||
        e.projectId === null;
      const matchesContent = e.content.toLowerCase().includes(lower);
      const matchesTags = e.tags.some((t) => t.toLowerCase().includes(lower));
      return matchesProject && (matchesContent || matchesTags);
    });
  }

  async forget(id: string): Promise<void> {
    await this.store.deleteById(id);
  }
}
```

---

## 7. Capability Domain Map

### Full domain registry

| Domain | Tools | Commands | Hooks |
|---|---|---|---|
| engineering | code_review, debug_analyze, architecture_review, generate_docs | /review, /debug, /arch, /docs | — |
| qe | test_strategy, generate_scenarios, test_automation | /test-strategy, /scenarios | — |
| platform | security_scan, compliance_check, ci_cd_review | /security, /compliance | tool_call (blocking gate) |
| product | elicit_requirements, ux_review, acceptance_criteria | /elicit, /ux-review | — |
| data | analyze_dataset, pipeline_review, ml_guidance | /analyze | — |
| search | code_search, symbol_refs, blast_radius | /search, /refs, /impact | — |
| delivery | experiment_design, risk_assess, progress_report | /experiment, /risk | — |
| agentic | agent_review, safety_audit, pattern_check | /agent-review, /safety | — |
| memory | remember, recall, forget | /remember, /recall | session_start, context, session_shutdown |
| brainstorm | brainstorm, quick_jam | /brainstorm, /jam | — |
| project | project_start, project_status, project_advance | /project | session_start, session_shutdown |
| kanban | task_create, task_list, task_update | /task, /board | — |

### Platform domain — tool_call blocking hook

```typescript
// src/domains/platform/hooks.ts
import type { PiContext, ToolExecuteContext } from "../../types.js";

// Tools that require confirmation before execution.
// These are the destructive or externally-visible operations.
const GUARDED_TOOLS = new Set([
  "security_scan",   // may invoke external scanning services
  "compliance_check",
  "ci_cd_review",
]);

export function registerPlatformHooks(
  pi: PiContext,
  guardrailsEnabled: boolean
): void {
  if (!guardrailsEnabled) return;

  pi.on("tool_call", async (event: unknown, ctx: ToolExecuteContext) => {
    const toolEvent = event as { toolName: string; args: Record<string, unknown> };

    if (!GUARDED_TOOLS.has(toolEvent.toolName)) return;

    const confirmed = await ctx.ui.confirm(
      `Platform tool "${toolEvent.toolName}" is about to run. Proceed?`
    );

    if (!confirmed) {
      // Throwing from a tool_call hook cancels the tool execution.
      throw new Error(
        `Tool "${toolEvent.toolName}" was cancelled by platform guardrail.`
      );
    }
  });
}
```

### Memory domain — complete hook set

```typescript
// src/domains/memory/hooks.ts
import type { PiContext, ToolExecuteContext } from "../../types.js";
import type { MemoryStore } from "./store.js";

// State held for the duration of a session.
// Cleared on session_shutdown.
interface SessionMemoryState {
  sessionId: string;
  projectId: string | null;
  primeMemories: string;  // pre-fetched context blob injected via 'context' hook
}

let sessionState: SessionMemoryState | null = null;

export function registerMemoryHooks(pi: PiContext, store: MemoryStore): void {
  // session_start: identify the current project and pre-fetch relevant memories
  pi.on("session_start", async (event: unknown, _ctx: ToolExecuteContext) => {
    const startEvent = event as { sessionId: string; cwd: string };

    const projectId = await detectProjectId(startEvent.cwd);
    const memories = await store.recall("", projectId);

    sessionState = {
      sessionId: startEvent.sessionId,
      projectId,
      primeMemories: formatMemoriesForContext(memories),
    };
  });

  // context: inject memories into the LLM context before each call.
  // This is the "intelligence layer" — the LLM sees relevant facts without being asked.
  pi.on("context", async (event: unknown, _ctx: ToolExecuteContext) => {
    if (!sessionState?.primeMemories) return;

    const ctxEvent = event as { messages: unknown[]; injectSystemMessage(msg: string): void };
    ctxEvent.injectSystemMessage(
      `[Wicked Memory — Session Context]\n${sessionState.primeMemories}`
    );
  });

  // session_shutdown: persist any transient state
  pi.on("session_shutdown", async (_event: unknown, _ctx: ToolExecuteContext) => {
    sessionState = null;
  });
}

function formatMemoriesForContext(memories: import("./store.js").MemoryEntry[]): string {
  if (memories.length === 0) return "";
  return memories
    .slice(-20)  // last 20 entries to stay within token budget
    .map((m) => `- [${m.tags.join(", ")}] ${m.content}`)
    .join("\n");
}

async function detectProjectId(cwd: string): Promise<string | null> {
  // Check for a .pi/project file in the current working directory or ancestors.
  // Falls back to null (global memory) if no project is detected.
  const { readFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");

  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    try {
      const content = await readFile(join(dir, ".pi", "project"), "utf-8");
      return content.trim();
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
```

---

## 8. Context Hook Design — The Intelligence Layer

The `context` event fires before every LLM call. The memory domain's hook uses it to inject
relevant facts without the user having to explicitly ask. Here is the decision logic:

```typescript
// src/domains/memory/hooks.ts (context handler, expanded)

pi.on("context", async (event: unknown, _ctx: ToolExecuteContext) => {
  if (!sessionState) return;

  const ctxEvent = event as {
    messages: Array<{ role: string; content: string }>;
    turnNumber: number;
    injectSystemMessage(msg: string): void;
  };

  // Decision 1: skip injection on the very first turn (no conversation context yet)
  if (ctxEvent.turnNumber === 0 && sessionState.primeMemories === "") return;

  // Decision 2: extract the most recent user message to drive dynamic recall
  const lastUser = [...ctxEvent.messages]
    .reverse()
    .find((m) => m.role === "user");

  if (!lastUser) return;

  // Decision 3: dynamic recall — search memories relevant to the current query.
  // We run this on turns > 1 to supplement the prime memories loaded at session_start.
  let dynamicMemories: import("./store.js").MemoryEntry[] = [];
  if (ctxEvent.turnNumber > 0) {
    dynamicMemories = await store.recall(lastUser.content, sessionState.projectId);
  }

  // Decision 4: merge prime + dynamic, deduplicate by id, cap at 20 entries.
  const primeSet = new Set(
    parseFormattedMemories(sessionState.primeMemories).map((m) => m.id)
  );
  const merged = [
    ...parseFormattedMemories(sessionState.primeMemories),
    ...dynamicMemories.filter((m) => !primeSet.has(m.id)),
  ].slice(-20);

  if (merged.length === 0) return;

  // Decision 5: inject as a labelled system message so the LLM can attribute the source.
  ctxEvent.injectSystemMessage(
    "[Wicked Memory — Relevant Context]\n" +
    merged.map((m) => `- [${m.tags.join(", ")}] ${m.content}`).join("\n")
  );
});
```

**Relevance decisions, in order:**

1. Turn 0 with no prime memories — skip entirely (nothing to inject, avoid noise).
2. Extract the latest user message as the query signal for dynamic recall.
3. On turn > 0, run a new recall query so memories relevant to the evolving conversation are found.
4. Merge session-prime memories (loaded at `session_start`) with turn-dynamic memories, removing
   duplicates by id. Cap at 20 entries to stay inside a reasonable token budget (~1 500 tokens).
5. Inject as a `[Wicked Memory]`-labelled system message so it is distinct from the agent's persona
   system prompt and the model can weight it appropriately.

The project domain uses the same `context` hook pattern to inject active project goals:

```typescript
// src/domains/project/hooks.ts (context handler sketch)

pi.on("context", async (event: unknown, _ctx: ToolExecuteContext) => {
  if (!activeProject) return;

  const ctxEvent = event as {
    injectSystemMessage(msg: string): void;
  };

  ctxEvent.injectSystemMessage(
    `[Active Project: ${activeProject.name}]\n` +
    `Phase: ${activeProject.phase}\n` +
    `Goals:\n${activeProject.goals.map((g) => `- ${g}`).join("\n")}`
  );
});
```

---

## 9. Memory and Project Tool Schemas

### Memory tools

```typescript
// src/domains/memory/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext, ToolExecuteContext } from "../../types.js";
import type { MemoryStore } from "./store.js";

export function registerMemoryTools(pi: PiContext, store: MemoryStore): void {
  pi.registerTool({
    name: "remember",
    label: "Remember",
    description: "Store a fact, decision, or note for future recall in this or future sessions.",
    parameters: Type.Object({
      content: Type.String({ description: "What to remember" }),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Tags for filtering recall" })
      ),
      project_id: Type.Optional(
        Type.String({ description: "Associate with a specific project; omit for global memory" })
      ),
    }),
    execute: async (args, ctx) => {
      const entry = await store.remember(
        args.content as string,
        (args.tags as string[] | undefined) ?? [],
        (args.project_id as string | undefined) ?? null,
        ctx.sessionId
      );
      return { id: entry.id, stored: true };
    },
  });

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description: "Search stored memories by content or tags. Returns matching entries.",
    parameters: Type.Object({
      query: Type.String({ description: "Search term to match against content and tags" }),
      project_id: Type.Optional(
        Type.String({ description: "Filter to a specific project; omit for all memories" })
      ),
    }),
    execute: async (args, _ctx) => {
      const entries = await store.recall(
        args.query as string,
        args.project_id as string | undefined
      );
      return { entries, count: entries.length };
    },
  });

  pi.registerTool({
    name: "forget",
    label: "Forget",
    description: "Delete a specific stored memory by id.",
    parameters: Type.Object({
      id: Type.String({ description: "The memory entry id to delete" }),
    }),
    execute: async (args, _ctx) => {
      await store.forget(args.id as string);
      return { deleted: true };
    },
  });
}
```

### Project tools

```typescript
// src/domains/project/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext, ToolExecuteContext } from "../../types.js";
import type { ProjectStore } from "./store.js";

export function registerProjectTools(pi: PiContext, store: ProjectStore): void {
  pi.registerTool({
    name: "project_start",
    label: "Start Project",
    description: "Create or resume a wicked project. Sets the active project for this session.",
    parameters: Type.Object({
      id: Type.String({ description: "Project slug (e.g. 'auth-refactor')" }),
      name: Type.String({ description: "Human-readable project name" }),
      description: Type.Optional(Type.String()),
      goals: Type.Optional(
        Type.Array(Type.String(), { description: "Initial project goals" })
      ),
    }),
    execute: async (args, ctx) => {
      const project = await store.startOrResume({
        id: args.id as string,
        name: args.name as string,
        description: (args.description as string | undefined) ?? "",
        goals: (args.goals as string[] | undefined) ?? [],
        sessionId: ctx.sessionId,
      });
      return { project, resumed: project.sessionIds.length > 1 };
    },
  });

  pi.registerTool({
    name: "project_status",
    label: "Project Status",
    description: "Return the current status and progress of a project.",
    parameters: Type.Object({
      id: Type.String({ description: "Project id" }),
    }),
    execute: async (args, _ctx) => {
      const project = await store.get(args.id as string);
      if (!project) return { error: `Project "${args.id}" not found.` };
      return project;
    },
  });

  pi.registerTool({
    name: "project_advance",
    label: "Advance Project",
    description: "Record progress on the active project: log completed goals and add new ones.",
    parameters: Type.Object({
      id: Type.String({ description: "Project id" }),
      summary: Type.String({ description: "Summary of what was accomplished" }),
      completed_goals: Type.Optional(Type.Array(Type.String())),
      new_goals: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (args, ctx) => {
      const advance = await store.advance({
        projectId: args.id as string,
        summary: args.summary as string,
        completedGoals: (args.completed_goals as string[] | undefined) ?? [],
        newGoals: (args.new_goals as string[] | undefined) ?? [],
        sessionId: ctx.sessionId,
      });
      return advance;
    },
  });
}
```

### Kanban tools

```typescript
// src/domains/kanban/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext } from "../../types.js";
import type { KanbanStore } from "./store.js";

export function registerKanbanTools(pi: PiContext, store: KanbanStore): void {
  pi.registerTool({
    name: "task_create",
    label: "Create Task",
    description: "Create a new task on the kanban board for the current project.",
    parameters: Type.Object({
      project_id: Type.String(),
      title: Type.String({ description: "Task title" }),
      description: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([
          Type.Literal("todo"),
          Type.Literal("in-progress"),
          Type.Literal("done"),
          Type.Literal("blocked"),
        ])
      ),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("high"),
          Type.Literal("medium"),
          Type.Literal("low"),
        ])
      ),
    }),
    execute: async (args, _ctx) => {
      return store.createTask({
        projectId: args.project_id as string,
        title: args.title as string,
        description: (args.description as string | undefined) ?? "",
        status: (args.status as "todo" | "in-progress" | "done" | "blocked" | undefined) ?? "todo",
        priority: (args.priority as "high" | "medium" | "low" | undefined) ?? "medium",
      });
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "List Tasks",
    description: "List all tasks for a project, optionally filtered by status.",
    parameters: Type.Object({
      project_id: Type.String(),
      status: Type.Optional(
        Type.Union([
          Type.Literal("todo"),
          Type.Literal("in-progress"),
          Type.Literal("done"),
          Type.Literal("blocked"),
          Type.Literal("all"),
        ])
      ),
    }),
    execute: async (args, _ctx) => {
      return store.listTasks(
        args.project_id as string,
        (args.status as string | undefined) === "all"
          ? undefined
          : (args.status as string | undefined)
      );
    },
  });

  pi.registerTool({
    name: "task_update",
    label: "Update Task",
    description: "Update the status, priority, or description of an existing task.",
    parameters: Type.Object({
      project_id: Type.String(),
      task_id: Type.String(),
      status: Type.Optional(
        Type.Union([
          Type.Literal("todo"),
          Type.Literal("in-progress"),
          Type.Literal("done"),
          Type.Literal("blocked"),
        ])
      ),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("high"),
          Type.Literal("medium"),
          Type.Literal("low"),
        ])
      ),
      description: Type.Optional(Type.String()),
      append_note: Type.Optional(Type.String({ description: "Append a progress note" })),
    }),
    execute: async (args, _ctx) => {
      return store.updateTask({
        projectId: args.project_id as string,
        taskId: args.task_id as string,
        status: args.status as string | undefined,
        priority: args.priority as string | undefined,
        description: args.description as string | undefined,
        appendNote: args.append_note as string | undefined,
      });
    },
  });
}
```

---

## 10. Search Domain — Concrete Tool Schemas

The search domain has the most concrete file-system work and illustrates that tools can do real
computation inside `execute()`, not just return placeholder objects.

```typescript
// src/domains/search/tools.ts
import { Type } from "@sinclair/typebox";
import type { PiContext, ToolExecuteContext } from "../../types.js";

export function registerSearchTools(pi: PiContext): void {
  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description:
      "Search the codebase for a pattern using ripgrep. Returns matching lines with file " +
      "and line number context.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regex or literal search pattern" }),
      paths: Type.Optional(
        Type.Array(Type.String(), { description: "Directories or files to search; defaults to cwd" })
      ),
      file_glob: Type.Optional(
        Type.String({ description: "Glob to filter files, e.g. '**/*.ts'" })
      ),
      case_sensitive: Type.Optional(Type.Boolean()),
      context_lines: Type.Optional(
        Type.Number({ description: "Lines of context around each match; default 2", minimum: 0, maximum: 10 })
      ),
    }),
    execute: codeSearchExecute,
  });

  pi.registerTool({
    name: "symbol_refs",
    label: "Symbol References",
    description:
      "Find all references to a symbol (function, class, variable) across the codebase.",
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to find references for" }),
      paths: Type.Optional(Type.Array(Type.String())),
    }),
    execute: symbolRefsExecute,
  });

  pi.registerTool({
    name: "blast_radius",
    label: "Blast Radius",
    description:
      "Estimate the blast radius of changing a file or symbol: which other files import it, " +
      "and what test files cover it.",
    parameters: Type.Object({
      target: Type.String({ description: "File path or symbol name to analyse" }),
      paths: Type.Optional(Type.Array(Type.String())),
    }),
    execute: blastRadiusExecute,
  });
}

async function codeSearchExecute(
  args: {
    pattern: string;
    paths?: string[];
    file_glob?: string;
    case_sensitive?: boolean;
    context_lines?: number;
  },
  _ctx: ToolExecuteContext
): Promise<{ matches: SearchMatch[]; totalCount: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const rgArgs = [
    "--json",
    args.case_sensitive ? "" : "--ignore-case",
    args.file_glob ? `--glob=${args.file_glob}` : "",
    `--context=${args.context_lines ?? 2}`,
    args.pattern,
    ...(args.paths ?? ["."]),
  ].filter(Boolean);

  try {
    const { stdout } = await execFileAsync("rg", rgArgs, { maxBuffer: 10 * 1024 * 1024 });
    const matches = parseRgJson(stdout);
    return { matches, totalCount: matches.length };
  } catch (err: unknown) {
    // rg exits with code 1 when no matches — that is not an error
    if (isExecError(err) && err.code === 1) {
      return { matches: [], totalCount: 0 };
    }
    throw err;
  }
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

function parseRgJson(output: string): SearchMatch[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { type: string; data: unknown };
      } catch {
        return null;
      }
    })
    .filter((obj): obj is { type: "match"; data: RgMatch } => obj?.type === "match")
    .map((obj) => ({
      file: obj.data.path.text,
      line: obj.data.line_number,
      content: obj.data.lines.text.trimEnd(),
      matchStart: obj.data.submatches[0]?.start ?? 0,
      matchEnd: obj.data.submatches[0]?.end ?? 0,
    }));
}

interface RgMatch {
  path: { text: string };
  line_number: number;
  lines: { text: string };
  submatches: Array<{ start: number; end: number }>;
}

async function symbolRefsExecute(
  args: { symbol: string; paths?: string[] },
  ctx: ToolExecuteContext
): Promise<{ matches: SearchMatch[]; totalCount: number }> {
  // Delegate to code_search with a word-boundary pattern
  return codeSearchExecute(
    { pattern: `\\b${args.symbol}\\b`, paths: args.paths, case_sensitive: true },
    ctx
  );
}

async function blastRadiusExecute(
  args: { target: string; paths?: string[] },
  ctx: ToolExecuteContext
): Promise<{ importers: string[]; testFiles: string[]; directCount: number }> {
  const importPattern = args.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importResults = await codeSearchExecute(
    { pattern: `import.*${importPattern}|require.*${importPattern}`, paths: args.paths },
    ctx
  );
  const testResults = await codeSearchExecute(
    { pattern: importPattern, paths: args.paths, file_glob: "**/*.{test,spec}.{ts,js}" },
    ctx
  );

  const importers = [...new Set(importResults.matches.map((m) => m.file))];
  const testFiles = [...new Set(testResults.matches.map((m) => m.file))];

  return { importers, testFiles, directCount: importers.length };
}

function isExecError(err: unknown): err is { code: number } {
  return typeof err === "object" && err !== null && "code" in err;
}
```

---

## 11. Architecture Layer Map (Five-Layer Model)

| Layer | rde-coding-agent responsibility |
|---|---|
| **1. Cognition** | Tool `execute()` functions gather raw data (file content, search results); the LLM in the next turn reasons over it. Brainstorm personas are explicit cognition sub-agents. |
| **2. Context** | The `context` hook injects memory and project state before every LLM call. `MemoryStore` and `ProjectStore` are the persistent context backends. |
| **3. Interaction** | Every domain exposes `pi.registerTool` and `pi.registerCommand` surfaces. All external I/O (filesystem, rg, git) is confined to tool `execute()` functions. |
| **4. Runtime** | pi-mono owns the runtime loop. `rdeCodingAgent(config)` is additive — it only registers; it does not manage sessions, turns, or retries. |
| **5. Governance** | Platform domain's `tool_call` hook is the confirmation gate. `platformGuardrails: true` in config activates it. The `ctx.ui.confirm()` call provides human-in-the-loop for destructive tools. |

---

## 12. Extension File (complete user-facing example)

```typescript
// ~/.pi/agent/extensions/wicked.ts
import { rdeCodingAgent } from "rde-coding-agent";

export default rdeCodingAgent({
  // Activate specific domains
  capabilities: ["engineering", "qe", "memory", "brainstorm", "project", "kanban"],

  // All persistent state under this path
  storePath: "~/.pi/agent/wicked",

  // Use a faster/cheaper model for brainstorm persona sub-calls
  brainstormModel: "claude-haiku-3-5",

  // Require user confirmation before platform tools run
  platformGuardrails: true,
});
```

For teams that want everything:

```typescript
// ~/.pi/agent/extensions/wicked.ts
import { rdeCodingAgent } from "rde-coding-agent";

export default rdeCodingAgent({
  capabilities: "all",
  storePath: "~/.pi/agent/wicked",
});
```

---

## 13. Key Design Decisions

### D1 — Factory function, not class instantiation

`rdeCodingAgent(config)` returns a plain `PiExtension` object. pi-mono calls `register(pi)` once at
startup. There is no singleton state on the extension object itself — state lives in the store
modules. This makes the extension testable in isolation: pass a mock `PiContext` and assert what
was registered.

### D2 — TypeBox, not Zod

The existing `the-agent` monorepo uses Zod. `rde-coding-agent` uses TypeBox because that is pi-mono's
native schema layer. There is no interoperability problem: the two packages are independent. Users
who run both tools have Zod in `the-agent` and TypeBox in `rde-coding-agent`, which is fine because
they are loaded into separate runtimes.

### D3 — JSONL for memory, JSON for project/kanban

Memory is append-heavy and read-sequential — JSONL is ideal (O(1) appends, full scan on read).
Projects and tasks are read-modify-write objects — a single JSON file per project with atomic
rename is simpler and correct. No SQLite dependency is introduced; this keeps the package portable
and install-size small.

### D4 — streamSimple for brainstorm, not the streaming variant

Persona calls are parallel background operations whose output is aggregated before being shown.
Streaming output to a terminal requires sequential rendering and is not useful when results are
synthesised. `streamSimple` returns `Promise<string>` — clean, composable, timeout-safe with
`Promise.race`.

### D5 — Domain failures are isolated

In `rdeCodingAgent.register()`, each domain registrar is wrapped in try/catch. A misconfigured or
broken domain logs a warning and the rest of the extension continues loading. A user who enables
`"all"` domains but has a broken store path for `project` still gets the other eleven domains.

### D6 — Context injection is additive, not replacing

The `context` hook calls `injectSystemMessage()` — it adds a labelled block to the LLM context. It
does not replace the agent's system prompt. This means rde-coding-agent works with any pi-mono agent
persona without modification.

### D7 — No tool timeout management in rde-coding-agent

pi-mono manages per-tool timeouts at the runtime layer. `rde-coding-agent` does not implement its own
timeout wrapping on tool `execute()` calls (except for the brainstorm persona sub-calls, which are
explicitly user-facing latency boundaries that rde-coding-agent controls).
