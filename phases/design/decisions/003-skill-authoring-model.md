# ADR-003: Hybrid Skill Authoring (Markdown-First, TypeScript Optional)

## Status
Accepted

## Context

Skills are the primary extension point for the framework. Two audiences will author them:

1. Non-engineers (product managers, technical writers) who can write markdown but not TypeScript.
2. Engineers who need to call APIs, read files, or perform computation in a handler.

We need a model that serves both without requiring engineers to write boilerplate for simple prompt
skills, and without blocking non-engineers from contributing skills at all.

## Decision

Every skill is a markdown file with YAML frontmatter (the `SkillFrontmatterSchema`). The markdown
body is the skill's prompt template. Parameter interpolation uses `{{paramName}}` syntax.

A co-located TypeScript file is optional. When present, it must export a `SkillHandler` object
containing a compiled `Tool`. The loader detects the handler file by naming convention and imports
it dynamically.

The `skillMode` flag controls error handling:
- `strict`: any malformed frontmatter or missing required handler throws at startup.
- `permissive`: malformed skills are logged and skipped. The rest of the skill set still loads.

## Consequences

Easier:
- Non-engineers can define skills by writing markdown only.
- Engineers get a clear TypeScript contract for complex handlers.
- Skills are readable in any editor or on GitHub without running the framework.
- `requiresHandler: true` in frontmatter documents intent explicitly.

Harder:
- Two authoring paths to document and test.
- Handler file naming convention must be enforced by convention, not the file system.
- Markdown-only skills always produce a new LLM call. They cannot return structured data or
  perform side effects. For those use cases, a handler is mandatory.

## Alternatives Considered

**TypeScript-only skills**: Full power, but excludes non-technical contributors and adds ceremony
for simple prompt wrapping.

**YAML configuration + separate prompt file**: Three files per skill (YAML, prompt, handler).
Unnecessary fragmentation.

**Single markdown file with embedded TypeScript code blocks**: Requires a custom parser that
extracts and evals TypeScript from markdown. Security and tooling concerns are significant.
