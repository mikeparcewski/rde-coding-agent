/**
 * Scenario markdown parser.
 *
 * Parses a markdown scenario file into a structured Scenario object.
 *
 * Expected format:
 * ```markdown
 * # Scenario: Login flow
 *
 * ## Setup
 * - Create test user with email "test@example.com"
 *
 * ## Steps
 * 1. Navigate to /login
 * 2. Enter email "test@example.com"
 * 3. Enter password "secret"
 * 4. Click "Sign in"
 *
 * ## Expected
 * - User is redirected to /dashboard
 * - Session cookie is set
 *
 * ## Teardown
 * - Delete test user
 * ```
 */

export interface ScenarioStep {
  index: number;
  text: string;
  type: "setup" | "step" | "expected" | "teardown";
}

export interface Scenario {
  title: string;
  description: string;
  setup: ScenarioStep[];
  steps: ScenarioStep[];
  expected: ScenarioStep[];
  teardown: ScenarioStep[];
}

export interface StepResult {
  step: ScenarioStep;
  status: "pass" | "fail" | "skip";
  error?: string;
  durationMs: number;
}

export interface ScenarioReport {
  scenario: string;
  totalSteps: number;
  passed: number;
  failed: number;
  skipped: number;
  results: StepResult[];
  durationMs: number;
  status: "pass" | "fail";
}

type SectionType = "setup" | "steps" | "expected" | "teardown";

export function parseScenario(markdown: string): Scenario {
  const lines = markdown.split("\n");

  let title = "";
  let description = "";
  let currentSection: SectionType | null = null;
  const sections: Record<SectionType, string[]> = {
    setup: [],
    steps: [],
    expected: [],
    teardown: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Title: # Scenario: ...
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      title = trimmed
        .replace(/^#\s+/, "")
        .replace(/^Scenario:\s*/i, "")
        .trim();
      continue;
    }

    // Section headers
    if (trimmed.startsWith("## ")) {
      const sectionName = trimmed.replace(/^##\s+/, "").toLowerCase().trim();
      if (sectionName === "setup") currentSection = "setup";
      else if (sectionName === "steps") currentSection = "steps";
      else if (sectionName === "expected") currentSection = "expected";
      else if (sectionName === "teardown") currentSection = "teardown";
      else currentSection = null;
      continue;
    }

    // Extract list items and numbered items as steps
    if (currentSection) {
      const listMatch = trimmed.match(/^[-*]\s+(.+)/);
      const numberedMatch = trimmed.match(/^\d+\.\s+(.+)/);

      if (listMatch) {
        sections[currentSection].push(listMatch[1]!);
      } else if (numberedMatch) {
        sections[currentSection].push(numberedMatch[1]!);
      } else if (trimmed && !title) {
        // Non-empty, non-header lines before sections are description
        description += (description ? " " : "") + trimmed;
      }
    } else if (trimmed && title && !trimmed.startsWith("#")) {
      description += (description ? " " : "") + trimmed;
    }
  }

  const makeSteps = (items: string[], type: ScenarioStep["type"]): ScenarioStep[] =>
    items.map((text, i) => ({ index: i + 1, text, type }));

  return {
    title: title || "Untitled Scenario",
    description,
    setup: makeSteps(sections.setup, "setup"),
    steps: makeSteps(sections.steps, "step"),
    expected: makeSteps(sections.expected, "expected"),
    teardown: makeSteps(sections.teardown, "teardown"),
  };
}
