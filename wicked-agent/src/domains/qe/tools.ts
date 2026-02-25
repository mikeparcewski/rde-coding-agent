/**
 * QE domain tools.
 *
 * Provides test strategy generation, scenario creation (given/when/then),
 * and test automation stub generation.
 */

import { Type } from "@sinclair/typebox";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { PiTool, PiToolResult } from "../../types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function textResult(text: string): PiToolResult {
  return { type: "text", content: [{ type: "text", text }] };
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    return `[could not read file: ${(err as Error).message}]`;
  }
}

async function collectSourceFiles(dir: string, exts: Set<string>): Promise<string[]> {
  const result: string[] = [];
  const ignore = new Set(["node_modules", ".git", "dist", "coverage", ".next", "__pycache__"]);

  async function walk(current: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.has(entry)) continue;
      const full = join(current, entry);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        await walk(full);
      } else if (exts.has(extname(entry).toLowerCase())) {
        result.push(full);
      }
    }
  }

  await walk(dir);
  return result;
}

// ── test_strategy ─────────────────────────────────────────────────────────────

export const testStrategyTool: PiTool = {
  name: "test_strategy",
  label: "Test Strategy",
  description:
    "Analyzes a codebase area and produces a comprehensive test plan covering unit, integration, and e2e layers.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Directory to analyze for test strategy.",
    }),
    context: Type.Optional(
      Type.String({
        description: "Additional context about the feature or system under test.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { directory, context } = input as { directory: string; context?: string };

    const sections: string[] = [];
    sections.push(`# Test Strategy: \`${directory}\``);
    if (context) sections.push(`\n**Context**: ${context}\n`);

    const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".cs", ".rb"]);
    const testExts = new Set([".test.ts", ".spec.ts", ".test.js", ".spec.js"]);

    const allFiles = await collectSourceFiles(directory, sourceExts);
    const testFiles = allFiles.filter((f) => {
      const base = f.toLowerCase();
      return base.includes(".test.") || base.includes(".spec.") || base.includes("__tests__");
    });
    const sourceFiles = allFiles.filter((f) => !testFiles.includes(f));

    // Language detection
    const extCounts: Record<string, number> = {};
    for (const f of sourceFiles) {
      const ext = extname(f);
      extCounts[ext] = (extCounts[ext] ?? 0) + 1;
    }
    const topExt = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ".ts";

    sections.push(`\n## Codebase Overview`);
    sections.push(`- Source files: ${sourceFiles.length}`);
    sections.push(`- Existing test files: ${testFiles.length}`);
    sections.push(`- Primary language: \`${topExt}\``);

    const coverage = sourceFiles.length > 0
      ? Math.round((testFiles.length / sourceFiles.length) * 100)
      : 0;
    sections.push(`- Test-to-source ratio: ${coverage}%`);

    // Identify testable modules from exports
    const exportedModules: Array<{ file: string; exports: string[] }> = [];
    for (const f of sourceFiles.slice(0, 20)) {
      try {
        const content = await readFile(f, "utf-8");
        const exports = [];
        for (const line of content.split("\n")) {
          const m = line.match(/^export\s+(?:(?:async\s+)?function|const|class|interface|type)\s+(\w+)/);
          if (m) exports.push(m[1]);
        }
        if (exports.length > 0) exportedModules.push({ file: f, exports });
      } catch {
        // skip
      }
    }

    // Unit test plan
    sections.push(`\n## Unit Test Plan`);
    sections.push(`**Goal**: Test each exported function/class in isolation with mocked dependencies.\n`);
    sections.push(`**Framework recommendation**: ${[".ts", ".tsx"].includes(topExt) ? "Vitest or Jest" : [".py"].includes(topExt) ? "pytest" : "language-appropriate unit test framework"}`);
    sections.push(`**Coverage target**: 80%+ branch coverage\n`);

    if (exportedModules.length > 0) {
      sections.push("**Suggested unit test files**:");
      for (const mod of exportedModules.slice(0, 10)) {
        const base = mod.file.replace(/\.(ts|js|tsx|jsx)$/, "");
        sections.push(`\n- \`${base}.test${topExt}\``);
        sections.push(`  Exports to test: ${mod.exports.slice(0, 5).join(", ")}${mod.exports.length > 5 ? "…" : ""}`);
      }
    } else {
      sections.push("No exported symbols detected. Review module entry points manually.");
    }

    // Integration test plan
    sections.push(`\n## Integration Test Plan`);
    sections.push(`**Goal**: Test interactions between modules; verify data flows across boundaries.\n`);

    const hasDb = sourceFiles.some((f) => {
      return false; // will check content below
    });
    const hasApi = sourceFiles.some((f) => f.toLowerCase().includes("api") || f.toLowerCase().includes("route") || f.toLowerCase().includes("handler"));
    const hasStore = sourceFiles.some((f) => f.toLowerCase().includes("store") || f.toLowerCase().includes("repository"));

    const integrationAreas: string[] = [];
    if (hasApi) integrationAreas.push("API endpoint request/response cycles");
    if (hasStore) integrationAreas.push("Data store read/write operations");
    integrationAreas.push("Cross-module data transformation pipelines");
    integrationAreas.push("Error propagation across module boundaries");

    sections.push(integrationAreas.map((a) => `- ${a}`).join("\n"));

    // E2E test plan
    sections.push(`\n## End-to-End Test Plan`);
    sections.push(`**Goal**: Verify critical user journeys from entry point to output.\n`);
    sections.push("**Suggested scenarios**:");
    sections.push("- Happy path: valid inputs produce expected outputs");
    sections.push("- Error path: invalid inputs are handled gracefully");
    sections.push("- Edge cases: empty collections, boundary values, concurrent requests");
    sections.push("- Performance: response time under acceptable limits");

    // Priority matrix
    sections.push(`\n## Priority Matrix`);
    sections.push(`| Priority | Area | Type | Rationale |`);
    sections.push(`|----------|------|------|-----------|`);
    sections.push(`| P0 | Critical path functions | Unit | High business impact |`);
    sections.push(`| P0 | Error handling paths | Unit | Prevents silent failures |`);
    sections.push(`| P1 | API/service boundaries | Integration | Cross-module correctness |`);
    sections.push(`| P1 | Data persistence | Integration | Data integrity |`);
    sections.push(`| P2 | Full user journeys | E2E | Regression safety net |`);
    sections.push(`| P3 | Edge cases | Unit | Completeness |`);

    // Gaps
    sections.push(`\n## Identified Gaps`);
    const gaps: string[] = [];
    if (testFiles.length === 0) gaps.push("No test files found — test suite needs to be bootstrapped from scratch.");
    if (coverage < 20 && sourceFiles.length > 5) gaps.push(`Very low test coverage (${coverage}%) — immediate investment needed.`);
    if (!sourceFiles.some((f) => f.toLowerCase().includes("mock") || f.toLowerCase().includes("fixture"))) {
      gaps.push("No test fixtures or mocks detected — consider adding a `__mocks__` or `fixtures/` directory.");
    }
    if (gaps.length === 0) gaps.push("No critical gaps identified. Continue improving coverage incrementally.");
    sections.push(gaps.map((g) => `- ${g}`).join("\n"));

    return textResult(sections.join("\n"));
  },
};

// ── generate_scenarios ────────────────────────────────────────────────────────

export const generateScenariosTool: PiTool = {
  name: "generate_scenarios",
  label: "Generate Test Scenarios",
  description:
    "Takes a feature description and produces BDD-style test scenarios in given/when/then format.",
  parameters: Type.Object({
    feature: Type.String({
      description: "Name or title of the feature.",
    }),
    description: Type.String({
      description: "Detailed description of what the feature does.",
    }),
    actor: Type.Optional(
      Type.String({ description: "Primary actor (e.g. 'user', 'admin', 'system'). Default: user." }),
    ),
    acceptance_criteria: Type.Optional(
      Type.Array(Type.String(), {
        description: "Explicit acceptance criteria to turn into scenarios.",
      }),
    ),
  }),

  async execute(_id, input) {
    const {
      feature,
      description,
      actor = "user",
      acceptance_criteria = [],
    } = input as {
      feature: string;
      description: string;
      actor?: string;
      acceptance_criteria?: string[];
    };

    const sections: string[] = [];
    sections.push(`# Test Scenarios: ${feature}`);
    sections.push(`\n**Feature Description**: ${description}`);
    sections.push(`**Primary Actor**: ${actor}\n`);

    // Core scenarios derived from feature description
    const scenarios: Array<{
      title: string;
      given: string[];
      when: string[];
      then: string[];
      tags: string[];
    }> = [];

    // Always generate happy path
    scenarios.push({
      title: `Happy path — ${actor} successfully uses ${feature}`,
      given: [
        `the ${actor} is authenticated and has appropriate permissions`,
        `the system is in a valid state with required data present`,
      ],
      when: [
        `the ${actor} initiates the ${feature} action with valid inputs`,
        `the system processes the request`,
      ],
      then: [
        `the operation completes successfully`,
        `the ${actor} receives a success response`,
        `the system state is updated correctly`,
        `appropriate events or side-effects are triggered`,
      ],
      tags: ["@happy-path", "@smoke"],
    });

    // Invalid input scenario
    scenarios.push({
      title: `Validation — ${feature} rejects invalid inputs`,
      given: [
        `the ${actor} is authenticated`,
        `the system is in a valid state`,
      ],
      when: [
        `the ${actor} submits ${feature} with missing or malformed inputs`,
      ],
      then: [
        `the system returns a validation error`,
        `the error message clearly explains what is wrong`,
        `no side-effects occur`,
        `the system state remains unchanged`,
      ],
      tags: ["@validation", "@error-handling"],
    });

    // Unauthorized access scenario
    scenarios.push({
      title: `Security — unauthorized ${actor} cannot access ${feature}`,
      given: [
        `a ${actor} without the required permissions or not authenticated`,
      ],
      when: [
        `the ${actor} attempts to use ${feature}`,
      ],
      then: [
        `the system denies access with a 401/403 response`,
        `no sensitive data is exposed`,
        `the attempt is logged for audit purposes`,
      ],
      tags: ["@security", "@authorization"],
    });

    // Concurrent/race condition scenario
    scenarios.push({
      title: `Concurrency — ${feature} handles simultaneous requests`,
      given: [
        `multiple ${actor}s are using the system concurrently`,
        `the system is under normal load`,
      ],
      when: [
        `two or more ${actor}s trigger ${feature} at the same time with overlapping data`,
      ],
      then: [
        `the system handles concurrency without data corruption`,
        `at least one request succeeds or all receive appropriate conflict responses`,
        `no deadlocks occur`,
      ],
      tags: ["@concurrency", "@edge-case"],
    });

    // Empty/boundary state scenario
    scenarios.push({
      title: `Edge case — ${feature} handles empty or boundary state`,
      given: [
        `the ${actor} is authenticated`,
        `the relevant data collection is empty or at its limit`,
      ],
      when: [
        `the ${actor} triggers ${feature}`,
      ],
      then: [
        `the system returns an appropriate empty result or limit-reached response`,
        `no crashes or unhandled exceptions occur`,
        `the UX communicates the state clearly`,
      ],
      tags: ["@edge-case", "@boundary"],
    });

    // Generate scenarios from explicit acceptance criteria
    for (let i = 0; i < acceptance_criteria.length; i++) {
      const criterion = acceptance_criteria[i];
      scenarios.push({
        title: `AC${i + 1}: ${criterion}`,
        given: [
          `the ${actor} is in a state where the criterion can be tested`,
        ],
        when: [
          `the ${actor} performs the action relevant to: "${criterion}"`,
        ],
        then: [
          `the system satisfies: ${criterion}`,
          `the result is verifiable and deterministic`,
        ],
        tags: [`@ac-${i + 1}`, "@acceptance"],
      });
    }

    // Format scenarios
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      sections.push(`\n---\n\n## Scenario ${i + 1}: ${s.title}`);
      sections.push(`**Tags**: ${s.tags.join(" ")}\n`);
      sections.push("```gherkin");
      sections.push(`Scenario: ${s.title}`);
      for (const g of s.given) sections.push(`  Given ${g}`);
      for (let wi = 0; wi < s.when.length; wi++) {
        sections.push(`  ${wi === 0 ? "When" : "And"} ${s.when[wi]}`);
      }
      for (let ti = 0; ti < s.then.length; ti++) {
        sections.push(`  ${ti === 0 ? "Then" : "And"} ${s.then[ti]}`);
      }
      sections.push("```");
    }

    sections.push(`\n---\n\n## Summary`);
    sections.push(`Generated **${scenarios.length}** scenarios for feature \`${feature}\`:`);
    sections.push(`- 1 Happy path`);
    sections.push(`- 1 Validation / error handling`);
    sections.push(`- 1 Security / authorization`);
    sections.push(`- 1 Concurrency / race conditions`);
    sections.push(`- 1 Edge case / boundary`);
    if (acceptance_criteria.length > 0) {
      sections.push(`- ${acceptance_criteria.length} Acceptance criteria scenarios`);
    }

    return textResult(sections.join("\n"));
  },
};

// ── test_automation ───────────────────────────────────────────────────────────

export const testAutomationTool: PiTool = {
  name: "test_automation",
  label: "Test Automation Stub",
  description:
    "Takes a test scenario description and produces a runnable test code stub in the specified framework.",
  parameters: Type.Object({
    scenario: Type.String({
      description: "The test scenario to automate (plain text or Gherkin).",
    }),
    framework: Type.Optional(
      Type.Union(
        [
          Type.Literal("vitest"),
          Type.Literal("jest"),
          Type.Literal("pytest"),
          Type.Literal("mocha"),
        ],
        { description: "Test framework. Default: vitest." },
      ),
    ),
    subject_file: Type.Optional(
      Type.String({ description: "Path to the file under test, for import generation." }),
    ),
  }),

  async execute(_id, input) {
    const {
      scenario,
      framework = "vitest",
      subject_file,
    } = input as {
      scenario: string;
      framework?: "vitest" | "jest" | "pytest" | "mocha";
      subject_file?: string;
    };

    const sections: string[] = [];
    sections.push(`# Test Automation Stub`);
    sections.push(`**Framework**: ${framework}`);
    sections.push(`**Scenario**: ${scenario.slice(0, 200)}${scenario.length > 200 ? "..." : ""}\n`);

    // Parse given/when/then blocks from scenario text
    const givenMatch = scenario.match(/Given\s+(.+?)(?=\n\s*(?:And|When|Then)|$)/is);
    const whenMatch = scenario.match(/When\s+(.+?)(?=\n\s*(?:And|Then)|$)/is);
    const thenMatch = scenario.match(/Then\s+(.+?)(?=\n\s*And|$)/is);

    const given = givenMatch ? givenMatch[1].trim() : "the system is in a known state";
    const when = whenMatch ? whenMatch[1].trim() : "an action is performed";
    const then = thenMatch ? thenMatch[1].trim() : "the expected result occurs";

    // Build test name from scenario
    const testName = scenario
      .split("\n")[0]
      .replace(/^(Scenario|Feature|Story):\s*/i, "")
      .trim()
      .slice(0, 80);

    if (framework === "vitest" || framework === "jest") {
      const importLine = subject_file
        ? `import { /* TODO: add exports */ } from "${subject_file.replace(/\.(ts|tsx)$/, ".js")}";`
        : `// import { subject } from "./subject.js";`;

      const isVitest = framework === "vitest";

      sections.push("```typescript");
      sections.push(
        `import { describe, it, expect, beforeEach, afterEach${isVitest ? ", vi" : ", jest"} } from "${framework}";`,
      );
      sections.push(importLine);
      sections.push("");
      sections.push(`describe("${testName}", () => {`);
      sections.push(`  // Setup — ${given}`);
      sections.push(`  beforeEach(() => {`);
      sections.push(`    // TODO: set up test state`);
      sections.push(`    // TODO: mock external dependencies`);
      sections.push(`  });`);
      sections.push(``);
      sections.push(`  afterEach(() => {`);
      sections.push(`    ${isVitest ? "vi" : "jest"}.clearAllMocks();`);
      sections.push(`  });`);
      sections.push(``);
      sections.push(`  it("${testName}", async () => {`);
      sections.push(`    // GIVEN: ${given}`);
      sections.push(`    // TODO: arrange test state`);
      sections.push(`    const input = { /* TODO: valid inputs */ };`);
      sections.push(``);
      sections.push(`    // WHEN: ${when}`);
      sections.push(`    // TODO: call the function or system under test`);
      sections.push(`    // const result = await subject(input);`);
      sections.push(`    const result: unknown = null; // replace with actual call`);
      sections.push(``);
      sections.push(`    // THEN: ${then}`);
      sections.push(`    expect(result).toBeDefined();`);
      sections.push(`    // TODO: add specific assertions`);
      sections.push(`    // expect(result).toEqual(expectedOutput);`);
      sections.push(`  });`);
      sections.push(``);
      sections.push(`  it("${testName} — invalid inputs", async () => {`);
      sections.push(`    // GIVEN: the system is ready`);
      sections.push(`    // WHEN: invalid inputs are provided`);
      sections.push(`    const invalidInput = { /* TODO */ };`);
      sections.push(`    // THEN: an error is thrown or a validation result is returned`);
      sections.push(`    // await expect(subject(invalidInput)).rejects.toThrow();`);
      sections.push(`    expect(true).toBe(true); // TODO: replace with real assertion`);
      sections.push(`  });`);
      sections.push(`});`);
      sections.push("```");
    } else if (framework === "pytest") {
      sections.push("```python");
      sections.push("import pytest");
      if (subject_file) {
        sections.push(`# from ${subject_file} import subject  # TODO: add real import`);
      }
      sections.push("");
      sections.push("");
      sections.push(`class Test${testName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}:`);
      sections.push(`    """${testName}"""`);
      sections.push(``);
      sections.push(`    def setup_method(self):`);
      sections.push(`        """GIVEN: ${given}"""`);
      sections.push(`        # TODO: initialize test state`);
      sections.push(`        pass`);
      sections.push(``);
      sections.push(`    def test_happy_path(self):`);
      sections.push(`        """WHEN: ${when} THEN: ${then}"""`);
      sections.push(`        # Arrange`);
      sections.push(`        input_data = {}  # TODO: valid inputs`);
      sections.push(`        # Act`);
      sections.push(`        # result = subject(input_data)  # TODO: call subject`);
      sections.push(`        result = None  # replace`);
      sections.push(`        # Assert`);
      sections.push(`        assert result is not None  # TODO: real assertion`);
      sections.push(``);
      sections.push(`    def test_invalid_inputs(self):`);
      sections.push(`        """Tests error handling for invalid inputs."""`);
      sections.push(`        with pytest.raises(Exception):  # TODO: specific exception`);
      sections.push(`            pass  # TODO: call subject with invalid inputs`);
      sections.push("```");
    } else {
      // mocha
      sections.push("```javascript");
      sections.push(`const { describe, it, before, after } = require("mocha");`);
      sections.push(`const { expect } = require("chai");`);
      if (subject_file) sections.push(`// const { subject } = require("${subject_file}");`);
      sections.push(``);
      sections.push(`describe("${testName}", function() {`);
      sections.push(`  before(function() {`);
      sections.push(`    // GIVEN: ${given}`);
      sections.push(`    // TODO: setup`);
      sections.push(`  });`);
      sections.push(``);
      sections.push(`  it("${testName}", async function() {`);
      sections.push(`    // WHEN: ${when}`);
      sections.push(`    const result = null; // TODO: call subject`);
      sections.push(`    // THEN: ${then}`);
      sections.push(`    expect(result).to.not.be.null; // TODO`);
      sections.push(`  });`);
      sections.push(`});`);
      sections.push("```");
    }

    sections.push(`\n## Implementation Notes`);
    sections.push(`1. Replace \`// TODO\` comments with actual test logic.`);
    sections.push(`2. Add mocks for all external dependencies (HTTP clients, database, file system).`);
    sections.push(`3. Ensure \`beforeEach\`/\`setup\` resets all shared state to avoid test pollution.`);
    sections.push(`4. Run the test suite in CI on every pull request.`);

    return textResult(sections.join("\n"));
  },
};
