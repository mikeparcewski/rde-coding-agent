/**
 * Tests for v04 delivery and product domain tools.
 *
 * Covers: rollout_plan, cost_analyze (delivery)
 *         onboard_guide, a11y_audit, competitive_analyze (product)
 */

import { describe, it, expect, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { rolloutPlanTool, costAnalyzeTool } from "../src/domains/delivery/tools.js";
import { onboardGuideTool, a11yAuditTool, competitiveAnalyzeTool } from "../src/domains/product/tools.js";

const signal = new AbortController().signal;

function cleanupDir(dir: string) {
  try {
    execSync(`rm -rf "${dir}"`, { stdio: "pipe" });
  } catch {
    // ignore cleanup errors
  }
}

// ── rollout_plan ──────────────────────────────────────────────────────────────

describe("rollout_plan", () => {
  it("has correct name, label, description, and parameters", () => {
    expect(rolloutPlanTool.name).toBe("rollout_plan");
    expect(typeof rolloutPlanTool.label).toBe("string");
    expect(rolloutPlanTool.label.length).toBeGreaterThan(0);
    expect(typeof rolloutPlanTool.description).toBe("string");
    expect(rolloutPlanTool.description.length).toBeGreaterThan(0);
    expect(typeof rolloutPlanTool.execute).toBe("function");
    // Verify parameter schema has 'feature' and 'risk_level'
    const props = (rolloutPlanTool.parameters as any).properties;
    expect(props).toHaveProperty("feature");
    expect(props).toHaveProperty("risk_level");
  });

  it("returns canary strategy with small percentage stages when risk_level is high", async () => {
    const result = await rolloutPlanTool.execute(
      "t-rollout-1",
      { feature: "new billing system", risk_level: "high" },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("feature");
    expect(parsed.feature).toBe("new billing system");
    expect(parsed).toHaveProperty("riskLevel");
    expect(parsed.riskLevel).toBe("high");
    expect(parsed).toHaveProperty("strategy");
    expect(parsed.strategy).toHaveProperty("type");
    // High risk should use canary deployment
    expect(parsed.strategy.type.toLowerCase()).toContain("canary");
    expect(parsed.strategy).toHaveProperty("stages");
    expect(Array.isArray(parsed.strategy.stages)).toBe(true);
    // First stage should start at a small percentage (1% or 5%)
    const firstStage = parsed.strategy.stages[0];
    expect(firstStage).toHaveProperty("percentage");
    expect(firstStage.percentage).toBeLessThanOrEqual(5);
    // Should have monitoring and rollback info
    expect(parsed).toHaveProperty("monitoring");
    expect(parsed).toHaveProperty("rollbackTriggers");
  });

  it("auto-detects high risk for database migration feature", async () => {
    const result = await rolloutPlanTool.execute(
      "t-rollout-2",
      { feature: "database migration" },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("riskLevel");
    expect(parsed.riskLevel).toBe("high");
    expect(parsed).toHaveProperty("riskAssessment");
    expect(parsed.riskAssessment).toHaveProperty("reason");
    // Reason should mention the database keyword
    expect(parsed.riskAssessment.reason.toLowerCase()).toContain("database");
    // Strategy should be canary for high risk auto-detected
    expect(parsed.strategy.type.toLowerCase()).toContain("canary");
  });

  it("returns low risk big-bang strategy for a refactor feature", async () => {
    const result = await rolloutPlanTool.execute(
      "t-rollout-3",
      { feature: "refactor logging module" },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.riskLevel).toBe("low");
    expect(parsed.strategy.stages.length).toBe(1);
    expect(parsed.strategy.stages[0].percentage).toBe(100);
  });
});

// ── cost_analyze ──────────────────────────────────────────────────────────────

describe("cost_analyze", () => {
  it("has correct name, label, description, and parameters", () => {
    expect(costAnalyzeTool.name).toBe("cost_analyze");
    expect(typeof costAnalyzeTool.label).toBe("string");
    expect(costAnalyzeTool.label.length).toBeGreaterThan(0);
    expect(typeof costAnalyzeTool.description).toBe("string");
    expect(costAnalyzeTool.description.length).toBeGreaterThan(0);
    expect(typeof costAnalyzeTool.execute).toBe("function");
    const props = (costAnalyzeTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
  });

  it("returns cost estimate for a terraform file with aws_instance", async () => {
    const tmpBase = join(tmpdir(), `cost-analyze-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      await writeFile(
        join(tmpBase, "main.tf"),
        `resource "aws_instance" "web" {\n  instance_type = "t3.medium"\n  ami           = "ami-12345"\n}\n`,
      );

      const result = await costAnalyzeTool.execute(
        "t-cost-1",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("resources");
      expect(parsed).toHaveProperty("totalEstimatedMonthlyCost");
      expect(parsed).toHaveProperty("byCategory");
      expect(parsed).toHaveProperty("optimizationRecommendations");
      expect(parsed).toHaveProperty("iacFilesAnalyzed");

      // Should have found the aws_instance resource
      const ec2Resource = parsed.resources.find(
        (r: any) => r.type === "aws_instance" && r.name === "web",
      );
      expect(ec2Resource).toBeDefined();
      expect(ec2Resource.specs.instance_type).toBe("t3.medium");
      // t3.medium costs $30/month in the pricing table
      expect(ec2Resource.estimatedMonthlyCost).toBeGreaterThan(0);
      expect(parsed.totalEstimatedMonthlyCost).toBeGreaterThan(0);
      expect(parsed.byCategory.compute).toBeGreaterThan(0);
    } finally {
      cleanupDir(tmpBase);
    }
  });

  it("returns empty resources with recommendation for directory with no IaC files", async () => {
    const tmpBase = join(tmpdir(), `cost-analyze-empty-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      // Write a non-IaC file
      await writeFile(join(tmpBase, "README.md"), "# My Project\n");

      const result = await costAnalyzeTool.execute(
        "t-cost-2",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.resources).toEqual([]);
      expect(parsed.totalEstimatedMonthlyCost).toBe(0);
      expect(Array.isArray(parsed.optimizationRecommendations)).toBe(true);
      // Should recommend that no IaC files were found
      const hasNoIacMessage = parsed.optimizationRecommendations.some(
        (r: string) => r.toLowerCase().includes("no iac") || r.toLowerCase().includes("no parseable"),
      );
      expect(hasNoIacMessage).toBe(true);
    } finally {
      cleanupDir(tmpBase);
    }
  });
});

// ── onboard_guide ─────────────────────────────────────────────────────────────

describe("onboard_guide", () => {
  it("has correct name, label, description, and parameters", () => {
    expect(onboardGuideTool.name).toBe("onboard_guide");
    expect(typeof onboardGuideTool.label).toBe("string");
    expect(onboardGuideTool.label.length).toBeGreaterThan(0);
    expect(typeof onboardGuideTool.description).toBe("string");
    expect(onboardGuideTool.description.length).toBeGreaterThan(0);
    expect(typeof onboardGuideTool.execute).toBe("function");
    const props = (onboardGuideTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
  });

  it("returns project overview and tech stack for a Node.js project", async () => {
    const tmpBase = join(tmpdir(), `onboard-guide-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      await writeFile(
        join(tmpBase, "package.json"),
        JSON.stringify({ name: "test-project", scripts: { test: "vitest" } }),
      );
      await writeFile(
        join(tmpBase, "README.md"),
        "# Test Project\n\nA sample project for testing.\n",
      );

      const result = await onboardGuideTool.execute(
        "t-onboard-1",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("projectName");
      expect(parsed.projectName).toBe("test-project");
      expect(parsed).toHaveProperty("techStack");
      expect(Array.isArray(parsed.techStack)).toBe(true);
      // Should detect Node.js from package.json
      expect(parsed.techStack).toContain("Node.js");
      expect(parsed).toHaveProperty("scripts");
      expect(parsed.scripts).toHaveProperty("test");
      expect(parsed).toHaveProperty("gettingStarted");
    } finally {
      cleanupDir(tmpBase);
    }
  });

  it("returns directory structure and key files when present", async () => {
    const tmpBase = join(tmpdir(), `onboard-guide-2-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });
    await mkdir(join(tmpBase, "src"), { recursive: true });

    try {
      await writeFile(
        join(tmpBase, "package.json"),
        JSON.stringify({ name: "my-app", description: "My application", scripts: { start: "node dist/index.js", test: "jest" } }),
      );
      await writeFile(join(tmpBase, "README.md"), "# My App\n\nWelcome.\n");
      await writeFile(join(tmpBase, "src", "index.ts"), "export {};\n");
      await writeFile(join(tmpBase, "tsconfig.json"), "{}");

      const result = await onboardGuideTool.execute(
        "t-onboard-2",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("directoryStructure");
      expect(typeof parsed.directoryStructure).toBe("object");
      // src should appear as a known directory
      expect(parsed.directoryStructure).toHaveProperty("src");
      expect(parsed).toHaveProperty("keyFiles");
      expect(Array.isArray(parsed.keyFiles)).toBe(true);
      // README.md and package.json should be in keyFiles
      const keyFilePaths = parsed.keyFiles.map((f: any) => f.path);
      expect(keyFilePaths).toContain("README.md");
      expect(keyFilePaths).toContain("package.json");
      // Tech stack should include TypeScript (tsconfig.json present)
      expect(parsed.techStack).toContain("TypeScript");
    } finally {
      cleanupDir(tmpBase);
    }
  });
});

// ── a11y_audit ────────────────────────────────────────────────────────────────

describe("a11y_audit", () => {
  it("has correct name, label, description, and parameters", () => {
    expect(a11yAuditTool.name).toBe("a11y_audit");
    expect(typeof a11yAuditTool.label).toBe("string");
    expect(a11yAuditTool.label.length).toBeGreaterThan(0);
    expect(typeof a11yAuditTool.description).toBe("string");
    expect(a11yAuditTool.description.length).toBeGreaterThan(0);
    expect(typeof a11yAuditTool.execute).toBe("function");
    const props = (a11yAuditTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
  });

  it("detects missing alt attribute on img elements in a tsx file", async () => {
    const tmpBase = join(tmpdir(), `a11y-audit-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      await writeFile(
        join(tmpBase, "component.tsx"),
        `import React from "react";\nexport function MyComponent() {\n  return <img src="test.png" />;\n}\n`,
      );

      const result = await a11yAuditTool.execute(
        "t-a11y-1",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("issues");
      expect(Array.isArray(parsed.issues)).toBe(true);
      expect(parsed).toHaveProperty("complianceScore");
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("filesAudited");

      // Should detect missing alt text issue
      const altIssue = parsed.issues.find(
        (i: any) => i.criterion === "1.1.1" || (i.description && i.description.toLowerCase().includes("alt")),
      );
      expect(altIssue).toBeDefined();
      expect(altIssue.recommendation).toBeTruthy();
    } finally {
      cleanupDir(tmpBase);
    }
  });

  it("returns score of 100 and no issues for a file with proper alt text", async () => {
    const tmpBase = join(tmpdir(), `a11y-audit-pass-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      await writeFile(
        join(tmpBase, "accessible.tsx"),
        `import React from "react";\nexport function Good() {\n  return <img src="logo.png" alt="Company logo" />;\n}\n`,
      );

      const result = await a11yAuditTool.execute(
        "t-a11y-2",
        { path: tmpBase },
        signal,
        vi.fn(),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("complianceScore");
      expect(parsed).toHaveProperty("issues");
      // No alt missing issues for this file
      const altIssues = parsed.issues.filter(
        (i: any) => i.criterion === "1.1.1",
      );
      expect(altIssues.length).toBe(0);
    } finally {
      cleanupDir(tmpBase);
    }
  });
});

// ── competitive_analyze ───────────────────────────────────────────────────────

describe("competitive_analyze", () => {
  it("has correct name, label, description, and parameters", () => {
    expect(competitiveAnalyzeTool.name).toBe("competitive_analyze");
    expect(typeof competitiveAnalyzeTool.label).toBe("string");
    expect(competitiveAnalyzeTool.label.length).toBeGreaterThan(0);
    expect(typeof competitiveAnalyzeTool.description).toBe("string");
    expect(competitiveAnalyzeTool.description.length).toBeGreaterThan(0);
    expect(typeof competitiveAnalyzeTool.execute).toBe("function");
    const props = (competitiveAnalyzeTool.parameters as any).properties;
    expect(props).toHaveProperty("product");
    expect(props).toHaveProperty("competitors");
  });

  it("returns SWOT structure and competitor profiles for provided product and competitors", async () => {
    const result = await competitiveAnalyzeTool.execute(
      "t-competitive-1",
      { product: "Our App", competitors: ["Competitor A", "Competitor B"] },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("product");
    expect(parsed.product).toBe("Our App");
    expect(parsed).toHaveProperty("competitors");
    expect(parsed.competitors).toEqual(["Competitor A", "Competitor B"]);

    // SWOT should be present with the four quadrants
    expect(parsed).toHaveProperty("swot");
    expect(parsed.swot).toHaveProperty("strengths");
    expect(parsed.swot).toHaveProperty("weaknesses");
    expect(parsed.swot).toHaveProperty("opportunities");
    expect(parsed.swot).toHaveProperty("threats");

    // Each quadrant should have guiding questions
    expect(Array.isArray(parsed.swot.strengths.questions)).toBe(true);
    expect(parsed.swot.strengths.questions.length).toBeGreaterThan(0);

    // Competitor profiles should be returned for each competitor
    expect(parsed).toHaveProperty("competitorProfiles");
    expect(Array.isArray(parsed.competitorProfiles)).toBe(true);
    expect(parsed.competitorProfiles.length).toBe(2);
    const profileNames = parsed.competitorProfiles.map((p: any) => p.name);
    expect(profileNames).toContain("Competitor A");
    expect(profileNames).toContain("Competitor B");
  });

  it("includes comparison dimensions and positioning questions", async () => {
    const result = await competitiveAnalyzeTool.execute(
      "t-competitive-2",
      { product: "Our App", competitors: ["Rival X"] },
      signal,
      vi.fn(),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("comparisonDimensions");
    expect(Array.isArray(parsed.comparisonDimensions)).toBe(true);
    expect(parsed.comparisonDimensions.length).toBeGreaterThan(0);

    // Each dimension should have dimension name and evaluationCriteria
    const firstDim = parsed.comparisonDimensions[0];
    expect(firstDim).toHaveProperty("dimension");
    expect(firstDim).toHaveProperty("evaluationCriteria");

    expect(parsed).toHaveProperty("positioningQuestions");
    expect(Array.isArray(parsed.positioningQuestions)).toBe(true);
    expect(parsed.positioningQuestions.length).toBeGreaterThan(0);

    // The first positioning question should reference our product
    const firstQ = parsed.positioningQuestions[0];
    expect(typeof firstQ).toBe("string");
    expect(firstQ).toContain("Our App");
  });
});
