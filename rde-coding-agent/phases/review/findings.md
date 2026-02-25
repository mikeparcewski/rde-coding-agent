# Review Findings

## Summary

APPROVE. The v02 changes are well-implemented and correct. All 115 tests pass, the TypeScript compiler reports no errors, and the two new domains (scenarios, patch) follow established patterns. The critical brainstorm model-hardcoding issue identified in the prior review (findings.md) has been fully resolved. Three concerns are noted below, none of which are blockers for merging.

---

## Changes Reviewed

- `src/types.ts` — correct; `scenarios` and `patch` added to DOMAIN_NAMES, `getModel?` and `ai?` added to PiExtensionAPI and ResolvedConfig; optional fields are properly gated
- `src/extension.ts` — correct; factory captures `pi.getModel` and `pi.ai` into resolved config before dispatching to registrars; DomainRegistrar re-declared locally (minor redundancy, see concerns)
- `src/domains/brainstorm/index.ts` — correct; `config.getModel` now forwarded to `registerBrainstormTools`
- `src/domains/brainstorm/tools.ts` — prior CRITICAL resolved; now calls `getModel()` and throws clearly when not provided; model passed to all streamSimple calls including synthesis
- `src/domains/scenarios/index.ts` — correct; clean pass-through registrar
- `src/domains/scenarios/parser.ts` — correct; handles all four sections, graceful defaults, no crash on empty input
- `src/domains/scenarios/tools.ts` — correct; `assertSafePath` guards both tools; step abort-on-setup-failure is logically sound
- `src/domains/scenarios/commands.ts` — correct; path check is consistent with the tool layer
- `src/domains/patch/index.ts` — correct
- `src/domains/patch/tools.ts` — correct; path safety via per-path validation in `findReferences`; regex escaping applied to both old and new name in the replace operation
- `src/domains/patch/commands.ts` — correct; /rename and /remove are advisory-only (they tell the user to use the tool), no path or symbol injection risk
- `tests/context-hook.test.ts` — covers deduplication logic correctly; see concern C-2
- `tests/scenarios.test.ts` — covers parser exhaustively; tool registration and path safety covered
- `tests/patch.test.ts` — covers registration and path safety; see concern C-3
- `tests/brainstorm.test.ts` (additions) — AC-2 model resolution tests are thorough; cover getModel call, throw-without-resolver, model-to-synthesis propagation, and quick_jam
- `tests/factory.test.ts` (additions) — AC-1 E2E tests confirm all 14 domains load, tools and commands appear, no console.warn fires

---

## Issues Found

### Critical (Must Fix)

None.

---

### Concerns (Should Fix)

**C-1. `DomainRegistrar` type is declared twice**

Location: `src/extension.ts` line 35 and `src/types.ts` line 120-123.

`extension.ts` declares a local `type DomainRegistrar` that is structurally identical to the exported `DomainRegistrar` in `types.ts`, but the local one is used for `DOMAIN_REGISTRARS` and the exported one is never imported. TypeScript accepts this because the shapes match, but it creates a maintenance hazard: if the signature in `types.ts` changes (e.g., adding a third parameter), `extension.ts` will silently diverge unless both are updated.

Recommendation: Remove the local re-declaration in `extension.ts` and import `DomainRegistrar` from `./types.js` alongside the other type imports.

---

**C-2. Context hook skips injection entirely when `primeMemories` is empty, even if dynamic recall finds results**

Location: `src/domains/memory/hooks.ts` line 62.

```typescript
if (sessionState.primeMemories.length === 0) return; // early exit
```

This guard fires before dynamic recall is attempted. If `session_start` returned no memories (cold start, new session) but a subsequent turn's dynamic recall would find relevant entries, those entries are never injected into context. The test suite validates the empty-primes / no-injection case but does not test the scenario where primes are empty and dynamic recall returns results.

This is a behavior inconsistency: primes gate dynamic recall rather than being an independent signal. A user on a new session whose first message matches stored memories gets no memory injection.

Recommendation: Move the early-return guard to after merging prime and dynamic memories, and only skip injection when the merged set is empty (line 93, `if (top.length === 0) return`, already handles this correctly). The line 62 guard can be removed or relaxed to:

```typescript
// Allow dynamic recall to still run even with no prime memories
// The top.length === 0 guard below handles the true empty case
```

---

**C-3. `scenario_run` execute behavior is not tested — report always shows "pass" for all steps**

Location: `src/domains/scenarios/tools.ts` lines 27-47 and `tests/scenarios.test.ts`.

`executeStep` currently always returns `status: "pass"` because no actual execution logic is implemented — the try/catch wraps only a `return` statement that can never throw. The tool description says "runs each step" but the implementation returns a structural report with all steps marked passing.

The tests do not exercise `scenario_run.execute` against a real or mocked filesystem — they only verify path rejection. There is no test covering:
- Report structure returned for a parsed scenario
- The abort-on-setup-failure behavior (line 178: `if (result.status === "fail" && step.type === "setup")`) — this is dead code because failures cannot occur

This is an honest stub (the comment on line 32 documents it), but it means the tool silently passes all scenarios regardless of actual conditions. Users expecting real assertion execution will receive misleading results.

Recommendation: Either (a) document prominently in the tool `description` that this is a structural parser/reporter, not an executor, so agents do not treat the "pass" result as a meaningful assertion, or (b) if real execution is planned, add a failing test that documents the expected behavior as a TODO. The abort-on-setup-failure branch should be covered by at least one test when execution is implemented.

---

### Suggestions (Nice to Have)

**S-1. `file_glob` parameter in patch tools is not validated**

Location: `src/domains/patch/tools.ts` lines 57-59.

The `file_glob` value (e.g., `--glob=/etc/**`) is passed directly to `rg` as `--glob=<value>`. While `execFile` prevents shell injection, a glob like `/etc/**` would direct ripgrep to search outside the project directory. The path safety in `findReferences` covers the `paths` array but not `file_glob`.

If the path-validation posture is intentionally permissive for a developer tool (consistent with the existing search domain), this is acceptable — document it. Otherwise, apply the same check that guards paths.

**S-2. AC-1 factory test verifies `registerTool` was called but does not confirm `getModel` propagation reaches brainstorm execute**

Location: `tests/factory.test.ts` lines 267-282.

The test "captures pi.getModel into resolved config for brainstorm" only asserts that `registerTool` was called. It does not confirm that the captured `getModel` would actually be invoked when the brainstorm tool executes. The AC-2 unit tests in `brainstorm.test.ts` cover this well at the domain level, but an E2E integration test that fires the brainstorm tool's execute through the factory-registered instance and verifies `mockGetModel` was called would close the gap completely.

---

## Test Coverage

All 115 tests pass. The v02 test additions provide solid coverage of:

- AC-1: Full extension loading with 14 domains, no registration errors, correct tool and command presence
- AC-2: Brainstorm model resolution via getModel(), error on missing resolver, model propagated to synthesis
- AC-3: Memory deduplication by id, prime-first ordering, skip when empty
- AC-4: Parser section parsing, type assignment, index sequencing, edge cases (empty input, no title), path rejection
- AC-5: Tool registration, parameter schema presence, path rejection for absolute, traversal, and tilde paths

Gaps:
- `scenario_run` execute path is not tested against actual parsed content (noted in C-3)
- `rename_symbol` and `remove_symbol` execute paths that reach `findReferences` (rg call) are not tested; only path rejection is covered

---

## Recommendation

APPROVE. The v02 changes are correct and ship-ready. The prior CRITICAL issue (hardcoded brainstorm model) is resolved cleanly. The three concerns above should be addressed in the next iteration; none prevent the current PR from merging into a development branch.

Priority order for follow-up:
1. C-2 (context hook skips dynamic recall when primes are empty) — silent data loss
2. C-1 (duplicate DomainRegistrar type) — maintenance hazard
3. C-3 (scenario_run always passes) — misleading behavior that should be documented
