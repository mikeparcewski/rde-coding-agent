# Strategy Gate Assessment: rde-coding-agent Design Phase

**Date**: 2026-02-25
**Phase**: design → implementation
**Evaluator**: value-orchestrator
**Architecture document**: phases/design/rde-coding-agent-architecture.md (1,801 lines)

---

## Decision: APPROVE

The design is complete, coherent, and implementable. Both value gate conditions from the clarify
phase are fully resolved. All 10 acceptance criteria are addressed. The architecture builds
directly on top of pi-mono without reinventing any layer pi-mono already provides.

Proceed to implementation.

---

## Evaluation Summary

| Question | Finding | Detail |
|---|---|---|
| All 10 AC addressed? | YES — all 10 | See AC mapping below |
| VG Condition 1 resolved? (multi-persona sub-calls) | YES — fully specified | Section 5, `streamSimple` + `Promise.allSettled` + timeout race |
| VG Condition 2 resolved? (persistent store schema) | YES — fully specified | Section 6, JSONL + JSON stores with schema version and migration |
| Package structure implementable? | YES | Clean file tree, one file per concern, no circular dependencies |
| Design gaps that block implementation? | NONE blocking | Two minor gaps noted; neither blocks Stage 1 |
| Builds on pi-mono, not reinventing? | YES — strongly | Runtime, sessions, tool dispatch, type validation all delegated to pi-mono |

---

## 1. Acceptance Criteria Coverage

### AC-1: Install and Run

Architecture specifies: `rdeCodingAgent(config)` returns a `PiExtension` object with a `register(pi)`
method. Extension drops into `.pi/extensions/wicked.ts`. The factory pattern matches pi-mono's
documented extension loading (via jiti, no pre-compilation needed).

**Verdict**: Addressed. Section 3 (Extension Factory) is the complete answer to this AC.

### AC-2: Domain Tools Register as pi-mono Tools

All 8 required domains are present in Section 7 (Capability Domain Map). Each domain has:
- At minimum the tools named in the AC: `security_review` -> `security_scan`, `code_review`,
  `test_strategy`, `generate_scenarios`, `elicit_requirements`, `ux_review`, `analyze_dataset`,
  `pipeline_review`, `code_search`, `symbol_refs`, `experiment_design`, `risk_assess`,
  `agent_review`, `safety_audit`.
- Full TypeBox schemas shown for engineering, search, brainstorm, memory, project, kanban domains.
- Tool registration via `pi.registerTool()` confirmed in every domain's index.ts.

**Verdict**: Addressed. All domains present, tool schemas demonstrated with concrete code.

### AC-3: Slash Commands Work

All required commands present in domain map (Section 7):
- `/review` — engineering/commands.ts
- `/debug` — engineering/commands.ts
- `/test-strategy` — qe/commands.ts
- `/security` — platform/commands.ts
- `/brainstorm` — brainstorm/commands.ts
- `/search` — search/commands.ts
- `/remember` — memory/commands.ts
- `/recall` — memory/commands.ts

Command registration pattern shown in Section 4 with concrete `parseReviewArgs` example.

**Verdict**: Addressed.

### AC-4: Memory Persists Across Sessions

Section 6 defines the full `MemoryStore` implementation:
- Appends to `~/.pi/agent/wicked/memory/memories.jsonl`
- `session_start` hook pre-fetches relevant memories
- `context` hook injects them before each LLM call (Section 8, expanded version)
- `session_shutdown` clears in-memory session state

**Verdict**: Addressed. Implementation is complete, not sketched.

### AC-5: Multi-Persona Brainstorming Works (Value Gate Condition 1)

Section 5 is a complete implementation:
- `brainstormExecute` fires `Promise.allSettled` over all persona calls in parallel
- Each call uses `pi.ai.streamSimple()` from `@mariozechner/pi-ai` — no deadlock risk because
  these are independent stateless calls, not re-entrant calls into the same session loop
- `callPersonaWithTimeout` wraps each call in a `Promise.race` against a 45-second timeout
- One persona failure does not cancel others (`Promise.allSettled` semantics)
- Synthesis is a final `streamSimple` call over all collected outputs
- Built-in personas: architect, skeptic, user-advocate, pragmatist, innovator — all with
  substantive system prompts in `personas.ts`

The clarify gate condition asked for: the sub-call mechanism, which `pi-ai` API is used, and how
errors/timeouts in one persona are isolated. All three are answered.

**Verdict**: Condition resolved. Implementation complete.

### AC-6: Cross-Session Project Tracking Works (Value Gate Condition 2)

Section 6 defines the full store schema:
- `ProjectRecord` with `schemaVersion: 1`, `id`, `phase`, `goals`, `sessionIds`, `advances[]`
- `JsonStore<T>` handles atomic writes via temp-file rename
- Schema migration strategy: per-record inline migration functions
- `project_start`, `project_status`, `project_advance` tools shown in Section 9
- Session hooks load/persist active project state (Section 8, project hooks sketch)

The clarify gate condition asked for: file format, schema version migration, concurrent write
safety. All three are answered (JSON files, embedded `schemaVersion`, atomic rename).

**Verdict**: Condition resolved. Schema complete.

### AC-7: Context Assembly Works

Section 8 provides the expanded context hook with five explicit decision points:
1. Skip turn 0 with no memories
2. Extract latest user message as query signal
3. Run dynamic recall on turns > 0
4. Merge prime + dynamic memories, deduplicate by id, cap at 20 entries
5. Inject as labelled system message

Project domain adds a second context hook injecting active project goals.

**Verdict**: Addressed. The intelligence layer is designed with specific logic, not hand-waved.

### AC-8: Security Gate Blocks Dangerous Operations

Section 7 (Platform domain hooks) shows the complete `tool_call` hook implementation:
- `GUARDED_TOOLS` set defines which tools require confirmation
- `ctx.ui.confirm()` called before guarded tool runs
- Throwing from the hook cancels execution
- Controlled by `platformGuardrails: true` in `RdeConfig`

**Verdict**: Addressed. Blocking gate mechanism shown with concrete code.

### AC-9: Selective Capability Loading

`extension.ts` in Section 3 shows:
- `ALL_DOMAINS` constant
- `capabilities === "all"` check selects all; otherwise uses the explicit list
- `DOMAIN_REGISTRARS` map dispatches only selected domains in a for-loop
- Non-selected domains have no registrar called — no tools, no commands, no hooks

**Verdict**: Addressed. Implementation is clean and correct.

### AC-10: TypeBox Schemas for All Tools

TypeBox schemas shown for: code_review, debug_analyze, architecture_review, generate_docs (Section 4),
brainstorm, quick_jam (Section 5), remember, recall, forget, project_start, project_status,
project_advance (Section 9), task_create, task_list, task_update (Section 9), code_search,
symbol_refs, blast_radius (Section 10).

No domain uses `Type.Any()` or `unknown` for top-level parameters. All schemas are `Type.Object()`
with typed fields.

**Verdict**: Addressed. TypeBox is used consistently and correctly throughout.

---

## 2. Value Gate Conditions — Resolution Status

| Condition | Status | Evidence |
|---|---|---|
| Multi-persona sub-calls: mechanism specified, API named, isolation guaranteed | RESOLVED | Section 5 — `pi.ai.streamSimple()`, `Promise.allSettled`, `Promise.race` timeout |
| Persistent store: file format, schema version, migration, concurrent write safety | RESOLVED | Section 6 — JSONL + JSON, `schemaVersion: 1`, inline migration functions, atomic rename |

Both conditions from the clarify value gate are fully resolved. Implementation may proceed.

---

## 3. Package Structure Implementability

The file tree in Section 2 is clean and internally consistent:

- One `index.ts` per domain — clean public/private boundary
- `tools.ts`, `commands.ts`, `hooks.ts`, `store.ts` per domain — single-responsibility
- Shared infrastructure in `store/base-store.ts`, `jsonl-store.ts`, `json-store.ts`
- Single public entry point: `src/index.ts` exports only `rdeCodingAgent` and two types

No circular dependencies exist in the proposed structure (domains import from `store/` and
`types.ts`, never from each other). The `extension.ts` factory imports domain registrars but
domain registrars do not import `extension.ts`.

TypeScript ESM module paths use `.js` extensions (correct for Node ESM with `tsconfig`
`"module": "NodeNext"`).

**Verdict**: Implementable as described. A developer can begin file creation from the tree and code
samples without needing to make any structural decisions.

---

## 4. Design Gaps Assessment

### Gap 1: QE, platform, product, data, delivery, agentic tool execute() bodies are stubs

The engineering domain shows a complete `execute()` pattern (reads file content, returns structured
object). The engineering tools themselves return placeholder shapes (`findings: []`, `hypothesis: ""`).
Domains qe, product, data, delivery, agentic are named in the capability map but do not have
tool body implementations shown in the document.

**Impact**: This is the expected state for a design document. Section 4 states explicitly:
"The execute function returns structured data. pi-mono serialises this and feeds it back to the LLM
as a tool result. Here we do any file-system work (reading files) and return content." The LLM in
the next turn does the analysis. The stub pattern is the correct pattern for LLM-backed tools.

**Blocking for Stage 1?**: No. The pattern is established. Implementation follows by repetition.

### Gap 2: `parseFormattedMemories()` referenced but not shown

In Section 8 (expanded context hook), `parseFormattedMemories(sessionState.primeMemories)` is
called but the function is not defined in the architecture document. This implies the MemoryStore
either returns raw `MemoryEntry[]` that needs to be re-parsed from the pre-formatted string, or
the design expects the primeMemories to be stored as a different format.

**Impact**: Minor design inconsistency. The stored `primeMemories` field in `SessionMemoryState`
is typed as `string` (pre-formatted), but the expanded context hook attempts to parse it back into
objects to deduplicate by `id`. This will require the implementation to either store raw entries
(not a formatted string) in `sessionState`, or implement `parseFormattedMemories` as a reversal
of `formatMemoriesForContext`.

**Blocking for Stage 1?**: No — Stage 1 does not include context assembly (AC-7 is Stage 2).
But the implementer must resolve this before Stage 2 begins. The simplest fix: change
`SessionMemoryState.primeMemories` from `string` to `MemoryEntry[]` and format at injection time.

### Gap 3: KanbanStore interface referenced but not defined

`kanban/store.ts` is referenced in the file tree and in `registerKanbanTools` (which calls
`store.createTask()`, `store.listTasks()`, `store.updateTask()`), but the `KanbanStore` class
and its `KanbanRecord` schema are not shown in the document.

**Impact**: Low. The kanban store follows the same `JsonStore<T>` pattern as the project store.
The schema can be inferred from the tool parameters. Implementation is straightforward.

**Blocking for Stage 1?**: No — kanban is not in Stage 1.

---

## 5. Pi-Mono Integration Assessment

The architecture is strongly and correctly additive:

| Layer | pi-mono owns | rde-coding-agent does |
|---|---|---|
| Agent loop | pi-mono | Nothing |
| Provider adapters | pi-mono | Nothing |
| Session management | pi-mono | Listens via hooks only |
| Tool dispatch | pi-mono | Registers tool definitions |
| Type validation | pi-mono (TypeBox) | Supplies TypeBox schemas |
| LLM AI client | pi-mono (`@mariozechner/pi-ai`) | Calls `pi.ai.streamSimple()` for sub-calls only |
| Context injection | pi-mono | Uses `injectSystemMessage()` hook — additive |
| Slash command routing | pi-mono | Registers handlers |

Key validation: The architecture document introduces no custom runtime, no additional event loop,
no in-process HTTP server, no background threads. The brainstorm domain's use of `pi.ai` is the
only place rde-coding-agent reaches into pi-mono's AI layer, and it does so through the documented
public API (`streamSimple`), not by monkey-patching or reaching into internals.

Design Decision D2 is notable: the architecture explicitly calls out that `the-agent` monorepo
uses Zod while `rde-coding-agent` uses TypeBox because pi-mono uses TypeBox natively. This is the
correct call and demonstrates awareness of the integration boundary.

**Verdict**: The design builds on top of pi-mono correctly. No reinvention detected.

---

## Qualitative Evidence

| Aspect | Assessment | Rationale |
|---|---|---|
| Problem Clarity | GOOD | Design solves the exact problem statement. All 10 ACs map to concrete implementation sections. |
| Scope | GOOD | Staged rollout is preserved. Stage 1 is bounded. The two harder capabilities (multi-persona, cross-session) are in Stage 2 but fully designed. |
| Testability | GOOD | Every AC has a verifiable implementation path. Tool schemas are typed. Store operations are pure functions testable with a mock filesystem. |
| Design Gaps | LOW | Two minor gaps (SessionMemoryState type, KanbanStore definition) are not blocking. Both are Stage 2 concerns with obvious resolutions. |
| Pi-mono integration | STRONG | Architecture is purely additive. pi-mono runtime is never duplicated or bypassed. |

---

## Recommendation

**Proceed to implementation.** Begin with Stage 1:
1. `src/store/` — base-store, jsonl-store, json-store (foundation for all state)
2. `src/extension.ts` and `src/types.ts` (factory and type contracts)
3. Domain registrars for: engineering, qe, memory, search (Stage 1 core)
4. Domain registrars for: platform, product, data, delivery, agentic (complete the 8 required for AC-2)
5. `brainstorm` and `project` domains (Stage 2, already fully designed)

Before Stage 2 implementation: resolve the `SessionMemoryState.primeMemories` type from `string`
to `MemoryEntry[]` to make the context hook deduplication logic consistent.

---

## Evidence

- Architecture reviewed: `/Users/michael.parcewski/Projects/the-agent/phases/design/rde-coding-agent-architecture.md` (1,801 lines, all sections read)
- Clarify deliverables reviewed: `objective.md`, `acceptance-criteria.md`
- Prior value gate reviewed: `clarify/value-gate-20260225-000000.md` (conditions 1 and 2 confirmed resolved)
- Artifact: `L3:qe:strategy-gate`
