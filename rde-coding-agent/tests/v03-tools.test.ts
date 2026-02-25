/**
 * Tests for v03 tool enhancements and new tools.
 *
 * AC-3: code_review focus parameter
 * AC-4: security_scan PII detection
 * AC-5: incident_triage structured output
 * AC-6: ci_generate valid workflow
 * Plus: recall stats, feedback_analyze, data_lineage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const signal = new AbortController().signal;

// Helper to clean up temp dirs (avoids importing rm which can conflict with mocks)
function cleanupDir(dir: string) {
  try {
    execSync(`rm -rf "${dir}"`, { stdio: "pipe" });
  } catch {
    // ignore cleanup errors
  }
}

// ── AC-3: code_review focus parameter ──────────────────────────────────────

describe("code_review focus parameter (AC-3)", () => {
  let codeReviewTool: any;

  beforeEach(async () => {
    const mod = await import("../src/domains/engineering/tools.js");
    codeReviewTool = mod.codeReviewTool;
  });

  it("includes frontend-specific rules when focus is 'frontend'", async () => {
    const dir = join(tmpdir(), `test-cr-${randomUUID()}`);
    const file = join(dir, "Component.tsx");
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      `import React from 'react';\nfunction Comp() {\n  return <img src="test.png" />;\n}\n`,
    );

    try {
      const result = await codeReviewTool.execute("t1", { files: [file], focus: "frontend" }, signal);
      const text = result.content[0].text;
      expect(text).toContain("Focus");
      expect(text).toContain("frontend");
      expect(text).toContain("alt");
    } finally {
      cleanupDir(dir);
    }
  });

  it("includes security-specific rules when focus is 'security'", async () => {
    const dir = join(tmpdir(), `test-cr-${randomUUID()}`);
    const file = join(dir, "auth.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      `const password = "super_secret_123";\nconst x = eval("something");\n`,
    );

    try {
      const result = await codeReviewTool.execute("t2", { files: [file], focus: "security" }, signal);
      const text = result.content[0].text;
      expect(text).toContain("secret");
      expect(text).toContain("eval");
    } finally {
      cleanupDir(dir);
    }
  });

  it("includes backend-specific rules when focus is 'backend'", async () => {
    const dir = join(tmpdir(), `test-cr-${randomUUID()}`);
    const file = join(dir, "api.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      `const query = "SELECT * FROM users WHERE id=" + req.params.id;\n`,
    );

    try {
      const result = await codeReviewTool.execute("t3", { files: [file], focus: "backend" }, signal);
      const text = result.content[0].text;
      expect(text).toContain("SQL");
    } finally {
      cleanupDir(dir);
    }
  });

  it("runs general rules without focus parameter", async () => {
    const dir = join(tmpdir(), `test-cr-${randomUUID()}`);
    const file = join(dir, "code.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(file, `// TODO: fix this\nconsole.log("debug");\n`);

    try {
      const result = await codeReviewTool.execute("t4", { files: [file] }, signal);
      const text = result.content[0].text;
      expect(text).toContain("Code Review");
      expect(text).toContain("TODO");
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── AC-4: security_scan PII detection ──────────────────────────────────────

describe("security_scan PII detection (AC-4)", () => {
  let securityScanTool: any;

  beforeEach(async () => {
    const mod = await import("../src/domains/platform/tools.js");
    securityScanTool = mod.securityScanTool;
  });

  it("detects SSN patterns", async () => {
    const dir = join(tmpdir(), `test-pii-${randomUUID()}`);
    const file = join(dir, "data.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(file, `const ssn = "123-45-6789";\n`);

    try {
      const result = await securityScanTool.execute("t5", { directory: dir }, signal);
      const text = result.content[0].text;
      expect(text).toContain("PII");
    } finally {
      cleanupDir(dir);
    }
  });

  it("detects credit card patterns", async () => {
    const dir = join(tmpdir(), `test-pii-${randomUUID()}`);
    const file = join(dir, "payment.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(file, `const card = "4111111111111111";\n`);

    try {
      const result = await securityScanTool.execute("t6", { directory: dir }, signal);
      const text = result.content[0].text;
      expect(text).toContain("PII");
    } finally {
      cleanupDir(dir);
    }
  });

  it("returns summary with severity counts", async () => {
    const dir = join(tmpdir(), `test-pii-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "clean.ts"), `const x = 1;\n`);

    try {
      const result = await securityScanTool.execute("t7", { directory: dir }, signal);
      const text = result.content[0].text;
      expect(text).toContain("Summary");
      expect(text).toContain("Severity");
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── AC-5: incident_triage structured output ────────────────────────────────

describe("incident_triage (AC-5)", () => {
  let incidentTriageTool: any;

  beforeEach(async () => {
    const mod = await import("../src/domains/platform/tools.js");
    incidentTriageTool = mod.incidentTriageTool;
  });

  it("classifies OOM error as critical", async () => {
    const result = await incidentTriageTool.execute(
      "t8",
      {
        error_text: "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory",
        service_name: "api-server",
      },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Incident Triage");
    expect(text).toContain("Error Classification");
    expect(text).toContain("Memory Exhaustion");
    expect(text).toContain("CRITICAL");
    expect(text).toContain("api-server");
    expect(text).toContain("Suggested Root Cause");
    expect(text).toContain("Recommended Actions");
  });

  it("classifies connection refused as high severity", async () => {
    const result = await incidentTriageTool.execute(
      "t9",
      { error_text: "Error: connect ECONNREFUSED 127.0.0.1:5432" },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Connection Failure");
    expect(text).toContain("HIGH");
  });

  it("parses stack trace frames", async () => {
    const stack = `TypeError: Cannot read properties of undefined (reading 'name')
    at processUser (/app/src/handlers/user.ts:42:15)
    at /app/src/routes/api.ts:18:5
    at node:internal/process/task_queues:95:5`;

    const result = await incidentTriageTool.execute(
      "t10",
      { error_text: stack },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Stack Trace");
    expect(text).toContain("user.ts");
    expect(text).toContain("api.ts");
    expect(text).not.toContain("task_queues");
  });

  it("returns structured output for unknown error type", async () => {
    const result = await incidentTriageTool.execute(
      "t11",
      { error_text: "Something went very wrong" },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Error Classification");
    expect(text).toContain("Affected Components");
    expect(text).toContain("Suggested Root Cause");
    expect(text).toContain("Recommended Actions");
  });
});

// ── AC-6: ci_generate valid workflow ────────────────────────────────────────

describe("ci_generate (AC-6)", () => {
  let ciGenerateTool: any;

  beforeEach(async () => {
    const mod = await import("../src/domains/platform/tools.js");
    ciGenerateTool = mod.ciGenerateTool;
  });

  it("generates GitHub Actions for a Node.js project", async () => {
    const dir = join(tmpdir(), `test-ci-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
      }),
    );
    await writeFile(join(dir, "tsconfig.json"), "{}");

    try {
      const result = await ciGenerateTool.execute(
        "t12",
        { directory: dir, target: "github-actions" },
        signal,
      );
      const text = result.content[0].text;

      expect(text).toContain("Generated CI Config");
      expect(text).toContain("typescript");
      expect(text).toContain("node");
      expect(text).toContain("name: CI");
      expect(text).toContain("npm ci");
      expect(text).toContain("npm run lint");
      expect(text).toContain("npm run build");
      expect(text).toContain("npm run test");
    } finally {
      cleanupDir(dir);
    }
  });

  it("detects bun as package manager", async () => {
    const dir = join(tmpdir(), `test-ci-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "bun-project", scripts: { test: "bun test" } }),
    );
    await writeFile(join(dir, "bun.lockb"), "");

    try {
      const result = await ciGenerateTool.execute(
        "t13",
        { directory: dir, target: "github-actions" },
        signal,
      );
      const text = result.content[0].text;

      expect(text).toContain("bun");
      expect(text).toContain("oven-sh/setup-bun");
    } finally {
      cleanupDir(dir);
    }
  });

  it("generates GitLab CI for a Node.js project", async () => {
    const dir = join(tmpdir(), `test-ci-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );

    try {
      const result = await ciGenerateTool.execute(
        "t14",
        { directory: dir, target: "gitlab-ci" },
        signal,
      );
      const text = result.content[0].text;

      expect(text).toContain("stages:");
      expect(text).toContain("npm ci");
    } finally {
      cleanupDir(dir);
    }
  });

  it("handles Python projects", async () => {
    const dir = join(tmpdir(), `test-ci-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pyproject.toml"), "[project]\nname = 'test'\n");

    try {
      const result = await ciGenerateTool.execute(
        "t15",
        { directory: dir, target: "github-actions" },
        signal,
      );
      const text = result.content[0].text;

      expect(text).toContain("python");
      expect(text).toContain("setup-python");
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── recall mode: stats ─────────────────────────────────────────────────────

describe("recall mode: stats", () => {
  it("returns memory counts by type, tag, and importance", async () => {
    const dir = join(tmpdir(), `test-recall-${randomUUID()}`);
    const memDir = join(dir, "memory");
    await mkdir(memDir, { recursive: true });
    const memFile = join(memDir, "memories.jsonl");

    // Write test entries
    const entries = [
      JSON.stringify({ schemaVersion: 1, id: "1", content: "a", type: "decision", tags: ["arch"], importance: "high", createdAt: "2025-01-01", accessCount: 0, projectId: null, sessionId: "s1" }),
      JSON.stringify({ schemaVersion: 1, id: "2", content: "b", type: "episodic", tags: ["arch", "test"], importance: "medium", createdAt: "2025-01-02", accessCount: 0, projectId: null, sessionId: "s1" }),
      JSON.stringify({ schemaVersion: 1, id: "3", content: "c", type: "decision", tags: ["test"], importance: "high", createdAt: "2025-01-03", accessCount: 0, projectId: null, sessionId: "s1" }),
    ];
    await writeFile(memFile, entries.join("\n") + "\n");

    try {
      const { MemoryStore } = await import("../src/domains/memory/store.js");
      const store = new MemoryStore(dir);

      const { registerMemoryTools } = await import("../src/domains/memory/tools.js");

      let recallTool: any;
      const mockPi = {
        registerTool: (tool: any) => {
          if (tool.name === "recall") recallTool = tool;
        },
        registerCommand: vi.fn(),
        on: vi.fn(),
      };

      registerMemoryTools(mockPi as any, store);

      const result = await recallTool.execute("t16", { query: "", mode: "stats" }, signal);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      expect(parsed.byType.decision).toBe(2);
      expect(parsed.byType.episodic).toBe(1);
      expect(parsed.byImportance.high).toBe(2);
      expect(parsed.byImportance.medium).toBe(1);
      expect(parsed.byTag.arch).toBe(2);
      expect(parsed.byTag.test).toBe(2);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── feedback_analyze ───────────────────────────────────────────────────────

describe("feedback_analyze", () => {
  let feedbackAnalyzeTool: any;

  beforeEach(async () => {
    const mod = await import("../src/domains/product/tools.js");
    feedbackAnalyzeTool = mod.feedbackAnalyzeTool;
  });

  it("analyzes positive feedback correctly", async () => {
    const result = await feedbackAnalyzeTool.execute(
      "t17",
      {
        feedback: [
          "Great product, love the clean UI design!",
          "This tool is amazing and super easy to use.",
        ],
      },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Feedback Analysis");
    expect(text).toContain("Sentiment Overview");
    expect(text).toContain("positive");
  });

  it("detects themes in feedback", async () => {
    const result = await feedbackAnalyzeTool.execute(
      "t18",
      {
        feedback: [
          "The API integration is broken and slow",
          "Performance is terrible, app crashes constantly",
          "Love the new mobile app design",
        ],
      },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Top Themes");
    expect(text).toContain("Performance");
  });

  it("handles mixed sentiment", async () => {
    const result = await feedbackAnalyzeTool.execute(
      "t19",
      {
        feedback: [
          "Great features but the performance is terrible and slow",
        ],
        context: "Mobile App v2",
      },
      signal,
    );
    const text = result.content[0].text;

    expect(text).toContain("Mobile App v2");
    expect(text).toContain("Entry-Level Analysis");
  });
});

// ── data_lineage ───────────────────────────────────────────────────────────

describe("data_lineage", () => {
  it("registers the data_lineage tool in search domain", async () => {
    const registeredTools: string[] = [];
    const mockPi = {
      registerTool: (tool: any) => registeredTools.push(tool.name),
      registerCommand: vi.fn(),
      on: vi.fn(),
    };

    const { registerSearchTools } = await import("../src/domains/search/tools.js");
    registerSearchTools(mockPi as any);

    expect(registeredTools).toContain("data_lineage");
  });

  it("data_lineage tool has correct parameters", async () => {
    let dataLineageTool: any;
    const mockPi = {
      registerTool: (tool: any) => {
        if (tool.name === "data_lineage") dataLineageTool = tool;
      },
      registerCommand: vi.fn(),
      on: vi.fn(),
    };

    const { registerSearchTools } = await import("../src/domains/search/tools.js");
    registerSearchTools(mockPi as any);

    expect(dataLineageTool).toBeDefined();
    expect(dataLineageTool.name).toBe("data_lineage");
    expect(dataLineageTool.description).toContain("ORM");
  });
});
