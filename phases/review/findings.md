# Review Findings

**Project:** the-agent
**Review Type:** EXECUTION Gate (multi-perspective)
**Date:** 2026-02-25
**Tests:** 85/85 passing
**Files reviewed:** 30 source files across 5 packages

---

## Summary

**Overall Assessment: CONDITIONAL**

The scaffold is architecturally sound. Package boundary discipline is clean, interface contracts match the
architecture document faithfully, and the test suite passes fully. The framework is at a genuine "functional
scaffold" state — the wiring is correct but three runtime paths are broken or stubbed in ways that make the
product non-functional for any real consumer. The conditional is specifically tied to those three critical
issues plus two should-fix concerns.

---

## Changes Reviewed

| File | Assessment |
|---|---|
| `packages/core/src/interfaces/llm-adapter.ts` | PASS — exact match to architecture spec, discriminated union clean |
| `packages/core/src/interfaces/completion.ts` | PASS — matches spec, ProgressEvent included |
| `packages/core/src/interfaces/intent.ts` | PASS — all Stage 1/2/3 capability tags present, both schemas clean |
| `packages/core/src/interfaces/message.ts` | PASS — UUID constraint, positive timestamp, optional toolCallId |
| `packages/core/src/interfaces/tool.ts` | PASS — name regex, description min(1), source enum, handler typed correctly |
| `packages/core/src/interfaces/agent-config.ts` | PASS — all fields from architecture spec present |
| `packages/core/src/interfaces/skill-config.ts` | PASS — frontmatter regex (must start with /), requiresHandler flag present |
| `packages/core/src/runtime/runtime-state.ts` | PASS — immutable snapshot pattern correct; `evaluating_completion` phase present in code but absent from architecture doc's phase list (minor doc gap) |
| `packages/core/src/runtime/runtime-loop.ts` | CONCERN — loop state machine correct but `satisfyCondition()` is a stub |
| `packages/core/src/runtime/context-assembler.ts` | CONCERN — uses 4-chars/token approximation; architecture spec requires `js-tiktoken` |
| `packages/core/src/dispatch/tool-dispatcher.ts` | PASS — parallel dispatch, allowedTools enforcement, timeout via Promise.race, errors captured not propagated |
| `packages/core/src/intent/router.ts` | PASS — two-tier design complete with built-in signals, caching, fallback, custom signal precedence |
| `packages/core/src/intent/capability-map.ts` | PASS — all capability tags mapped, matches architecture table |
| `packages/providers/src/anthropic/anthropic-adapter.ts` | PASS — LLMAdapter contract implemented, error normalization retryable on 429/5xx |
| `packages/providers/src/factory.ts` | PASS — exhaustiveness check, all four adapters wired |
| `packages/skills/src/loader/skill-loader.ts` | PASS — 5-stage pipeline faithfully implemented, mode handling correct |
| `packages/skills/src/registry/skill-registry.ts` | PASS — strict/permissive conflict handling, sorted list |
| `packages/agents/src/loader/agent-loader.ts` | PASS — 5-stage pipeline, deterministic sort before registration |
| `packages/agents/src/registry/agent-registry.ts` | PASS — always throws on duplicate id as specified |
| `packages/cli/src/define-framework.ts` | PASS — fail-fast parse, all sub-schemas extracted as exported types |
| `packages/cli/src/loader/framework-loader.ts` | PASS — parallel load, correct adapter factory delegation |
| `packages/cli/src/commands/validate.ts` | CONCERN — 5 of 7 specified checks implemented; signal validation and capability coverage missing; config resolution resolves only .ts path |
| `packages/cli/src/repl/repl.ts` | CRITICAL — RuntimeLoop created per-turn; session history lost between messages |
| `packages/cli/src/dispatch/slash-command-dispatcher.ts` | PASS — robust tokenizer, flag/value coercion, helpful partial-match suggestion |
| `packages/cli/src/compat/aliases.ts` | PASS — alias map complete, one-time deprecation notice, resetDeprecationNotice() for tests |
| `packages/cli/src/config/team-config.ts` | PASS — strict schema, YAML wrapping approach works |
| `packages/cli/src/bin.ts` | PASS — tries .ts, .js, .mjs in order; help and version flags |

---

## Issues Found

### Critical (Must Fix)

**C1: REPL creates a new RuntimeLoop per user input line — conversation history is discarded after each turn**

Location: `packages/cli/src/repl/repl.ts`, lines 212–226

The `rl.on("line", async (line) => { ... })` handler constructs `new RuntimeLoop(sessionId, { ... })` on
every user message. `RuntimeLoop` owns a `RuntimeState` internally, and `RuntimeState` holds the message
history. Each new `RuntimeLoop` starts with an empty history. A user who sends "explain this function" then
"now refactor it" receives an LLM that has no memory of the first message. The `sessionId` is computed
outside the handler (line 101), which suggests the loop was intended to persist per session.

Recommendation: Lift `RuntimeLoop` instantiation out of the line handler. Scope one loop per agent
selection — construct a new one when the user runs `/use <agentId>` or at REPL start for the default
agent. Replace the per-call loop construction with a `loop.run(resolvedInput)` call on the persistent
instance.

---

**C2: `satisfyCondition()` in RuntimeLoop is a no-op stub — artifact-check completion conditions can never be satisfied**

Location: `packages/core/src/runtime/runtime-loop.ts`, lines 273–278

```typescript
satisfyCondition(conditionId: string, artifactPath?: string): void {
  if (artifactPath) {
    // artifacts array is captured per-run; this is a best-effort helper
  }
  // This is surfaced to callers who hold a reference to the loop instance
}
```

The method body is entirely comments. The `satisfiedConditionIds` set and `artifacts` array that the method
should mutate are local variables inside `run()`, not instance fields, so the method cannot reach them
regardless of caller intent. Any `CompletionContract` with `check: "artifact"` conditions — including the
architecture's default `test-strategy` contract (`**/test-strategy.md`) — will wait until `maxTurns` is
exceeded and return `done: false`.

Recommendation: Promote `satisfiedConditionIds` and `artifacts` to private instance fields initialised when
`run()` starts, so `satisfyCondition()` can mutate them. Alternatively, remove `check: "artifact"` from
default contracts and document it as a future capability. AC-3 (Stay Until Complete) pass rate on the
reference task suite depends on this fix for tasks 3, 5, 6, 7, and 9.

---

**C3: `agent validate` only resolves `agent.config.ts` — fails silently in compiled projects with `.js` configs**

Location: `packages/cli/src/commands/validate.ts`, line 61

```typescript
const configPath = resolve(options.projectRoot, "agent.config.ts");
```

The `bin.ts` entry point correctly tries `agent.config.ts`, `agent.config.js`, and `agent.config.mjs` in
order. The validate command hardcodes only the `.ts` path. In a compiled TypeScript project — the normal
case for production — the user will have `agent.config.js`, and `agent validate` will report
"agent.config.ts not found — framework config is required" as a warning and skip all config-dependent
checks (skills, agents, provider env vars). The exit code will be 0, masking real misconfiguration as a
false pass.

Recommendation: Extract the three-candidate resolution logic from `bin.ts` into a shared
`resolveConfigPath(projectRoot)` utility and use it in both `bin.ts` and `runValidate()`.

---

### Concerns (Should Fix)

**S1: Token estimation uses 4-chars/token approximation for all models — architecture specifies `js-tiktoken` for Anthropic/OpenAI**

Location: `packages/core/src/runtime/context-assembler.ts`, lines 6–8

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

The architecture document explicitly resolves this: "Use `tiktoken` (via the `js-tiktoken` WebAssembly
build) for Anthropic/OpenAI models. Fall back to 4-chars-per-token approximation for unknown models." The
heuristic is off by 20–40% for code-heavy content. This causes either premature truncation of valid
conversation history or sending contexts that exceed the model's actual token limit, resulting in
`max_tokens` stop reasons or provider-side errors misclassified as retryable.

Recommendation: Add `js-tiktoken` as an optional dependency of `@the-agent/core`. In `ContextAssembler`,
accept the model name as a parameter and use tiktoken for known Anthropic/OpenAI model name prefixes,
falling back to the heuristic for Ollama or unknown models. The model string is already available at the
call site.

---

**S2: REPL async line handler has no concurrency guard — rapid typing causes concurrent LLM calls**

Location: `packages/cli/src/repl/repl.ts`, line 109

`readline` does not await async event listeners. If a user presses Enter while the previous LLM call is
in-flight, a second loop starts concurrently. Both write to stdout interleaved. After C1 is fixed and
`RuntimeLoop` persists across turns, concurrent calls to `loop.run()` will also produce race conditions on
the internal `RuntimeState`.

Recommendation: Add a `private _processing = false` flag on `REPL`. Set it `true` before awaiting
`loop.run()` and back to `false` in a `finally` block. While `_processing` is `true`, print
"Processing... please wait" and discard the line.

---

### Suggestions (Nice to Have)

**Note 1:** `AnthropicAdapter.stream()` accumulates `input_json_delta` events with a comment but no actual
accumulation variable. Tool calls from streaming responses will have empty `arguments` objects. The
non-streaming `complete()` path handles this correctly via `finalMessage()`. Document `stream: false` as
the only supported mode for tool use until the streaming JSON accumulator is implemented.

Location: `packages/providers/src/anthropic/anthropic-adapter.ts`, lines 87–91

**Note 2:** `ToolDispatcher` has a hardcoded `DEFAULT_TOOL_TIMEOUT_MS = 30_000` constant. The architecture
specifies per-tool `timeout_ms` configurability via frontmatter and `.agent/config.yaml`. The `Tool`
schema has no `timeoutMs` field and the dispatcher's `dispatch()` signature does not accept per-tool
timeouts. This is a schema-level gap that requires adding `timeoutMs` to `ToolSchema` to be complete.

Location: `packages/core/src/dispatch/tool-dispatcher.ts`, line 3

**Note 3:** The `RuntimePhase` union type in the architecture document's State Management section omits
`"evaluating_completion"`. The implementation in `runtime-state.ts` line 22 correctly includes it and the
runtime loop transitions through it. Update the architecture doc to add this phase between
`awaiting_completion` and `idle` in both the type definition and the state machine diagram.

**Note 4:** `TwoTierIntentRouter.llmCache` is an unbounded `Map` with lazy eviction that only runs on
cache write. A long-running session with many unique low-confidence inputs will grow unboundedly. Add a
max-entry cap (e.g., 500 entries, evict LRU on overflow) until the shared `CacheLayer` described in the
architecture is implemented.

Location: `packages/core/src/intent/router.ts`, line 204

**Note 5:** The validate command check for "capability to agent mappings resolve to a registered agent"
(architecture check 2) is not fully implemented. The code checks that `defaultAgent` resolves but does not
iterate `DEFAULT_CAPABILITY_MAP` to verify that each mapped agent ID exists in the loaded registry. A team
that overrides a capability to point at a non-existent agent will receive exit code 0 from validate.

Location: `packages/cli/src/commands/validate.ts`, lines 196–229

---

## AC Coverage Assessment

| AC | Status | Evidence |
|---|---|---|
| AC-1: Single Install, Working Agent | Partially Implemented | Startup pipeline complete. Will not work without built-in content (AC-6). |
| AC-2: Intent-Driven Routing | Implemented | TwoTierIntentRouter complete: 25 built-in signals, LLM fallback, caching, narration, custom signal precedence. |
| AC-3: Stay Until Complete | Partially Implemented | Loop structure and contract evaluation present. Artifact conditions broken (C2). History loss (C1) prevents multi-turn continuity. |
| AC-4: Team Customization via .agent/ | Implemented | TeamConfigSchema, loadTeamConfig(), .agent/ scanning in validate, compat_mode flag all present and wired. |
| AC-5: Multi-Provider Support | Implemented | All four adapters present. Factory uses exhaustive switch. Per-capability provider routing is parsed but not yet plumbed to the router. |
| AC-6: Built-in Capabilities Stage 1 | Not Yet Implemented | Zero built-in agent or skill markdown files exist in the packages. Loader is ready but there is no content. Fresh install produces empty registries. |
| AC-7: Validation Subcommand | Partially Implemented | 5 of 7 checks present. Signal validation, capability coverage gap, and config resolution bug noted. |
| AC-8: Hybrid Skill Authoring | Implemented | Handler-based and markdown-only prompt interpolation both work. Mode enforcement correct. |
| AC-9: Zod-Based Schema Validation | Implemented | All interfaces have Zod schemas. Types derived via z.infer<>. Runtime validation at package boundaries. |
| AC-10: Compatibility Alias Layer | Implemented | DEFAULT_ALIASES covers all wicked-garden commands. resolveAlias() and emitDeprecationNotice() wired in REPL. compat_mode flag controls activation. |

---

## Test Coverage

**85 tests, all passing.**

| Suite | Tests | Assessment |
|---|---|---|
| `core/tests/interfaces.test.ts` | 30 | Thorough schema boundary testing across 6 schemas |
| `core/tests/runtime-state.test.ts` | 13 | Comprehensive, including stale-snapshot and unknown-callId edge cases |
| `core/tests/tool-dispatcher.test.ts` | 10 | Parallel dispatch, allowedTools, timeout, error capture, order preservation |
| `core/tests/intent-router.test.ts` | 12 | Tier 1 routing, custom signal precedence, cache isolation, Tier 2 fallback |
| `skills/tests/template-interpolator.test.ts` | 20 | Defaults, null handling, multi-line, malformed placeholders |

**Coverage gaps:**
- `RuntimeLoop.run()` — the most complex function in the codebase — has zero tests. The `satisfyCondition()` stub escaped because no test exercises a contract with artifact conditions.
- `ContextAssembler` — token-budget truncation logic is untested.
- `SkillLoader` and `AgentLoader` pipelines have no end-to-end tests.
- `validate` command has no tests.
- `SlashCommandDispatcher` has no tests despite having bespoke tokenizer and type-coercion logic.
- No integration test exercises the full `FrameworkLoader -> REPL -> RuntimeLoop -> MockAdapter` chain.

---

## Recommendation

**CONDITIONAL**

The architecture is well-conceived and the translation from design to code is faithful. Package boundaries
are clean, the dependency graph matches the design exactly, TypeScript strict mode is enforced, and the
Zod-first contract is consistent throughout. The two-tier intent routing system is particularly
well-implemented and ready for the 80% accuracy target.

The conditional is warranted because C1 (REPL loses conversation history between turns), C2 (artifact
completion conditions are stubs), and the absence of built-in content (AC-6) together mean that a developer
who installs the tool today will encounter an inert REPL with no agents, and if they add their own agent,
every message will receive a context-free LLM response. These failures are immediately visible on the second
message.

Resolving C1, C2, C3, shipping AC-6 built-in agent and skill content, and adding the S2 concurrency guard
would support an APPROVE.
