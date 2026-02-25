/**
 * Tests for the Scenarios domain (AC-4).
 *
 * Verifies markdown scenario parsing, step extraction, and tool registration.
 */

import { describe, it, expect, vi } from "vitest";
import { parseScenario } from "../src/domains/scenarios/parser.js";
import { registerScenariosTools } from "../src/domains/scenarios/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: vi.fn(),
  };
  return { pi, tools };
}

// ── Scenario Parser Tests ───────────────────────────────────────────────────

describe("parseScenario", () => {
  it("extracts title from markdown heading", () => {
    const md = `# Scenario: Login flow\n\n## Steps\n1. Go to login`;
    const scenario = parseScenario(md);
    expect(scenario.title).toBe("Login flow");
  });

  it("extracts title without Scenario: prefix", () => {
    const md = `# My Test Scenario\n\n## Steps\n1. Do something`;
    const scenario = parseScenario(md);
    expect(scenario.title).toBe("My Test Scenario");
  });

  it("parses all four section types", () => {
    const md = `# Scenario: Full test

## Setup
- Create user
- Set up database

## Steps
1. Navigate to page
2. Click button
3. Fill form

## Expected
- Page loads
- Form submitted

## Teardown
- Delete user
`;

    const scenario = parseScenario(md);

    expect(scenario.setup).toHaveLength(2);
    expect(scenario.steps).toHaveLength(3);
    expect(scenario.expected).toHaveLength(2);
    expect(scenario.teardown).toHaveLength(1);
  });

  it("extracts step text from bullet and numbered items", () => {
    const md = `# Test

## Steps
1. First step
2. Second step
- Bullet step
* Star step
`;

    const scenario = parseScenario(md);
    expect(scenario.steps.map((s) => s.text)).toEqual([
      "First step",
      "Second step",
      "Bullet step",
      "Star step",
    ]);
  });

  it("assigns correct type to each step", () => {
    const md = `# Test

## Setup
- setup item

## Steps
1. step item

## Expected
- expected item

## Teardown
- teardown item
`;

    const scenario = parseScenario(md);
    expect(scenario.setup[0]!.type).toBe("setup");
    expect(scenario.steps[0]!.type).toBe("step");
    expect(scenario.expected[0]!.type).toBe("expected");
    expect(scenario.teardown[0]!.type).toBe("teardown");
  });

  it("assigns sequential index to steps within each section", () => {
    const md = `# Test

## Steps
1. First
2. Second
3. Third
`;

    const scenario = parseScenario(md);
    expect(scenario.steps[0]!.index).toBe(1);
    expect(scenario.steps[1]!.index).toBe(2);
    expect(scenario.steps[2]!.index).toBe(3);
  });

  it("defaults to 'Untitled Scenario' when no title found", () => {
    const md = `## Steps\n1. Do something`;
    const scenario = parseScenario(md);
    expect(scenario.title).toBe("Untitled Scenario");
  });

  it("handles empty markdown gracefully", () => {
    const scenario = parseScenario("");
    expect(scenario.title).toBe("Untitled Scenario");
    expect(scenario.setup).toHaveLength(0);
    expect(scenario.steps).toHaveLength(0);
    expect(scenario.expected).toHaveLength(0);
    expect(scenario.teardown).toHaveLength(0);
  });
});

// ── Tool Registration ───────────────────────────────────────────────────────

describe("registerScenariosTools — registration", () => {
  it("registers scenario_parse and scenario_run tools", () => {
    const { pi, tools } = makeMockPi();
    registerScenariosTools(pi as any);

    expect(tools.has("scenario_parse")).toBe(true);
    expect(tools.has("scenario_run")).toBe(true);
  });

  it("scenario_parse has path parameter", () => {
    const { pi, tools } = makeMockPi();
    registerScenariosTools(pi as any);

    const tool = tools.get("scenario_parse")!;
    expect(tool.parameters.properties).toHaveProperty("path");
  });

  it("scenario_run has path parameter", () => {
    const { pi, tools } = makeMockPi();
    registerScenariosTools(pi as any);

    const tool = tools.get("scenario_run")!;
    expect(tool.parameters.properties).toHaveProperty("path");
  });

  it("tools reject unsafe paths", async () => {
    const { pi, tools } = makeMockPi();
    registerScenariosTools(pi as any);

    const tool = tools.get("scenario_parse")!;
    const signal = new AbortController().signal;

    // Absolute path
    await expect(
      tool.execute("id", { path: "/etc/passwd" }, signal),
    ).rejects.toThrow("Unsafe path");

    // Parent traversal
    await expect(
      tool.execute("id", { path: "../../../etc/passwd" }, signal),
    ).rejects.toThrow("Unsafe path");

    // Tilde expansion
    await expect(
      tool.execute("id", { path: "~/.ssh/keys" }, signal),
    ).rejects.toThrow("Unsafe path");
  });
});
