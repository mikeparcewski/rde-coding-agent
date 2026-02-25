# ADR-001: Layered Monolith with Strict Dependency Hierarchy

## Status
Accepted

## Context

The framework must support five distinct concerns: runtime execution, LLM provider integration,
skill loading, agent management, and CLI presentation. These concerns have different rates of
change. Provider APIs change when vendors ship new models. Skills change when teams add features.
The runtime loop changes rarely. We need isolation without the operational cost of microservices.

The target audience is developers running a CLI tool locally, not operators running distributed
systems. There is no network topology to design.

## Decision

Use a layered monolith structured as an npm workspace monorepo. Five packages. One strict
dependency direction: `cli -> agents/skills/providers -> core`. No package may import from a
package above it in the hierarchy.

All cross-package contracts are defined as TypeScript interfaces (backed by Zod schemas) in
`@the-agent/core`. Packages depend on interfaces, not on implementations.

## Consequences

Easier:
- Each package can be tested in isolation by mocking the interfaces from `core`.
- Teams can replace the LLM provider by implementing `LLMAdapter` without touching anything else.
- Bundle size stays small: consumers import only what `cli` exposes.
- TypeScript project references give incremental compilation with correct build ordering.

Harder:
- Adding a cross-cutting feature (e.g., tracing) requires touching all packages that need it.
- Circular data flows must be broken by events or callbacks rather than direct imports.
- Adding a sixth package requires deliberately deciding where it sits in the hierarchy.

## Alternatives Considered

**Single package (`the-agent`)**: Simpler setup, but no isolation. Skills would import runtime
internals. Testing would require a full integration setup every time.

**Plugin-based microkernel**: Core publishes plugin hooks; all other packages are plugins.
Maximally flexible but high ceremony for such a small surface area. Premature for v1.

**Separate npm packages (not a monorepo)**: Versioning becomes a coordination problem immediately.
Wrong for a framework that must evolve as a unit during early development.
