# ADR-002: Zod Schemas as Single Source of Truth for Types

## Status
Accepted

## Context

The framework loads configuration from disk (YAML frontmatter, `agent.config.ts`), receives
untrusted input from users and LLM responses, and passes data across package boundaries. We need
both compile-time type safety and runtime validation. Maintaining separate TypeScript interfaces
and runtime validators creates drift and doubles the maintenance surface.

## Decision

All data shapes are defined as Zod schemas first. TypeScript types are derived using `z.infer<>`.
No standalone TypeScript `interface` or `type` alias is created for a validated data shape. Raw
interfaces (e.g., `LLMAdapter`) that are never parsed from external input remain as TypeScript
interfaces only.

Validation is enforced:
- When reading frontmatter from disk (skills, agents)
- When parsing `agent.config.ts` exports via `defineFramework()`
- When receiving `CompletionSignal` from LLM adapters
- When handlers return results (via `ToolResult` schema)

## Consequences

Easier:
- One change location updates both runtime behavior and TypeScript types.
- Schema documentation (`.describe()`) can generate JSON Schema for external tooling.
- Zod's parse errors are developer-friendly and point to the exact field.
- `z.infer<>` stays in sync automatically — no interface drift.

Harder:
- Zod adds ~12KB gzipped to the install. Acceptable given the 50MB budget.
- Lazy recursive schemas (for nested `ToolParameter`) need `z.lazy()`, which loses some
  inference quality.
- Developers unfamiliar with Zod face a learning curve.

## Alternatives Considered

**TypeScript interfaces + manual validation (e.g., `ajv`)**: Two sources of truth for every type.
Any time a field is added the validator and the interface must both change. High drift risk.

**TypeScript interfaces + `io-ts`**: Strong typing but significantly higher complexity for basic
schemas. Functional programming style clashes with the imperative style of the rest of the
framework.

**JSON Schema + code generation**: External tooling dependency. Schema lives in a separate file.
The TypeScript types it generates are often verbose and lose documentation.
