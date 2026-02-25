# Test Strategy: the-agent Framework

## Document Metadata

| Field | Value |
|---|---|
| Project | the-agent |
| Version | v0.1 (MVP) |
| Date | 2026-02-25 |
| Status | Draft |
| Source documents | `phases/design/architecture.md`, `phases/clarify/acceptance-criteria.md` |

---

## 1. Test Pyramid

The test suite follows a strict pyramid shape across three tiers. Tests are written in Vitest
throughout. The design decision in ADR-001 (layered monolith with interface contracts) enables
each package to be tested in isolation using interface mocks, which is the primary driver of
the unit-to-integration ratio.

```
              /\
             /E2E\           CLI scenario tests — 10 reference tasks (AC-3)
            /------\
           /        \
          /Integration\      Cross-package wiring — 8 boundary scenarios
         /------------\
        /              \
       /   Unit Tests   \    Per-package function and class tests
      /------------------\
```

### 1.1 Unit Tests (Vitest, per package)

Unit tests run in isolation. All cross-package dependencies are mocked via Vitest's `vi.mock()`
or manual stub objects that satisfy the TypeScript interfaces exported from `@the-agent/core`.
No real LLM calls are ever made in unit tests.

#### Package: @the-agent/core

The core package owns the most critical runtime path and carries the highest coverage target (90%).

| Module | What to test |
|---|---|
| `runtime-state.ts` | `appendMessage`, `advanceTurn`, `setPhase`, `recordToolCall`, `recordToolResult` produce correct snapshots; snapshot is frozen (cannot be mutated by caller); initial state is `idle` phase with empty arrays |
| `runtime-loop.ts` | State machine transitions: `idle → assembling_context → awaiting_completion → idle` for text signal; `awaiting_completion → dispatching_tools → awaiting_tool_results → assembling_context` for tool_use signal; `error` state with `retryable=true` retries up to 3 times with exponential delay; `error` with `retryable=false` emits to REPL and returns to `idle`; `maxTurns` enforcement stops the loop |
| `context-assembler.ts` | Builds `Message[]` in correct order (system → memory context → history → current); truncates oldest messages when token budget exceeded; injects `[Memory Context]` as separate system message when memory is enabled; does not include tool result messages that have no matching tool call in history |
| `tool-dispatcher.ts` | Dispatches tool calls in parallel via `Promise.all`; filters tools against agent `allowedTools` list before invocation; tool not in `allowedTools` returns `ToolResult.error` without calling handler; `Promise.race` enforces `timeout_ms`; handler timeout surfaces as `ToolResult.error`; `durationMs` is recorded accurately |
| `cache/cache-layer.ts` | LRU eviction when `maxSizeMb` exceeded; TTL expiry returns cache miss; cache key is `sha256(model + JSON.stringify(messages))`; cache disabled when `enabled=false` in config |
| `memory/json-file-memory.ts` | Persists entries across instantiation cycles; respects `maxEntries` limit with FIFO eviction; returns empty array on first read of non-existent file |
| `memory/sqlite-memory.ts` | Same contract tests as `json-file-memory.ts`; verifies SQL schema is created on init |
| `intent/router.ts` (Tier 1) | Keyword match above threshold returns `tier: "fast"` result; regex pattern match fires correctly; case-insensitive matching; confidence below 0.75 returns `undefined` from Tier 1 (triggers Tier 2) |
| `intent/router.ts` (Tier 2) | LLM classifier is invoked only when Tier 1 confidence < 0.75; classifier result is cached for identical inputs; cache hit skips second LLM call; LLM response parsed as capability tag |
| `interfaces/*.ts` (Zod schemas) | Valid objects parse without error; objects missing required fields throw `ZodError`; `MessageSchema` rejects non-UUID `id`; `ToolSchema` rejects names not matching `/^[a-z][a-z0-9_-]*$/`; `SkillFrontmatterSchema` rejects names not starting with `/`; `AgentFrontmatterSchema` rejects temperature outside 0–2 |

File locations:
- `packages/core/tests/runtime-state.test.ts`
- `packages/core/tests/runtime-loop.test.ts`
- `packages/core/tests/context-assembler.test.ts`
- `packages/core/tests/tool-dispatcher.test.ts`
- `packages/core/tests/cache-layer.test.ts`
- `packages/core/tests/intent-router.test.ts`
- `packages/core/tests/schemas.test.ts`

#### Package: @the-agent/providers

Provider adapters are thin wrappers over vendor SDKs. Coverage target is 70% because the
meaningful behaviour lives in the vendor SDK, not in the adapter code. Tests mock `fetch` or
the SDK client object.

| Module | What to test |
|---|---|
| `anthropic/anthropic-adapter.ts` | `complete()` maps Anthropic `stop_reason: "end_turn"` to `CompletionSignal{type:"text"}`; maps `stop_reason: "tool_use"` to `CompletionSignal{type:"tool_use"}` with correct `calls` array; maps non-2xx HTTP response to `CompletionSignal{type:"error", retryable:true}`; `health()` returns `{ok:true, latencyMs: <number>}` on 200; `health()` returns `{ok:false}` on network error |
| `openai/openai-adapter.ts` | Same contract tests adapted for OpenAI response shapes; `finish_reason: "stop"` maps to text signal; `finish_reason: "tool_calls"` maps to tool_use signal |
| `google/google-adapter.ts` | Maps Gemini response shape to `CompletionSignal`; validates `supportedModels` list includes known Gemini models |
| `ollama/ollama-adapter.ts` | Works with `baseUrl` override; returns `retryable:true` error when Ollama server is unreachable |
| `factory.ts` | `createAdapter({provider:"anthropic",...})` returns an `AnthropicAdapter` instance; `createAdapter({provider:"ollama",...})` returns `OllamaAdapter`; unknown provider string throws at construction |

File locations:
- `packages/providers/tests/anthropic-adapter.test.ts`
- `packages/providers/tests/openai-adapter.test.ts`
- `packages/providers/tests/google-adapter.test.ts`
- `packages/providers/tests/ollama-adapter.test.ts`
- `packages/providers/tests/factory.test.ts`

#### Package: @the-agent/skills

Skills package owns the loading pipeline (5 stages). Each stage is independently testable.

| Module | What to test |
|---|---|
| `loader/frontmatter-parser.ts` | Valid frontmatter parses and returns `SkillFrontmatter`; missing `name` field throws in strict mode, returns `undefined` in permissive; `name` not starting with `/` fails validation; `requiresHandler: true` is preserved in output |
| `loader/handler-resolver.ts` | `skills/commit/index.md` resolves handler at `skills/commit/handler.ts`; `skills/summarize.md` resolves handler at `skills/summarize.ts` when it exists; returns `undefined` when no handler file found; returns `undefined` when `requiresHandler: false` and handler absent |
| `loader/template-interpolator.ts` | `{{text}}` replaced with parameter value; `{{length \| "medium"}}` uses default when parameter absent; unknown parameters left as-is (permissive) or throws (strict); nested `{{` are not treated as nested templates |
| `loader/skill-loader.ts` | Runs all five pipeline stages; glob discovers all `.md` files in `skillsDir`; `skillMode: "strict"` throws on first validation error; `skillMode: "permissive"` skips malformed files and continues; handler module export shape is validated via `SkillHandler` interface |
| `registry/skill-registry.ts` | `register(skill)` stores by `frontmatter.name`; `get("/summarize")` returns correct skill; `list()` returns all registered skills; duplicate name in permissive mode: last-wins; duplicate name in strict mode: throws |

Fixtures directory (`packages/skills/tests/fixtures/`):
```
fixtures/
├── summarize.md          # valid, no handler
├── commit/
│   ├── index.md          # valid, requiresHandler: true
│   └── handler.ts        # valid SkillHandler export
├── bad-name.md           # frontmatter name is "missing-slash" (no leading /)
├── missing-handler.md    # requiresHandler: true but no handler.ts present
└── malformed.md          # YAML frontmatter is syntactically invalid
```

File locations:
- `packages/skills/tests/frontmatter-parser.test.ts`
- `packages/skills/tests/handler-resolver.test.ts`
- `packages/skills/tests/template-interpolator.test.ts`
- `packages/skills/tests/skill-loader.test.ts`
- `packages/skills/tests/skill-registry.test.ts`

#### Package: @the-agent/agents

Mirrors the skills package structure. Same pipeline, different schema.

| Module | What to test |
|---|---|
| `loader/frontmatter-parser.ts` | Valid frontmatter parses to `AgentFrontmatter`; `id` not matching `/^[a-z][a-z0-9-]*$/` throws; `temperature` outside 0–2 throws; default `allowedTools: ["*"]` applied when absent; default `maxTurns: 30` applied when absent |
| `loader/system-prompt-builder.ts` | Markdown body alone becomes full system prompt; `systemPrompt` in frontmatter is prepended; both present: frontmatter prompt + newline + markdown body; neither present: empty string |
| `loader/hooks-resolver.ts` | `agents/coder.md` resolves hooks at `agents/coder.hooks.ts` when file exists; returns `undefined` when no hooks file; loaded hooks module is validated for `{beforeTurn?, afterTurn?, onError?}` shape |
| `loader/agent-loader.ts` | Discovers all `.md` files in `agentsDir`; duplicate agent `id` always throws (no permissive mode for agents); hooks module that throws at import logs error and skips (does not crash loader) |
| `registry/agent-registry.ts` | `get("coder")` returns correct config; `list()` returns all agents; `get("nonexistent")` returns `undefined` |

Fixtures directory (`packages/agents/tests/fixtures/`):
```
fixtures/
├── default.md            # minimal valid agent (no model override)
├── coder.md              # full-featured agent with allowedTools
├── coder.hooks.ts        # valid hooks export
├── duplicate-id.md       # same id as coder.md (for conflict test)
└── bad-id.md             # id: "Bad-Agent" (uppercase, fails regex)
```

File locations:
- `packages/agents/tests/frontmatter-parser.test.ts`
- `packages/agents/tests/system-prompt-builder.test.ts`
- `packages/agents/tests/hooks-resolver.test.ts`
- `packages/agents/tests/agent-loader.test.ts`
- `packages/agents/tests/agent-registry.test.ts`

#### Package: @the-agent/cli

The CLI package owns configuration parsing, slash-command dispatch, and the validate subcommand.
REPL interaction is harder to unit test (readline wraps stdin/stdout) and is covered at the E2E
tier.

| Module | What to test |
|---|---|
| `define-framework.ts` | Valid config passes Zod parse and returns identical object; missing `llm.apiKey` throws `ZodError`; `ollama` provider config does not require `apiKey`; default values (`skillMode: "permissive"`, `skillsDir: "./skills"`) are applied when absent |
| `dispatch/slash-command-dispatcher.ts` | `/summarize` dispatches to the `summarize` skill by name lookup; unrecognised `/command` returns error message; dispatcher calls `SkillRegistry.get()` and invokes `tool.handler`; result is formatted by `output-formatter.ts` |
| `config/team-config.ts` | Valid `.agent/config.yaml` parses against `TeamConfigSchema`; unknown top-level keys rejected by `.strict()` mode; `compat_mode: true` enables alias resolution; tool entry with name violating regex throws |
| `compat/aliases.ts` | `/wicked-engineering:review` resolves to `"code-review"` capability; unknown alias returns `undefined`; narration includes "Alias: ... →" prefix; deprecation notice fires once per session |
| `validate` command logic | Reports exit code 0 when all checks pass; reports exit code 1 on schema error; reports exit code 0 with warning on duplicate id; lists resolved routing table with `--verbose`; makes zero LLM calls |

File locations:
- `packages/cli/tests/define-framework.test.ts`
- `packages/cli/tests/slash-command-dispatcher.test.ts`
- `packages/cli/tests/team-config.test.ts`
- `packages/cli/tests/aliases.test.ts`
- `packages/cli/tests/validate-command.test.ts`

---

### 1.2 Integration Tests

Integration tests exercise two or more real packages together without mocking internal module
boundaries. The LLM adapter is always replaced with the `MockLLMAdapter` (see section 3.1).
Tests run against real file system fixtures under `tests/integration/fixtures/`.

#### Scenario 1: Skill loading pipeline feeds SkillRegistry

```
loadSkills(fixturesDir) -> SkillRegistry -> SkillRegistry.list()
```

Assert that:
- All valid `.md` files in the fixture directory appear in the registry.
- Skills with a valid co-located `handler.ts` have `tool.handler` pointing to the imported function.
- Markdown-only skills have `tool.handler` that is the synthesized interpolation function.
- Malformed files are absent from the registry when `skillMode: "permissive"`.

#### Scenario 2: Agent loading pipeline feeds AgentRegistry

```
loadAgents(fixturesDir) -> AgentRegistry -> AgentRegistry.list()
```

Assert that:
- All valid agent `.md` files appear in the registry.
- System prompt is correctly assembled (frontmatter prefix + markdown body).
- Agents with a `.hooks.ts` file have lifecycle hooks bound.
- Duplicate agent id throws regardless of skill mode.

#### Scenario 3: SkillRegistry wires into ToolDispatcher

```
SkillRegistry -> ToolDispatcher -> tool.handler invoked
```

Assert that:
- A tool call for a registered skill name dispatches to the correct handler.
- `allowedTools: ["commit"]` prevents dispatch of a tool not in the list.
- `allowedTools: ["*"]` allows any registered tool to be dispatched.
- Tool timeout fires `ToolResult.error` containing "timeout".

#### Scenario 4: AgentRegistry resolution flows into RuntimeLoop turn

```
AgentRegistry.get(agentId) -> RuntimeLoop.turn(userMessage) -> MockLLMAdapter -> CompletionSignal
```

Assert that:
- The system prompt from the resolved agent is included as the first message to the mock adapter.
- A `text` signal from the mock adapter advances phase to `idle` and returns the text.
- A `tool_use` signal triggers tool dispatch before the next adapter call.
- `maxTurns` from the agent config is respected by the loop.

#### Scenario 5: Intent router Tier 1 → Tier 2 fallback

```
IntentRouter.route("analyze security posture of auth module") -> RoutingResult
```

Assert that:
- High-confidence phrase (e.g., "review my code") resolves via Tier 1 without calling the mock adapter.
- Low-confidence phrase invokes the mock adapter's `complete()` for classification.
- Tier 2 result is cached; a second identical call does not invoke the adapter again.

#### Scenario 6: .agent/ directory customization merges with built-ins

```
FrameworkLoader(agentConfigTs, agentDir=".agent/") -> merged SkillRegistry + AgentRegistry
```

Assert that:
- Custom skill in `.agent/skills/` appears in registry alongside built-in skills.
- Custom agent with same `id` as a built-in agent overrides the built-in (last-writer wins).
- Capability map override in `.agent/config.yaml` changes which agent handles `code-review`.

#### Scenario 7: CompletionContract evaluation in RuntimeLoop

```
RuntimeLoop.turn() -> MockLLMAdapter returns text -> CompletionContract.evaluate() -> done or continue
```

Assert that:
- Contract with `check: "assertion"` that returns `true` sets `done: true` and stops the loop.
- Contract with `check: "artifact"` and `artifactPattern: "*.md"` checks file existence.
- Loop exits at `maxTurns` even when conditions are not satisfied, with `done: false` in result.

#### Scenario 8: validate command runs against fixture .agent/ directory

```
validateCommand(fixturesAgentDir) -> { exitCode, report }
```

Assert that:
- A clean `.agent/` fixture exits with code 0.
- A fixture with a skill schema error exits with code 1 and the report names the file.
- A fixture with a duplicate skill id (built-in vs. custom) exits with code 0 with a warning.
- A fixture with a tool reference in `allowedTools` that has no registered skill exits with code 1.

Integration test file locations:
```
tests/integration/
├── skill-loading-pipeline.test.ts
├── agent-loading-pipeline.test.ts
├── skill-registry-tool-dispatch.test.ts
├── agent-resolution-runtime-loop.test.ts
├── intent-router-tier-fallback.test.ts
├── agent-dir-customization.test.ts
├── completion-contract-evaluation.test.ts
└── validate-command-integration.test.ts
```

Shared fixtures:
```
tests/integration/fixtures/
├── skills/
│   ├── summarize.md
│   ├── commit/
│   │   ├── index.md
│   │   └── handler.ts
│   └── malformed.md
├── agents/
│   ├── default.md
│   ├── coder.md
│   └── coder.hooks.ts
└── dot-agent/                      # simulates the .agent/ directory
    ├── config.yaml
    ├── agents/
    │   └── custom-reviewer.md      # overrides "senior-engineer" built-in
    └── skills/
        └── internal-scan.md
```

---

### 1.3 E2E Tests

E2E tests exercise the full CLI pipeline from config load through REPL dispatch to final output.
They use the `MockLLMAdapter` scripted with predetermined response sequences. No real API keys
or network calls are involved. Tests are driven programmatically (not via stdin/TTY) by calling
the internal `createCLI().runHeadless(input)` API that returns a promise of the session output.

The 10 reference tasks from AC-3 form the required E2E suite. Each scenario must reach
`CompletionResult.done = true` within the configured `maxTurns`.

See section 2.3 for the full E2E scenario specifications per acceptance criterion.

E2E test file locations:
```
tests/e2e/
├── ac3-task-01-single-file-review.test.ts
├── ac3-task-02-multi-file-review.test.ts
├── ac3-task-03-test-strategy.test.ts
├── ac3-task-04-bug-investigation.test.ts
├── ac3-task-05-architecture-analysis.test.ts
├── ac3-task-06-security-scan.test.ts
├── ac3-task-07-requirements-elicitation.test.ts
├── ac3-task-08-brainstorming-session.test.ts
├── ac3-task-09-refactoring-task.test.ts
├── ac3-task-10-multi-phase-workflow.test.ts
└── helpers/
    ├── mock-llm-adapter.ts
    ├── headless-cli.ts
    └── scripted-response.ts
```

---

## 2. Key Test Scenarios per Acceptance Criterion

### 2.1 AC-1: Single Install, Working Agent

**Criterion**: `npx create-the-agent my-project && cd my-project && npm start` produces a running
agent with at least one built-in skill and agent active in under 5 minutes.

| Scenario | Test tier | Assertion |
|---|---|---|
| `defineFramework()` validates a minimal config without throwing | Unit (cli) | `expect(() => defineFramework({llm:{provider:"anthropic",apiKey:"test"}})).not.toThrow()` |
| `loadSkills()` with built-in skills dir registers at least 1 skill | Integration | `expect(registry.list().length).toBeGreaterThan(0)` |
| `loadAgents()` with built-in agents dir registers at least 1 agent | Integration | `expect(registry.list().length).toBeGreaterThan(0)` |
| `createCLI().start()` resolves (does not throw on startup) with mock adapter | E2E | CLI starts, emits ready prompt within 3s |
| Cold start time of full loading pipeline | Performance | `loadSkills() + loadAgents()` completes in < 500ms on a warm Node.js process (leaves room for 3s total cold start budget including Node.js startup) |

Note: The 5-minute "zero to running" target includes `npm install` and `npx` network time, which
are infrastructure concerns outside the test suite. The performance test covers the subset the
framework controls.

### 2.2 AC-2: Intent-Driven Routing

**Criterion**: Correct routing on >= 80% of 50 labeled developer intents, with narration line
emitted.

#### Intent Corpus File

The corpus lives at `tests/fixtures/intent-corpus.json`:

```json
[
  {
    "id": "eng-01",
    "input": "review the auth module for security issues",
    "expectedCapability": "code-review",
    "category": "engineering"
  },
  {
    "id": "eng-02",
    "input": "debug why my API calls are timing out",
    "expectedCapability": "debug",
    "category": "engineering"
  },
  {
    "id": "eng-03",
    "input": "refactor the payment service to use the repository pattern",
    "expectedCapability": "refactor",
    "category": "engineering"
  },
  ...
]
```

Full corpus: 50 entries covering:
- 15 engineering intents (ids: `eng-01` to `eng-15`)
- 10 quality intents (ids: `qe-01` to `qe-10`)
- 10 orchestration intents (ids: `orch-01` to `orch-10`)
- 8 platform intents (ids: `plat-01` to `plat-08`)
- 7 product intents (ids: `prod-01` to `prod-07`)

#### Test Scenarios

| Scenario | Test tier | Assertion |
|---|---|---|
| Routing accuracy across full 50-intent corpus | Integration | `accuracy >= 0.80` (40 of 50 correct) |
| High-confidence engineering intent resolves via Tier 1 | Integration | `result.tier === "fast"`, `result.confidence >= 0.75` |
| Low-confidence ambiguous intent escalates to Tier 2 | Integration | Mock adapter called for classification; `result.tier === "llm"` |
| Narration line contains capability and agent name | Integration | Output matches `"Treating this as {capability} using {agent}. Starting."` |
| Routing result schema validates against `RoutingResultSchema` | Unit (core) | `RoutingResultSchema.parse(result)` does not throw |
| Custom signal from `.agent/signals/` is honoured | Integration | Custom YAML signal with new keyword routes to correct capability |
| `router.getRoutingTable()` returns complete capability → agent map | Unit (core) | All 25 capability tags present in returned `Map` |

**Accuracy measurement test** (`tests/integration/routing-accuracy.test.ts`):

```typescript
import corpus from "../fixtures/intent-corpus.json";

test("intent routing achieves >= 80% accuracy on 50-intent corpus", async () => {
  const router = buildRouter(mockRuntimeSnapshot);
  let correct = 0;

  for (const entry of corpus) {
    const result = await router.route(entry.input, mockRuntimeSnapshot);
    if (result.capability === entry.expectedCapability) correct++;
  }

  const accuracy = correct / corpus.length;
  expect(accuracy).toBeGreaterThanOrEqual(0.80);
});
```

### 2.3 AC-3: Stay Until Complete (Reference Task Suite)

**Criterion**: 100% pass rate on 10 reference tasks. Each task must satisfy its completion
contract and produce a structured summary.

Each E2E test uses `MockLLMAdapter` scripted with a response sequence that simulates realistic
agent behaviour (initial text response, optional tool calls, final text with findings).

#### Task 1: Code review of a single file

- Setup: Fixture file `tests/e2e/fixtures/auth-login.ts` (50 lines, 2 deliberate issues).
- Mock adapter script: Turn 1 returns `tool_use{name:"read_file"}`, Turn 2 returns text with findings and summary.
- Contract conditions: `findings` assertion returns true when response contains "Finding"; `summary` assertion returns true when response contains "Summary".
- Assert: `CompletionResult.done === true`, `satisfiedConditions` includes `["findings","summary"]`, `artifacts` is empty (review only).

#### Task 2: Multi-file code review

- Setup: 3 fixture files in `tests/e2e/fixtures/multi-review/`.
- Mock adapter script: 3 read_file tool calls (one per file), then consolidated report.
- Assert: All 3 files referenced in turn history; `done === true`; `turnsUsed <= 6`.

#### Task 3: Test strategy generation

- Setup: Fixture `tests/e2e/fixtures/payment-service/` directory with 2 source files.
- Mock adapter script: Returns markdown test strategy doc content; mock file system write.
- Contract condition `strategy-doc`: checks for artifact matching `**/test-strategy.md`.
- Assert: `done === true`; `artifacts` includes a path matching `test-strategy.md`.

#### Task 4: Bug investigation

- Setup: Fixture error log `tests/e2e/fixtures/bug-report.txt`.
- Mock adapter script: Tool call to read log, then text response with root cause identified.
- Contract condition: `done_condition: "root cause identified"` — assertion checks response for "root cause".
- Assert: `done === true` OR response contains explicit "unresolvable" marker.

#### Task 5: Architecture analysis

- Setup: Fixture `tests/e2e/fixtures/system-diagram/` with component descriptions.
- Mock adapter script: Produces architecture diagram (mermaid) and recommendations text.
- Contract conditions: `diagram` assertion (mermaid block present) and `recommendations` assertion.
- Assert: `done === true`; `turnsUsed <= 10`.

#### Task 6: Security scan

- Setup: Fixture source files with 3 known vulnerability patterns.
- Mock adapter script: Tool calls to read files, then structured findings categorized by severity.
- Contract conditions: `all-checks-run` and `findings-categorized` assertions.
- Assert: `done === true`; response includes severity categories (critical/high/medium/low).

#### Task 7: Requirements elicitation

- Setup: Fixture `tests/e2e/fixtures/user-stories.md` with 3 user stories.
- Mock adapter script: Returns acceptance criteria for each story.
- Contract conditions: `acceptance-criteria` artifact check for `*.md`.
- Assert: `done === true`; `artifacts` non-empty.

#### Task 8: Brainstorming session

- Setup: Input prompt "brainstorm API authentication strategies".
- Mock adapter script: Returns 5 ideas, then synthesis with decision record.
- Contract condition `synthesis`: assertion checks for "Decision Record" in response.
- Assert: `done === true`; `turnsUsed <= 5`.

#### Task 9: Refactoring task

- Setup: Fixture file `tests/e2e/fixtures/legacy-service.ts` (procedural, no error handling).
- Mock adapter script: Tool calls to read and write file, then confirmation that tests pass.
- Contract conditions: `code-changes-applied` (artifact check) and `tests-pass` (assertion).
- Assert: `done === true`; `artifacts` includes the modified file path.

#### Task 10: Multi-phase workflow (clarify → build → review)

- Setup: Input "start a new feature: user notification service".
- Mock adapter script: 3-phase sequence — clarify (produces requirements), build (produces code), review (produces findings).
- Contract condition: `all-phases-complete` assertion checks for phase completion markers in session history.
- Assert: `done === true`; `turnsUsed >= 3` (at least one turn per phase); final summary references all three phases.

**All 10 tasks must pass**. CI marks the suite as failed if any single task produces `done === false` or throws.

### 2.4 AC-4: .agent/ Directory Customization

**Criterion**: Custom agent definition → working custom capability in < 15 minutes (time is a
documentation/UX concern, not a test concern). The test concern is correctness of the loading
and override behaviour.

| Scenario | Test tier | Assertion |
|---|---|---|
| Custom agent in `.agent/agents/` appears in AgentRegistry after startup | Integration | `registry.get("custom-reviewer")` returns defined config |
| Custom skill in `.agent/skills/` appears in SkillRegistry | Integration | `registry.get("/internal-scan")` is defined |
| Capability override in `.agent/config.yaml` routes `code-review` to custom agent | Integration | `router.getRoutingTable().get("code-review") === "custom-reviewer"` |
| Provider override in `.agent/config.yaml` selects named provider for capability | Integration | Mock adapter factory records which adapter was selected per capability |
| `.agent/` built-in override (same id as built-in) last-writer wins | Integration | Post-load registry returns the `.agent/` version of the agent |
| `.agent/config.yaml` with unknown top-level key fails validation | Unit (cli) | `TeamConfigSchema.strict().parse({unknownKey:true})` throws `ZodError` |

### 2.5 AC-5: Multi-Provider Support

**Criterion**: Successful execution with at least 2 different LLM providers.

| Scenario | Test tier | Assertion |
|---|---|---|
| `createAdapter({provider:"anthropic",...})` returns `AnthropicAdapter` | Unit (providers) | `instanceof AnthropicAdapter` |
| `createAdapter({provider:"openai",...})` returns `OpenAIAdapter` | Unit (providers) | `instanceof OpenAIAdapter` |
| `createAdapter({provider:"google",...})` returns `GoogleAdapter` | Unit (providers) | `instanceof GoogleAdapter` |
| `createAdapter({provider:"ollama",...})` returns `OllamaAdapter` | Unit (providers) | `instanceof OllamaAdapter` |
| Runtime loop uses the adapter injected from config, not a hardcoded import | Integration | Loop invokes `mockAdapter.complete()` when `MockLLMAdapter` is injected |
| Capability-level provider routing in `.agent/config.yaml` selects per-capability adapter | Integration | Different capabilities use different mock adapter instances |
| `health()` returns `{ok:true}` when vendor endpoint responds | Unit (providers) | Mocked `fetch` returns 200; `health()` result `ok === true` |

### 2.6 AC-6: Built-in Capability Inventory

**Criterion**: Stage 1 capabilities ship at v0.1, verified against the wicked-garden source inventory.

| Scenario | Test tier | Assertion |
|---|---|---|
| Built-in agent inventory: all 11 agents registered at startup | Integration | `loadAgents(builtinsDir).list().length === 11` |
| Built-in skill inventory: all 12 skills registered at startup | Integration | `loadSkills(builtinsDir).list().length === 12` |
| All Stage 1 capability tags exist in `CapabilityTagSchema` | Unit (core) | `CapabilityTagSchema.enum` includes all 15 Stage 1 tags |
| Default capability map has an entry for every Stage 1 tag | Unit (core) | `Object.keys(DEFAULT_CAPABILITY_MAP)` includes all 15 Stage 1 tags |
| Each built-in agent resolves from `DEFAULT_CAPABILITY_MAP` | Unit (core) | `AgentRegistry.get(DEFAULT_CAPABILITY_MAP[tag])` is defined for all tags |

**Parity checklist** (lives at `tests/fixtures/capability-parity-checklist.json`): A machine-readable
list of the 97 wicked-garden commands and their expected equivalent in the-agent. The `agent validate`
command outputs coverage against this list in verbose mode. A dedicated CI check compares the
checklist against the live registry at build time.

### 2.7 AC-7: Validation Subcommand

**Criterion**: `agent validate` catches all common config errors, exits 0/1, makes no LLM calls.

| Scenario | Test tier | Assertion |
|---|---|---|
| Clean `.agent/` exits with code 0 | Integration | Exit code 0; report says "All checks passed" |
| Schema error in `config.yaml` exits with code 1 | Integration | Exit code 1; report names the offending key |
| Unresolved capability → agent reference exits with code 1 | Integration | Exit code 1; message includes capability name |
| Unresolved tool reference in `allowedTools` exits with code 1 | Integration | Exit code 1; message includes tool name |
| Duplicate skill id (built-in vs. custom) exits code 0 with warning | Integration | Exit code 0; report contains "WARN duplicate" |
| Invalid regex in custom signal exits with code 1 | Integration | Exit code 1; mentions "invalid regex pattern" |
| Missing env var for named provider exits code 0 with warning | Integration | Exit code 0; "WARN: env var X not set" in report |
| `--verbose` flag prints full resolved routing table | Integration | Report includes all capability → agent mappings |
| Validate command invokes zero LLM adapter calls | Integration | `mockAdapter.complete.mock.calls.length === 0` |

### 2.8 AC-8: Hybrid Skill Authoring

| Scenario | Test tier | Assertion |
|---|---|---|
| Markdown-only skill's synthesized handler sends interpolated prompt to LLM | Unit (skills) | `templateInterpolator("{{text}}", {text:"hello"}) === "hello"` |
| TypeScript handler skill calls `handler.ts` export, not LLM | Unit (skills) | Mock handler is called; mock adapter `complete()` is not called |
| `requiresHandler: true` with missing handler throws in both modes | Unit (skills) | `skillMode: "permissive"` still throws when `requiresHandler: true` and handler absent |
| `skillMode: "strict"` throws on malformed frontmatter | Unit (skills) | Loader throws with filename in message |
| `skillMode: "permissive"` logs warning and skips malformed file | Unit (skills) | Logger receives a `warn` call; registry does not contain the bad skill |

### 2.9 AC-9: Zod-Based Schema Validation

| Scenario | Test tier | Assertion |
|---|---|---|
| `MessageSchema` validates all four roles | Unit (core) | All of `["user","assistant","system","tool"]` parse without error |
| `ToolSchema` name regex rejects uppercase | Unit (core) | `ToolSchema.parse({name:"BadName",...})` throws |
| `AgentFrontmatterSchema` applies defaults correctly | Unit (agents) | Missing `allowedTools` defaults to `["*"]`; missing `maxTurns` defaults to 30 |
| `SkillFrontmatterSchema` rejects name without leading `/` | Unit (skills) | `SkillFrontmatterSchema.parse({name:"summarize",...})` throws |
| `CompletionOptionsSchema` default temperature is 1 | Unit (core) | `CompletionOptionsSchema.parse({model:"x",maxTokens:100}).temperature === 1` |
| Zod error messages include field path | Unit (core) | `ZodError.issues[0].path` contains the offending field name |

### 2.10 AC-10: Compatibility Alias Layer

| Scenario | Test tier | Assertion |
|---|---|---|
| `/wicked-engineering:review` maps to `"code-review"` | Unit (cli) | `resolveAlias("/wicked-engineering:review") === "code-review"` |
| `/wicked-qe:qe-plan` maps to `"test-strategy"` | Unit (cli) | Alias table lookup returns correct capability |
| Unknown `/wicked-*:cmd` returns `undefined` | Unit (cli) | `resolveAlias("/wicked-unknown:cmd") === undefined` |
| `compat_mode: false` does not resolve aliases | Integration | Input starting with `/wicked-` is treated as natural language, not alias |
| `compat_mode: true` narration includes "Alias: ... →" prefix | Integration | Output string contains "Alias:" before capability name |
| Deprecation notice fires on first alias use, not on second | Integration | Logger `warn` call count for deprecation notice is 1 after 2 alias uses |
| All 21 default aliases resolve to valid capability tags | Unit (cli) | `CapabilityTagSchema.parse(resolveAlias(aliasKey))` does not throw for any key |

---

## 3. Test Infrastructure

### 3.1 MockLLMAdapter

The `MockLLMAdapter` is the single most important test infrastructure component. It implements
`LLMAdapter` and allows tests to script predetermined response sequences without network calls.

Location: `tests/helpers/mock-llm-adapter.ts`

```typescript
import type { LLMAdapter, CompletionOptions, CompletionSignal, Message } from "@the-agent/core";

export type MockResponse =
  | { type: "text"; content: string; stopReason?: "end_turn" | "max_tokens" }
  | { type: "tool_use"; calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { type: "error"; code: string; message: string; retryable: boolean };

export class MockLLMAdapter implements LLMAdapter {
  readonly providerId = "mock";
  readonly supportedModels = ["mock-model"] as const;

  private _responses: MockResponse[];
  private _callIndex = 0;
  readonly calls: Array<{ messages: Message[]; options: CompletionOptions }> = [];

  constructor(responses: MockResponse[]) {
    this._responses = responses;
  }

  async complete(messages: Message[], options: CompletionOptions): Promise<CompletionSignal> {
    this.calls.push({ messages, options });
    const response = this._responses[this._callIndex++];
    if (!response) throw new Error(`MockLLMAdapter: no response scripted for call ${this._callIndex}`);
    return response as CompletionSignal;
  }

  async stream(
    messages: Message[],
    options: CompletionOptions,
    onDelta: (delta: string) => void
  ): Promise<CompletionSignal> {
    const result = await this.complete(messages, options);
    if (result.type === "text") onDelta(result.content);
    return result;
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 1 };
  }

  /** Assert that complete() was called exactly N times */
  assertCallCount(n: number): void {
    if (this.calls.length !== n) {
      throw new Error(`Expected ${n} adapter calls, got ${this.calls.length}`);
    }
  }

  /** Assert last call's messages include a message with the given content substring */
  assertLastMessageContains(substring: string): void {
    const lastCall = this.calls.at(-1);
    if (!lastCall) throw new Error("No adapter calls made");
    const found = lastCall.messages.some((m) => m.content.includes(substring));
    if (!found) throw new Error(`No message containing "${substring}" in last call`);
  }
}
```

Usage pattern in a test:

```typescript
const adapter = new MockLLMAdapter([
  { type: "tool_use", calls: [{ id: "call-1", name: "read_file", arguments: { path: "auth.ts" } }] },
  { type: "text", content: "Finding: missing rate limiting. Summary: 1 finding." },
]);

const loop = new RuntimeLoop({ adapter, agent: coderConfig, skillRegistry });
const result = await loop.turn("review auth.ts");
adapter.assertCallCount(2);
expect(result.type).toBe("text");
```

### 3.2 ScriptedResponse Builder

For E2E tests that require complex multi-turn sequences, a builder simplifies construction:

Location: `tests/helpers/scripted-response.ts`

```typescript
export class ScriptedResponseBuilder {
  private _responses: MockResponse[] = [];

  text(content: string, stopReason: "end_turn" | "max_tokens" = "end_turn") {
    this._responses.push({ type: "text", content, stopReason });
    return this;
  }

  toolUse(calls: MockResponse["calls"]) {
    this._responses.push({ type: "tool_use", calls });
    return this;
  }

  error(code: string, message: string, retryable = true) {
    this._responses.push({ type: "error", code, message, retryable });
    return this;
  }

  build(): MockResponse[] {
    return this._responses;
  }
}

// Usage
const responses = new ScriptedResponseBuilder()
  .toolUse([{ id: "c1", name: "read_file", arguments: { path: "auth.ts" } }])
  .text("Finding: missing rate limiting.\n\nSummary: 1 critical finding.")
  .build();
```

### 3.3 Headless CLI Runner

The headless runner allows E2E tests to invoke the full CLI pipeline programmatically.

Location: `tests/helpers/headless-cli.ts`

```typescript
export interface HeadlessSession {
  send(input: string): Promise<HeadlessResult>;
  close(): void;
}

export interface HeadlessResult {
  output: string;          // full text output from CLI
  completionResult?: CompletionResult;
  routingResult?: RoutingResult;
  exitCode?: number;
}

export async function createHeadlessSession(
  config: FrameworkConfig,
  adapter: LLMAdapter
): Promise<HeadlessSession> {
  // Bypasses readline; calls the same internal dispatch path
  const cli = createCLI({ ...config, _adapterOverride: adapter });
  await cli.init();  // loads skills, agents, signals
  return {
    send: (input) => cli.processInput(input),
    close: () => cli.shutdown(),
  };
}
```

### 3.4 Fixture Directory Structure

```
tests/
├── helpers/
│   ├── mock-llm-adapter.ts
│   ├── scripted-response.ts
│   └── headless-cli.ts
│
├── fixtures/
│   ├── intent-corpus.json           # 50-entry labeled intent corpus (AC-2)
│   ├── capability-parity-checklist.json  # 97 wicked-garden command mappings (AC-6)
│   │
│   ├── skills/
│   │   ├── summarize.md             # valid markdown-only skill
│   │   ├── commit/
│   │   │   ├── index.md
│   │   │   └── handler.ts
│   │   ├── bad-name.md              # name: "missing-slash"
│   │   ├── missing-handler.md      # requiresHandler: true, no .ts file
│   │   └── malformed.md            # YAML syntax error
│   │
│   ├── agents/
│   │   ├── default.md
│   │   ├── coder.md
│   │   ├── coder.hooks.ts
│   │   ├── bad-id.md               # id: "Bad-ID"
│   │   └── duplicate-coder.md      # id: "coder" (duplicate)
│   │
│   ├── dot-agent/                  # simulates .agent/ directory
│   │   ├── config.yaml             # capability + provider overrides
│   │   ├── agents/
│   │   │   └── custom-reviewer.md
│   │   ├── skills/
│   │   │   └── internal-scan.md
│   │   └── signals/
│   │       └── fintech.yaml
│   │
│   └── e2e-sources/                # source files for reference task scenarios
│       ├── auth-login.ts           # single file review (task 1)
│       ├── multi-review/           # three files (task 2)
│       │   ├── controller.ts
│       │   ├── service.ts
│       │   └── repository.ts
│       ├── payment-service/        # test strategy target (task 3)
│       │   ├── payment.ts
│       │   └── payment.test.ts
│       ├── bug-report.txt          # error log (task 4)
│       ├── system-diagram/         # architecture analysis (task 5)
│       │   └── components.md
│       ├── vulnerable-code/        # security scan targets (task 6)
│       │   └── auth-handler.ts
│       ├── user-stories.md         # requirements elicitation (task 7)
│       └── legacy-service.ts       # refactoring target (task 9)
```

### 3.5 Intent Corpus Format

The intent corpus file `tests/fixtures/intent-corpus.json` follows this schema:

```typescript
interface IntentCorpusEntry {
  id: string;                  // "eng-01" through "prod-07"
  input: string;               // natural language developer request
  expectedCapability: string;  // one of CapabilityTag values
  category: "engineering" | "quality" | "orchestration" | "platform" | "product";
  tier1Eligible: boolean;      // true if we expect Tier 1 to resolve this (confidence >= 0.75)
  notes?: string;              // explains edge cases or ambiguous inputs
}
```

Example entries (illustrative; full corpus has 50):

```json
[
  { "id": "eng-01", "input": "review the auth module for security issues", "expectedCapability": "code-review", "category": "engineering", "tier1Eligible": true },
  { "id": "eng-02", "input": "debug why my API calls are timing out", "expectedCapability": "debug", "category": "engineering", "tier1Eligible": true },
  { "id": "eng-03", "input": "refactor the payment service to use the repository pattern", "expectedCapability": "refactor", "category": "engineering", "tier1Eligible": true },
  { "id": "eng-04", "input": "help me design the database schema for a multi-tenant SaaS", "expectedCapability": "architecture-analysis", "category": "engineering", "tier1Eligible": false, "notes": "design + schema is ambiguous — Tier 2 expected" },
  { "id": "eng-05", "input": "implement a rate limiter for the auth endpoints", "expectedCapability": "implementation", "category": "engineering", "tier1Eligible": true },
  { "id": "qe-01", "input": "generate a test strategy for the checkout service", "expectedCapability": "test-strategy", "category": "quality", "tier1Eligible": true },
  { "id": "qe-02", "input": "write BDD scenarios for the login flow", "expectedCapability": "test-scenarios", "category": "quality", "tier1Eligible": true },
  { "id": "orch-01", "input": "start a new feature branch for user notifications", "expectedCapability": "orchestrate", "category": "orchestration", "tier1Eligible": true },
  { "id": "orch-02", "input": "what is the current status of the auth epic?", "expectedCapability": "progress-report", "category": "orchestration", "tier1Eligible": true },
  { "id": "plat-01", "input": "scan the codebase for SQL injection vulnerabilities", "expectedCapability": "security-scan", "category": "platform", "tier1Eligible": true },
  { "id": "prod-01", "input": "help me write acceptance criteria for the profile settings feature", "expectedCapability": "acceptance-criteria", "category": "product", "tier1Eligible": true }
]
```

---

## 4. Coverage Targets

Coverage is measured by Vitest's built-in V8 coverage provider (`--coverage.provider=v8`).
Coverage reports are generated per package and aggregated at the monorepo level.

| Package | Line coverage target | Rationale |
|---|---|---|
| `@the-agent/core` | 90% | Owns the runtime state machine and all interface contracts. Bugs here break everything. |
| `@the-agent/skills` | 80% | Loading pipeline has 5 stages; each stage is independently testable. |
| `@the-agent/agents` | 80% | Mirrors skills pipeline; same justification. |
| `@the-agent/providers` | 70% | Adapters are thin wrappers. Vendor SDK internals are not our code to cover. |
| `@the-agent/cli` | 60% | REPL and readline interaction require TTY simulation; covered at E2E tier instead. |
| **Monorepo overall** | 78% blended | Weighted average; rounded down from computed target. |

### What is Excluded from Coverage

- `packages/*/src/index.ts` barrel files (re-exports only, no logic)
- `*.d.ts` declaration files
- `tests/helpers/` test infrastructure code
- `examples/` directory
- Node.js `bin/` shebang wrapper

### Coverage Configuration

`vitest.config.ts` at monorepo root:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/index.ts",
        "**/*.d.ts",
        "tests/helpers/**",
        "examples/**",
      ],
      thresholds: {
        lines: 78,        // overall gate — blocks merge
        perFile: false,   // per-file threshold enforced by package-specific configs
      },
    },
  },
});
```

Per-package thresholds are enforced by each package's `vitest.config.ts`:

```typescript
// packages/core/vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      thresholds: { lines: 90 },
    },
  },
});
```

---

## 5. CI Integration

### 5.1 GitHub Actions Workflow

Location: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build

  unit-tests:
    name: Unit Tests
    needs: build
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: [core, providers, skills, agents, cli]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: npx vitest run --coverage --project packages/${{ matrix.package }}
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.package }}
          path: packages/${{ matrix.package }}/coverage/

  integration-tests:
    name: Integration Tests
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: npx vitest run tests/integration/

  e2e-tests:
    name: E2E Reference Task Suite
    needs: [unit-tests, integration-tests]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: npx vitest run tests/e2e/
        env:
          # No real API keys — MockLLMAdapter is used exclusively in E2E tests
          THE_AGENT_TEST_MODE: "true"

  routing-accuracy:
    name: Intent Routing Accuracy (>= 80%)
    needs: integration-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: npx vitest run tests/integration/routing-accuracy.test.ts

  capability-parity:
    name: Stage 1 Capability Parity Check
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - run: node scripts/check-capability-parity.js

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run lint

  type-check:
    name: TypeScript Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx tsc --build --dry
```

### 5.2 Merge Gates

The following checks must pass before a pull request can merge to `main`. All are required status
checks enforced by branch protection rules.

| Check | What it verifies | Blocks merge on failure |
|---|---|---|
| `Build` | TypeScript compiles without errors | Yes |
| `Unit Tests / core` | Core package >= 90% line coverage | Yes |
| `Unit Tests / skills` | Skills package >= 80% line coverage | Yes |
| `Unit Tests / agents` | Agents package >= 80% line coverage | Yes |
| `Unit Tests / providers` | Providers package >= 70% line coverage | Yes |
| `Unit Tests / cli` | CLI package >= 60% line coverage | Yes |
| `Integration Tests` | All 8 integration boundary scenarios pass | Yes |
| `E2E Reference Task Suite` | All 10 AC-3 tasks reach `done === true` | Yes |
| `Intent Routing Accuracy` | >= 80% accuracy on 50-intent corpus | Yes |
| `Capability Parity Check` | All Stage 1 capabilities registered at startup | Yes |
| `Lint` | No ESLint errors | Yes |
| `TypeScript Type Check` | No type errors in strict mode | Yes |

Warnings (non-blocking, visible in PR comment):
- Coverage regressions of < 5% on any package (drops below target but not dramatically)
- New skills/agents added without corresponding fixture in `tests/fixtures/`

### 5.3 No Real API Keys in CI

CI runs zero LLM calls. This is enforced by:

1. The `MockLLMAdapter` is used exclusively in all automated tests.
2. The environment variable `THE_AGENT_TEST_MODE=true` causes `createCLI()` to reject any
   configuration that does not provide a `_adapterOverride`. This prevents accidental real
   calls if a test forgets to inject the mock.
3. No `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` secrets are configured in
   the CI environment for the test runner jobs. They exist only in a separate `smoke-test`
   workflow that runs nightly against a dedicated test account with spend limits.

### 5.4 Nightly Smoke Test (Not a Merge Gate)

A separate nightly workflow runs a subset of E2E tests using real API keys against each
supported provider. This catches provider API breaking changes that MockLLMAdapter cannot
detect. It does not block merge; failures trigger a Slack alert to the maintainers.

```
.github/workflows/nightly-smoke.yml
  - Runs tasks 1, 3, and 8 from the AC-3 suite against real Anthropic + OpenAI
  - Each task has a spend cap of $0.10 via token limits in CompletionOptions
  - Results are uploaded as GitHub Actions artifacts for inspection
```

---

## 6. Test Authoring Conventions

### File Naming

- Unit tests: `packages/<pkg>/tests/<module-name>.test.ts`
- Integration tests: `tests/integration/<scenario-name>.test.ts`
- E2E tests: `tests/e2e/ac3-task-<nn>-<slug>.test.ts`
- Helpers: `tests/helpers/<helper-name>.ts`

### Import Style

All tests import from the package's public barrel (`@the-agent/core`, etc.), not from internal
file paths. This enforces that the public API surface is sufficient and prevents tests from
becoming tightly coupled to internal structure.

```typescript
// Correct
import { RuntimeState, MessageSchema } from "@the-agent/core";

// Incorrect — do not import from internal paths
import { RuntimeState } from "../../packages/core/src/runtime/runtime-state.js";
```

Exception: test fixtures and helper modules may import from internal paths when testing a
specific internal module in isolation (e.g., `frontmatter-parser.test.ts` imports the parser
directly because it is not exported from the barrel).

### Test Isolation

- Each test file must be independently runnable (`vitest run <file>`).
- No shared mutable state between test files. Use `beforeEach` to reset state.
- Temporary files written during tests go to `os.tmpdir()` paths, not the fixture directory.
- `afterEach` or `afterAll` must clean up any files written to disk.

### Assertion Style

Prefer specific assertions over generic `toBeTruthy()`:

```typescript
// Preferred
expect(result.capability).toBe("code-review");
expect(registry.get("/summarize")).toBeDefined();

// Avoid
expect(result).toBeTruthy();
```

For Zod validation tests:

```typescript
// Testing that a valid object parses
const parsed = MessageSchema.safeParse(validMessage);
expect(parsed.success).toBe(true);

// Testing that an invalid object fails with a meaningful error
const failed = MessageSchema.safeParse(invalidMessage);
expect(failed.success).toBe(false);
expect(failed.error?.issues[0].path).toContain("id");
```

---

## 7. Open Questions for QE

The following items require decisions before implementation begins.

1. **`createCLI().processInput()` headless API**: The architecture document does not define a
   headless mode. The CLI currently uses `readline` which requires a TTY. The headless runner
   described in section 3.3 requires either (a) a dedicated `processInput(string)` method added
   to the CLI public API, or (b) mocking `readline` at the module level. Recommendation: add the
   headless API to `createCLI()`'s return type as part of the CLI implementation.

2. **Completion contract assertion functions**: The `assertionFn` field on `CompletionCondition`
   is a runtime function. For the reference task suite, these functions need concrete
   implementations. The strategy documents the expected behaviour (e.g., "checks response
   contains 'root cause'") but the actual functions must be authored during implementation.

3. **Capability parity checklist source**: The 97 wicked-garden commands referenced in AC-6
   need to be enumerated in `tests/fixtures/capability-parity-checklist.json`. This requires
   reading the wicked-garden plugin source or documentation. A spike is needed to produce this
   file before the parity check CI step can be built.

4. **`js-tiktoken` in test environment**: The architecture notes `js-tiktoken` (WebAssembly)
   for token counting. WebAssembly initialisation adds latency to the first test that exercises
   the context assembler. If this becomes a problem, the context assembler should accept a
   `tokenCounter` dependency injection point so tests can substitute a simple character-count
   stub.

5. **SQLite memory backend in CI**: The `sqlite-memory.ts` backend requires a native module
   (e.g., `better-sqlite3`). CI runners on Ubuntu should support this, but the native build
   step must be verified. If it causes issues, the sqlite tests can be tagged `@slow` and
   skipped on the fast CI path, running only nightly.
