/**
 * Product domain tools.
 *
 * Requirements elicitation, UX review, and acceptance criteria generation.
 */

import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import type { PiTool, PiToolResult } from "../../types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function textResult(text: string): PiToolResult {
  return { type: "text", content: [{ type: "text", text }] };
}

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    return `[could not read: ${(err as Error).message}]`;
  }
}

// ── elicit_requirements ───────────────────────────────────────────────────────

export const elicitRequirementsTool: PiTool = {
  name: "elicit_requirements",
  label: "Elicit Requirements",
  description:
    "Takes a feature idea and produces structured user stories with personas, workflows, and non-functional requirements.",
  parameters: Type.Object({
    feature_idea: Type.String({
      description: "A description of the feature or product idea.",
    }),
    personas: Type.Optional(
      Type.Array(Type.String(), {
        description: "User personas to consider (e.g. 'developer', 'admin', 'guest').",
      }),
    ),
    constraints: Type.Optional(
      Type.String({
        description: "Technical or business constraints to respect.",
      }),
    ),
  }),

  async execute(_id, input) {
    const {
      feature_idea,
      personas = ["end user", "administrator", "system"],
      constraints,
    } = input as {
      feature_idea: string;
      personas?: string[];
      constraints?: string;
    };

    const sections: string[] = [];
    sections.push(`# Requirements: ${feature_idea.slice(0, 60)}${feature_idea.length > 60 ? "..." : ""}`);
    sections.push(`\n**Feature Idea**: ${feature_idea}`);
    if (constraints) sections.push(`**Constraints**: ${constraints}`);
    sections.push("");

    // Problem statement
    sections.push("## Problem Statement");
    sections.push(
      `The feature aims to solve the following need:\n> ${feature_idea}\n\n` +
      "This problem is worth solving because it directly impacts user productivity, satisfaction, or business outcomes.",
    );

    // Personas and user stories
    sections.push("\n## User Stories");

    const storyTemplates: Record<string, Array<{ story: string; rationale: string }>> = {
      "end user": [
        {
          story: `As an **end user**, I want to ${feature_idea.toLowerCase().replace(/^(add|create|build|implement)\s+/, "use ")} so that I can accomplish my goal efficiently.`,
          rationale: "Core user value — primary happy path.",
        },
        {
          story: `As an **end user**, I want to see clear error messages when something goes wrong so that I can understand what happened and recover.`,
          rationale: "Error handling UX — reduces support burden.",
        },
        {
          story: `As an **end user**, I want the system to remember my preferences so that I don't have to reconfigure on every session.`,
          rationale: "Personalization — improves retention.",
        },
      ],
      "administrator": [
        {
          story: `As an **administrator**, I want to configure and manage the feature's settings so that I can control its behavior for all users.`,
          rationale: "Admin control plane — necessary for enterprise adoption.",
        },
        {
          story: `As an **administrator**, I want to audit usage logs so that I can ensure compliance and troubleshoot issues.`,
          rationale: "Observability — required for regulated environments.",
        },
      ],
      "system": [
        {
          story: `As a **system**, I need to process requests within 200ms at p99 so that the user experience remains responsive.`,
          rationale: "Performance NFR.",
        },
        {
          story: `As a **system**, I need to handle errors gracefully and log them for observability so that failures are detectable and debuggable.`,
          rationale: "Reliability NFR.",
        },
      ],
    };

    for (const persona of personas) {
      const stories = storyTemplates[persona.toLowerCase()] ?? [
        {
          story: `As a **${persona}**, I want to interact with ${feature_idea} so that I can fulfill my responsibilities.`,
          rationale: `Core story for ${persona} persona.`,
        },
      ];

      sections.push(`\n### Persona: ${persona.charAt(0).toUpperCase() + persona.slice(1)}`);
      for (let i = 0; i < stories.length; i++) {
        sections.push(`\n**US-${persona.slice(0, 3).toUpperCase()}-${i + 1}**: ${stories[i].story}`);
        sections.push(`- *Rationale*: ${stories[i].rationale}`);
        sections.push(`- *Priority*: ${i === 0 ? "P0 — Must Have" : i === 1 ? "P1 — Should Have" : "P2 — Nice to Have"}`);
        sections.push(`- *Estimation*: TBD (requires technical refinement)`);
      }
    }

    // Workflows
    sections.push("\n## Core Workflows");
    sections.push("### Happy Path");
    sections.push(
      `1. User navigates to the relevant area of the application.\n` +
      `2. User initiates the "${feature_idea}" action.\n` +
      `3. System validates the request and processes it.\n` +
      `4. System returns a success response with relevant data.\n` +
      `5. User receives confirmation and can proceed.`,
    );

    sections.push("\n### Error Path");
    sections.push(
      `1. User submits invalid or incomplete data.\n` +
      `2. System detects the validation failure.\n` +
      `3. System returns a descriptive error message.\n` +
      `4. User corrects the input and resubmits.`,
    );

    // Non-functional requirements
    sections.push("\n## Non-Functional Requirements");
    sections.push("| Category | Requirement |");
    sections.push("|----------|-------------|");
    sections.push("| Performance | Response time < 200ms at p95; < 500ms at p99 |");
    sections.push("| Availability | 99.9% uptime (< 8.7 hours downtime/year) |");
    sections.push("| Security | Authentication required; inputs sanitized; outputs escaped |");
    sections.push("| Accessibility | WCAG 2.1 AA compliance for any UI components |");
    sections.push("| Scalability | Must handle 10x current load without architectural changes |");
    sections.push("| Data retention | Logs retained for 90 days; user data per privacy policy |");
    if (constraints) {
      sections.push(`| Constraints | ${constraints} |`);
    }

    // Open questions
    sections.push("\n## Open Questions");
    sections.push("1. What is the expected concurrency level for this feature?");
    sections.push("2. Are there data locality or sovereignty requirements?");
    sections.push("3. What existing systems does this need to integrate with?");
    sections.push("4. What is the rollout strategy — feature flag, phased, or full release?");
    sections.push("5. Who owns the feature long-term?");

    // Definition of Done
    sections.push("\n## Definition of Done");
    sections.push("- [ ] All user stories implemented and passing acceptance tests");
    sections.push("- [ ] Unit test coverage >= 80%");
    sections.push("- [ ] Performance benchmarks meet NFR targets");
    sections.push("- [ ] Security review completed");
    sections.push("- [ ] Accessibility audit passed");
    sections.push("- [ ] Documentation updated");
    sections.push("- [ ] Product owner sign-off obtained");

    return textResult(sections.join("\n"));
  },
};

// ── ux_review ─────────────────────────────────────────────────────────────────

export const uxReviewTool: PiTool = {
  name: "ux_review",
  label: "UX Review",
  description:
    "Reads a UI file (HTML, JSX, TSX, or CSS) and reviews it for accessibility, usability, and UX best practice issues.",
  parameters: Type.Object({
    file: Type.String({
      description: "Path to the UI file to review.",
    }),
    focus: Type.Optional(
      Type.Union(
        [
          Type.Literal("accessibility"),
          Type.Literal("usability"),
          Type.Literal("performance"),
          Type.Literal("all"),
        ],
        { description: "Review focus. Default: all." },
      ),
    ),
  }),

  async execute(_id, input) {
    const { file, focus = "all" } = input as {
      file: string;
      focus?: "accessibility" | "usability" | "performance" | "all";
    };

    const source = await readFileSafe(file);
    if (source.startsWith("[could not read")) {
      return textResult(`Error: ${source}`);
    }

    const lines = source.split("\n");
    const sections: string[] = [];
    sections.push(`# UX Review: \`${file}\``);
    sections.push(`Focus: **${focus}**  |  Lines: ${lines.length}\n`);

    const isJsx = file.endsWith(".jsx") || file.endsWith(".tsx");
    const isHtml = file.endsWith(".html") || file.endsWith(".htm");
    const isCss = file.endsWith(".css") || file.endsWith(".scss") || file.endsWith(".sass") || file.endsWith(".less");

    type Issue = { severity: "critical" | "high" | "medium" | "low"; line?: number; message: string; fix: string };
    const issues: Issue[] = [];
    const passed: string[] = [];

    // Accessibility checks
    if (focus === "accessibility" || focus === "all") {
      // Images without alt text
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/<img\b/i.test(l) && !/alt\s*=/i.test(l)) {
          issues.push({
            severity: "critical",
            line: i + 1,
            message: `<img> missing \`alt\` attribute`,
            fix: 'Add `alt="descriptive text"` (or `alt=""` if decorative).',
          });
        }
        if (isJsx && /\bimg\b/.test(l) && !/\balt\b/.test(l)) {
          issues.push({
            severity: "critical",
            line: i + 1,
            message: `JSX <img> missing \`alt\` prop`,
            fix: 'Add `alt="description"` prop.',
          });
        }
      }

      // Form inputs without labels
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/<input\b/i.test(l) && !/(?:aria-label|aria-labelledby|id\s*=)/i.test(l)) {
          issues.push({
            severity: "high",
            line: i + 1,
            message: `<input> without associated label or aria-label`,
            fix: "Add `aria-label`, `aria-labelledby`, or a `<label for>` element.",
          });
        }
      }

      // Buttons without accessible names
      const emptyBtns = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /<button\b[^>]*>\s*<\/button>/i.test(l) || /<button\b[^>]*>\s*<img/i.test(l));
      for (const { i } of emptyBtns) {
        issues.push({
          severity: "high",
          line: i + 1,
          message: "Button with no text content — screen readers cannot identify it",
          fix: "Add text content or `aria-label` to the button.",
        });
      }

      // Color contrast hint (can't compute exactly without CSS, flag usage of inline color)
      const lowContrastHints = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /color:\s*#(?:ccc|ddd|eee|aaa|bbb|999|888|777)['";\s]/i.test(l));
      for (const { l, i } of lowContrastHints) {
        issues.push({
          severity: "medium",
          line: i + 1,
          message: `Potentially low-contrast color: \`${l.trim().slice(0, 60)}\``,
          fix: "Verify contrast ratio meets WCAG AA (4.5:1 for normal text, 3:1 for large text).",
        });
      }

      // tabIndex issues
      const tabIndexPositive = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /tabIndex\s*[=:]\s*[1-9]/i.test(l));
      for (const { i } of tabIndexPositive) {
        issues.push({
          severity: "medium",
          line: i + 1,
          message: "Positive `tabIndex` value — disrupts natural focus order",
          fix: "Use `tabIndex={0}` or `-1` only; rely on DOM order for focus.",
        });
      }

      // ARIA role checks
      if (lines.some((l) => /role\s*=\s*['"]?presentation['"]?/i.test(l))) {
        passed.push("Uses `role=presentation` appropriately for decorative elements.");
      }

      // landmark regions
      const hasMain = lines.some((l) => /<main\b|role\s*=\s*['"]?main['"]?/i.test(l));
      const hasNav = lines.some((l) => /<nav\b|role\s*=\s*['"]?navigation['"]?/i.test(l));
      if (isHtml) {
        if (hasMain) passed.push("Main landmark (`<main>`) present.");
        else issues.push({ severity: "medium", message: "No `<main>` landmark region", fix: "Wrap primary content in `<main>`." });
        if (hasNav) passed.push("Navigation landmark (`<nav>`) present.");
      }

      // lang attribute
      if (isHtml && !lines.some((l) => /lang\s*=/i.test(l))) {
        issues.push({
          severity: "high",
          message: "HTML document missing `lang` attribute on `<html>`",
          fix: 'Add `lang="en"` (or appropriate locale) to `<html>`.',
        });
      } else if (isHtml) {
        passed.push("`lang` attribute present on `<html>`.");
      }
    }

    // Usability checks
    if (focus === "usability" || focus === "all") {
      // Touch target size hints
      const tinyTargets = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /(?:width|height)\s*:\s*(?:[0-9]|1[0-9]|2[0-3])px/i.test(l));
      for (const { l, i } of tinyTargets.slice(0, 3)) {
        issues.push({
          severity: "medium",
          line: i + 1,
          message: `Potentially small touch target: \`${l.trim().slice(0, 60)}\``,
          fix: "Ensure interactive elements are at least 44x44px (WCAG 2.5.5).",
        });
      }

      // Loading states — check for loading indicators
      const hasLoadingState = lines.some((l) => /loading|spinner|skeleton|placeholder/i.test(l));
      if (hasLoadingState) {
        passed.push("Loading/skeleton states detected — good for perceived performance.");
      } else if (isJsx || isHtml) {
        issues.push({
          severity: "low",
          message: "No loading indicators detected",
          fix: "Add loading states for async operations to provide user feedback.",
        });
      }

      // Error states
      const hasErrorState = lines.some((l) => /error|invalid|fail/i.test(l));
      if (hasErrorState) passed.push("Error states present.");

      // Placeholder-only labels (anti-pattern)
      const placeholderOnly = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /placeholder\s*[=:]/i.test(l) && !/aria-label|<label/i.test(l));
      for (const { i } of placeholderOnly.slice(0, 3)) {
        issues.push({
          severity: "medium",
          line: i + 1,
          message: "Input uses placeholder as sole label — disappears on focus",
          fix: "Add a visible `<label>` or `aria-label` in addition to placeholder.",
        });
      }
    }

    // Performance checks
    if (focus === "performance" || focus === "all") {
      if (isCss) {
        // Large CSS files
        if (lines.length > 1000) {
          issues.push({
            severity: "medium",
            message: `Large CSS file (${lines.length} lines)`,
            fix: "Consider splitting into modules, removing dead CSS, or using CSS-in-JS tree-shaking.",
          });
        }

        // !important usage
        const importantCount = lines.filter((l) => /!important/.test(l)).length;
        if (importantCount > 5) {
          issues.push({
            severity: "medium",
            message: `${importantCount} uses of \`!important\` — indicates specificity issues`,
            fix: "Refactor specificity rather than using `!important`.",
          });
        }
      }

      // Inline styles (JSX/HTML) — not bad per se, but flag large quantities
      const inlineStyles = lines.filter((l) => /style\s*=\s*\{?\{/.test(l)).length;
      if (inlineStyles > 10) {
        issues.push({
          severity: "low",
          message: `${inlineStyles} inline styles detected — can impact render performance`,
          fix: "Move styles to CSS classes or styled components for better caching.",
        });
      }

      // Large images without width/height (layout shift)
      const unscaledImages = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /<img\b/i.test(l) && !/(?:width|height)\s*=/i.test(l));
      for (const { i } of unscaledImages.slice(0, 3)) {
        issues.push({
          severity: "medium",
          line: i + 1,
          message: "<img> without explicit width/height — causes cumulative layout shift (CLS)",
          fix: "Add `width` and `height` attributes to all images.",
        });
      }
    }

    // Summary
    const bySeverity = {
      critical: issues.filter((i) => i.severity === "critical"),
      high: issues.filter((i) => i.severity === "high"),
      medium: issues.filter((i) => i.severity === "medium"),
      low: issues.filter((i) => i.severity === "low"),
    };

    sections.push("## Summary");
    sections.push(`| Severity | Count |`);
    sections.push(`|----------|-------|`);
    sections.push(`| Critical | ${bySeverity.critical.length} |`);
    sections.push(`| High | ${bySeverity.high.length} |`);
    sections.push(`| Medium | ${bySeverity.medium.length} |`);
    sections.push(`| Low | ${bySeverity.low.length} |`);
    sections.push(`| **Total issues** | **${issues.length}** |`);
    sections.push(`| Passed checks | ${passed.length} |`);
    sections.push("");

    if (passed.length > 0) {
      sections.push("## What's Good");
      sections.push(passed.map((p) => `- ${p}`).join("\n"));
    }

    const order: Array<Issue["severity"]> = ["critical", "high", "medium", "low"];
    for (const sev of order) {
      if (bySeverity[sev].length === 0) continue;
      sections.push(`\n## ${sev.charAt(0).toUpperCase() + sev.slice(1)} Issues`);
      for (const issue of bySeverity[sev]) {
        sections.push(`\n- ${issue.line ? `**Line ${issue.line}**: ` : ""}${issue.message}`);
        sections.push(`  **Fix**: ${issue.fix}`);
      }
    }

    if (issues.length === 0) {
      sections.push("**No UX/accessibility issues detected.** Manual review is still recommended.");
    }

    sections.push("\n## Resources");
    sections.push("- [WCAG 2.1 Guidelines](https://www.w3.org/TR/WCAG21/)");
    sections.push("- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)");
    sections.push("- [axe DevTools](https://www.deque.com/axe/)");

    return textResult(sections.join("\n"));
  },
};

// ── acceptance_criteria ───────────────────────────────────────────────────────

export const acceptanceCriteriaTool: PiTool = {
  name: "acceptance_criteria",
  label: "Acceptance Criteria",
  description:
    "Takes a user story and produces testable, unambiguous acceptance criteria in structured format.",
  parameters: Type.Object({
    user_story: Type.String({
      description: "The user story (e.g. 'As a user, I want to reset my password...').",
    }),
    context: Type.Optional(
      Type.String({ description: "Additional context about the system or domain." }),
    ),
  }),

  async execute(_id, input) {
    const { user_story, context } = input as {
      user_story: string;
      context?: string;
    };

    const sections: string[] = [];
    sections.push(`# Acceptance Criteria`);
    sections.push(`\n**User Story**: ${user_story}`);
    if (context) sections.push(`**Context**: ${context}`);
    sections.push("");

    // Parse story parts
    const asMatch = user_story.match(/as\s+(?:an?\s+)?(.+?),?\s+I\s+want\s+to\s+(.+?),?\s+so\s+that\s+(.+)/i);
    const persona = asMatch?.[1] ?? "user";
    const action = asMatch?.[2] ?? "perform the action";
    const benefit = asMatch?.[3] ?? "achieve the desired outcome";

    sections.push(`**Parsed**:`);
    sections.push(`- Actor: ${persona}`);
    sections.push(`- Action: ${action}`);
    sections.push(`- Benefit: ${benefit}`);
    sections.push("");

    // Generate acceptance criteria
    sections.push("## Acceptance Criteria (Given/When/Then)");

    const criteria: Array<{
      id: string;
      title: string;
      given: string[];
      when: string[];
      then: string[];
      category: string;
    }> = [
      {
        id: "AC-01",
        title: "Happy path — successful execution",
        category: "Functional",
        given: [
          `the ${persona} is authenticated with appropriate permissions`,
          `the system is in a valid state`,
          `all required data is present`,
        ],
        when: [`the ${persona} ${action} with valid inputs`],
        then: [
          `the system successfully ${action}`,
          `the ${persona} receives a success confirmation`,
          `the intended benefit is achieved: "${benefit}"`,
          `no unintended side effects occur`,
        ],
      },
      {
        id: "AC-02",
        title: "Input validation",
        category: "Functional",
        given: [`the ${persona} is on the relevant page/endpoint`],
        when: [`the ${persona} submits ${action} with invalid or missing inputs`],
        then: [
          `the system rejects the request with a clear validation error`,
          `the error message specifies which fields are invalid and why`,
          `no partial state changes are persisted`,
        ],
      },
      {
        id: "AC-03",
        title: "Unauthorized access",
        category: "Security",
        given: [`a user without sufficient permissions or not authenticated`],
        when: [`the user attempts to ${action}`],
        then: [
          `the system returns an authentication/authorization error (401/403)`,
          `no sensitive data is returned`,
          `the attempt is logged for audit`,
        ],
      },
      {
        id: "AC-04",
        title: "Error recovery",
        category: "Resilience",
        given: [`the ${persona} has initiated ${action}`, `the system encounters an unexpected error`],
        when: [`the error occurs during processing`],
        then: [
          `the ${persona} sees a helpful error message (not a raw stack trace)`,
          `the system state is not left in a corrupt/partial state (atomicity)`,
          `the error is logged with sufficient detail for debugging`,
          `the ${persona} can retry the action`,
        ],
      },
      {
        id: "AC-05",
        title: "Idempotency",
        category: "Reliability",
        given: [`the ${persona} has already successfully ${action}`],
        when: [`the ${persona} attempts to ${action} again with the same inputs`],
        then: [
          `the system handles the duplicate gracefully (idempotent response or clear duplicate error)`,
          `no duplicate records or side-effects are created`,
        ],
      },
      {
        id: "AC-06",
        title: "Performance",
        category: "Non-functional",
        given: [`the system is under normal production load`],
        when: [`the ${persona} ${action}`],
        then: [
          `the response is returned within 200ms at p95`,
          `the response is returned within 500ms at p99`,
          `no timeouts occur under normal conditions`,
        ],
      },
    ];

    for (const ac of criteria) {
      sections.push(`\n### ${ac.id}: ${ac.title} [${ac.category}]`);
      sections.push("```gherkin");
      sections.push(`Given ${ac.given[0]}`);
      for (const g of ac.given.slice(1)) sections.push(`And ${g}`);
      sections.push(`When ${ac.when[0]}`);
      for (const w of ac.when.slice(1)) sections.push(`And ${w}`);
      sections.push(`Then ${ac.then[0]}`);
      for (const t of ac.then.slice(1)) sections.push(`And ${t}`);
      sections.push("```");
    }

    // Out of scope
    sections.push("\n## Out of Scope (Explicit Exclusions)");
    sections.push("Document items that are explicitly NOT part of this story to prevent scope creep:");
    sections.push("- [ ] Performance optimizations beyond p95 < 200ms target");
    sections.push("- [ ] Offline/cached operation");
    sections.push("- [ ] Bulk operations (separate story)");
    sections.push("- [ ] Admin overrides (separate story)");

    // Test notes
    sections.push("\n## Testing Notes");
    sections.push("- AC-01 to AC-02: Covered by unit + integration tests");
    sections.push("- AC-03: Covered by security integration tests");
    sections.push("- AC-04 to AC-05: Covered by integration tests with fault injection");
    sections.push("- AC-06: Covered by performance/load tests");

    return textResult(sections.join("\n"));
  },
};

// ── feedback_analyze ──────────────────────────────────────────────────────

export const feedbackAnalyzeTool: PiTool = {
  name: "feedback_analyze",
  label: "Feedback Analyze",
  description:
    "Analyze text feedback for sentiment (positive/negative/neutral/mixed), extract themes and topics, and return a structured analysis.",
  parameters: Type.Object({
    feedback: Type.Array(Type.String(), {
      description: "Array of feedback text entries to analyze.",
      minItems: 1,
    }),
    context: Type.Optional(
      Type.String({
        description: "Product or feature context to focus the analysis.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { feedback, context } = input as {
      feedback: string[];
      context?: string;
    };

    const sections: string[] = [];
    sections.push("# Feedback Analysis");
    if (context) sections.push(`**Context**: ${context}`);
    sections.push(`**Entries analyzed**: ${feedback.length}\n`);

    // Sentiment word lists
    const positiveWords = new Set([
      "great", "excellent", "amazing", "love", "good", "awesome", "fantastic",
      "helpful", "easy", "fast", "smooth", "perfect", "wonderful", "intuitive",
      "clean", "solid", "impressed", "reliable", "efficient", "nice", "useful",
      "powerful", "seamless", "simple", "clear", "works",
    ]);
    const negativeWords = new Set([
      "bad", "terrible", "awful", "hate", "slow", "broken", "confusing",
      "difficult", "hard", "frustrating", "annoying", "ugly", "crash",
      "error", "bug", "fail", "worse", "horrible", "painful", "complicated",
      "missing", "lacks", "poor", "unusable", "clunky", "laggy", "unstable",
      "disappointing", "useless", "bloated", "inconsistent",
    ]);

    type FeedbackResult = {
      text: string;
      sentiment: "positive" | "negative" | "neutral" | "mixed";
      score: number;
      themes: string[];
    };

    const results: FeedbackResult[] = [];
    const allThemes: Record<string, number> = {};

    for (const text of feedback) {
      const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
      let posCount = 0;
      let negCount = 0;

      for (const w of words) {
        if (positiveWords.has(w)) posCount++;
        if (negativeWords.has(w)) negCount++;
      }

      const total = posCount + negCount;
      let sentiment: FeedbackResult["sentiment"] = "neutral";
      let score = 0;

      if (total > 0) {
        score = (posCount - negCount) / total;
        if (posCount > 0 && negCount > 0 && Math.abs(score) < 0.3) {
          sentiment = "mixed";
        } else if (score > 0) {
          sentiment = "positive";
        } else if (score < 0) {
          sentiment = "negative";
        }
      }

      // Theme extraction
      const themes: string[] = [];
      const themePatterns: Array<{ pattern: RegExp; theme: string }> = [
        { pattern: /\b(?:ui|ux|design|layout|interface|visual)\b/i, theme: "UI/UX" },
        { pattern: /\b(?:performance|speed|fast|slow|lag|latency)\b/i, theme: "Performance" },
        { pattern: /\b(?:bug|error|crash|broken|fix)\b/i, theme: "Bugs" },
        { pattern: /\b(?:feature|request|wish|need|want|add)\b/i, theme: "Feature Requests" },
        { pattern: /\b(?:doc|documentation|guide|tutorial|help)\b/i, theme: "Documentation" },
        { pattern: /\b(?:price|pricing|cost|expensive|cheap|free)\b/i, theme: "Pricing" },
        { pattern: /\b(?:support|customer|service|response)\b/i, theme: "Support" },
        { pattern: /\b(?:security|auth|login|password)\b/i, theme: "Security" },
        { pattern: /\b(?:mobile|app|phone|tablet|responsive)\b/i, theme: "Mobile" },
        { pattern: /\b(?:api|integration|webhook|plugin|sdk)\b/i, theme: "API/Integration" },
      ];

      for (const tp of themePatterns) {
        if (tp.pattern.test(text)) {
          themes.push(tp.theme);
          allThemes[tp.theme] = (allThemes[tp.theme] ?? 0) + 1;
        }
      }

      results.push({ text: text.slice(0, 200), sentiment, score: Math.round(score * 100) / 100, themes });
    }

    // Aggregate sentiment
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    for (const r of results) sentimentCounts[r.sentiment]++;

    const avgScore = results.length > 0
      ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 100) / 100
      : 0;

    sections.push("## Sentiment Overview");
    sections.push(`| Sentiment | Count | % |`);
    sections.push(`|-----------|-------|---|`);
    for (const [s, count] of Object.entries(sentimentCounts)) {
      if (count > 0) {
        sections.push(`| ${s} | ${count} | ${Math.round((count / results.length) * 100)}% |`);
      }
    }
    sections.push(`\n**Average Score**: ${avgScore} (range: -1.0 to 1.0)\n`);

    // Theme summary
    const sortedThemes = Object.entries(allThemes).sort((a, b) => b[1] - a[1]);
    if (sortedThemes.length > 0) {
      sections.push("## Top Themes");
      for (const [theme, count] of sortedThemes) {
        const pct = Math.round((count / feedback.length) * 100);
        sections.push(`- **${theme}**: ${count} mention(s) (${pct}%)`);
      }
    }

    // Individual results (cap at 20)
    sections.push("\n## Entry-Level Analysis");
    for (let i = 0; i < results.length && i < 20; i++) {
      const r = results[i];
      const themeStr = r.themes.length > 0 ? ` [${r.themes.join(", ")}]` : "";
      sections.push(`${i + 1}. **${r.sentiment}** (${r.score})${themeStr}: "${r.text}${feedback[i].length > 200 ? "..." : ""}"`);
    }
    if (results.length > 20) {
      sections.push(`\n_...and ${results.length - 20} more entries._`);
    }

    return textResult(sections.join("\n"));
  },
};
