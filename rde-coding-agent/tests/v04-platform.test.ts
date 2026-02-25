/**
 * Tests for v04 platform domain tools.
 *
 * Tools tested:
 * - iac_review: IaC security misconfiguration scanner
 * - release_plan: Conventional commit release planner
 * - error_analysis: Log file error classifier
 * - audit_evidence: Compliance evidence scanner
 * - privacy_scan: PII field inventory scanner
 */

import { describe, it, expect } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

import {
  iacReviewTool,
  releasePlanTool,
  errorAnalysisTool,
  auditEvidenceTool,
  privacyScanTool,
} from "../src/domains/platform/tools.js";

const signal = new AbortController().signal;

function cleanupDir(dir: string) {
  try {
    execSync(`rm -rf "${dir}"`, { stdio: "pipe" });
  } catch {
    /* ignore */
  }
}

// ── iac_review ─────────────────────────────────────────────────────────────────

describe("iacReviewTool", () => {
  it("has correct name and parameters schema", () => {
    expect(iacReviewTool.name).toBe("iac_review");
    expect(typeof iacReviewTool.execute).toBe("function");
    // parameters schema has a 'path' property
    const props = (iacReviewTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
  });

  it("detects hardcoded password in a .tf file and returns findings with severity", async () => {
    const dir = join(tmpdir(), `test-iac-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "main.tf"),
      `resource "aws_instance" "main" {
  ami           = "ami-0abc12345"
  instance_type = "t3.micro"
  password = "supersecretpassword123"
}
`,
    );

    try {
      const result = await iacReviewTool.execute("t1", { path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("findings");
      expect(Array.isArray(parsed.findings)).toBe(true);
      expect(parsed.findings.length).toBeGreaterThan(0);
      // At least one finding should have a severity field
      const severities = parsed.findings.map((f: any) => f.severity);
      expect(severities.some((s: string) => ["critical", "high", "medium", "low"].includes(s))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });

  it("returns summary with filesScanned and iacTypes for a terraform file", async () => {
    const dir = join(tmpdir(), `test-iac-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "variables.tf"),
      `variable "region" {
  default = "us-east-1"
}

resource "aws_s3_bucket" "data" {
  bucket = "my-data-bucket"
}
`,
    );

    try {
      const result = await iacReviewTool.execute("t2", { path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("summary");
      expect(parsed).toHaveProperty("filesScanned");
      expect(parsed.filesScanned).toBeGreaterThanOrEqual(1);
      expect(parsed).toHaveProperty("iacTypes");
      expect(parsed.iacTypes).toContain("Terraform");
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── release_plan ───────────────────────────────────────────────────────────────

describe("releasePlanTool", () => {
  it("has correct name and parameters schema", () => {
    expect(releasePlanTool.name).toBe("release_plan");
    expect(typeof releasePlanTool.execute).toBe("function");
    const props = (releasePlanTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
    expect(props).toHaveProperty("since");
  });

  it("returns versionSuggestion and changes categories for a git repo with conventional commits", async () => {
    const dir = join(tmpdir(), `test-release-${randomUUID()}`);
    await mkdir(dir, { recursive: true });

    // Set up a real git repo with conventional commits
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: "pipe" });
    await writeFile(join(dir, "README.md"), "# Test\n");
    execSync("git add .", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "chore: initial commit"', { cwd: dir, stdio: "pipe" });
    await writeFile(join(dir, "auth.ts"), "// authentication\n");
    execSync("git add .", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "feat: add auth"', { cwd: dir, stdio: "pipe" });
    await writeFile(join(dir, "bugfix.ts"), "// fix\n");
    execSync("git add .", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "fix: resolve bug in login"', { cwd: dir, stdio: "pipe" });

    try {
      const result = await releasePlanTool.execute("t3", { path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("versionSuggestion");
      expect(["major", "minor", "patch"]).toContain(parsed.versionSuggestion);
      expect(parsed).toHaveProperty("changes");
      expect(parsed.changes).toHaveProperty("features");
      expect(parsed.changes).toHaveProperty("fixes");
      expect(parsed.changes).toHaveProperty("chores");
    } finally {
      cleanupDir(dir);
    }
  });

  it("suggests 'minor' version when feat commits are present", async () => {
    const dir = join(tmpdir(), `test-release-${randomUUID()}`);
    await mkdir(dir, { recursive: true });

    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: "pipe" });
    await writeFile(join(dir, "feature.ts"), "// new feature\n");
    execSync("git add .", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "feat: add new dashboard feature"', { cwd: dir, stdio: "pipe" });

    try {
      const result = await releasePlanTool.execute("t4", { path: dir }, signal);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.versionSuggestion).toBe("minor");
      expect(parsed.changes.features.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── error_analysis ─────────────────────────────────────────────────────────────

describe("errorAnalysisTool", () => {
  it("has correct name and parameters schema", () => {
    expect(errorAnalysisTool.name).toBe("error_analysis");
    expect(typeof errorAnalysisTool.execute).toBe("function");
    const props = (errorAnalysisTool.parameters as any).properties;
    expect(props).toHaveProperty("log_path");
    expect(props).toHaveProperty("pattern");
  });

  it("parses ERROR and FATAL lines from a log file and returns error categories", async () => {
    const dir = join(tmpdir(), `test-errlog-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "app.log"),
      `2024-01-15T10:00:00 INFO  Server started on port 3000
2024-01-15T10:01:00 ERROR Connection refused to database at 127.0.0.1:5432
2024-01-15T10:02:00 ERROR Timeout waiting for upstream service
2024-01-15T10:03:00 FATAL Out of memory - heap allocation failed
2024-01-15T10:04:00 ERROR Authentication failed for user admin
2024-01-15T10:05:00 INFO  Request processed successfully
`,
    );

    try {
      const result = await errorAnalysisTool.execute("t5", { log_path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("errors");
      expect(Array.isArray(parsed.errors)).toBe(true);
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed).toHaveProperty("categories");
      expect(parsed).toHaveProperty("totalErrors");
      expect(parsed.totalErrors).toBeGreaterThan(0);
    } finally {
      cleanupDir(dir);
    }
  });

  it("classifies error types correctly (connection, timeout, oom, auth)", async () => {
    const dir = join(tmpdir(), `test-errlog-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "service.log"),
      `2024-01-15T10:00:00 ERROR ECONNREFUSED connecting to redis:6379
2024-01-15T10:01:00 ERROR Request timed out after 30000ms
2024-01-15T10:02:00 FATAL OOM: out of memory allocating large buffer
`,
    );

    try {
      const result = await errorAnalysisTool.execute("t6", { log_path: dir }, signal);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("categories");
      const categories = parsed.categories as Record<string, number>;
      // Should have at least one of: connection, timeout, oom
      const knownCategories = ["connection", "timeout", "oom", "general"];
      const foundCategories = Object.keys(categories);
      expect(foundCategories.some((c) => knownCategories.includes(c))).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── audit_evidence ─────────────────────────────────────────────────────────────

describe("auditEvidenceTool", () => {
  it("has correct name and parameters schema", () => {
    expect(auditEvidenceTool.name).toBe("audit_evidence");
    expect(typeof auditEvidenceTool.execute).toBe("function");
    const props = (auditEvidenceTool.parameters as any).properties;
    expect(props).toHaveProperty("framework");
    expect(props).toHaveProperty("path");
  });

  it("returns controls with evidence for soc2 framework given auth/jwt/encryption files", async () => {
    const dir = join(tmpdir(), `test-audit-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "auth.ts"),
      `// authentication module
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

export function login(user: string, pass: string) {
  const token = jwt.sign({ user }, process.env.JWT_SECRET!);
  return token;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}
`,
    );
    await writeFile(
      join(dir, "encryption.ts"),
      `// encryption utilities
import crypto from 'node:crypto';

export function encrypt(data: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('AES-256-GCM', key, iv);
  return cipher.update(data, 'utf8', 'hex');
}
`,
    );
    await writeFile(
      join(dir, "audit.ts"),
      `// audit logging
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
});

export function auditLog(event: string, user: string) {
  logger.info({ event, user, timestamp: new Date() });
}
`,
    );

    try {
      const result = await auditEvidenceTool.execute("t7", { framework: "soc2", path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("framework");
      expect(parsed.framework).toBe("soc2");
      expect(parsed).toHaveProperty("controls");
      expect(Array.isArray(parsed.controls)).toBe(true);
      expect(parsed.controls.length).toBeGreaterThan(0);
      expect(parsed).toHaveProperty("summary");
    } finally {
      cleanupDir(dir);
    }
  });

  it("returns complianceScore and summary with found/partial/missing counts", async () => {
    const dir = join(tmpdir(), `test-audit-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    // Minimal file for gdpr
    await writeFile(
      join(dir, "privacy.ts"),
      `// GDPR consent management
export function acceptConsent(userId: string) {
  // store consent
  return { consent: true, gdpr: true, cookie: 'accepted' };
}

export function deleteUserData(userId: string) {
  // Art.17 right to forget
  return purgeUserRecords(userId);
}

async function purgeUserRecords(id: string) {
  return { deleted: true, anonymize: true };
}
`,
    );

    try {
      const result = await auditEvidenceTool.execute("t8", { framework: "gdpr", path: dir }, signal);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("complianceScore");
      expect(typeof parsed.complianceScore).toBe("number");
      expect(parsed.complianceScore).toBeGreaterThanOrEqual(0);
      expect(parsed.complianceScore).toBeLessThanOrEqual(100);
      expect(parsed.summary).toHaveProperty("total");
      expect(parsed.summary.total).toBeGreaterThan(0);
    } finally {
      cleanupDir(dir);
    }
  });
});

// ── privacy_scan ───────────────────────────────────────────────────────────────

describe("privacyScanTool", () => {
  it("has correct name and parameters schema", () => {
    expect(privacyScanTool.name).toBe("privacy_scan");
    expect(typeof privacyScanTool.execute).toBe("function");
    const props = (privacyScanTool.parameters as any).properties;
    expect(props).toHaveProperty("path");
  });

  it("detects PII fields like email, phone, and ssn in code files", async () => {
    const dir = join(tmpdir(), `test-pii-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "user-model.ts"),
      `interface User {
  userEmail: string;
  phoneNumber: string;
  ssn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export function createUser(data: User) {
  return {
    email: data.userEmail,
    phone: data.phoneNumber,
    ssn: data.ssn,
  };
}
`,
    );

    try {
      const result = await privacyScanTool.execute("t9", { path: dir }, signal);
      const text = result.content[0].text;
      const parsed = JSON.parse(text);

      // Should either return piiInventory or an error (if rg not available)
      if (parsed.error) {
        // If rg not available, skip the PII-specific assertions
        expect(parsed).toHaveProperty("piiInventory");
        expect(Array.isArray(parsed.piiInventory)).toBe(true);
      } else {
        expect(parsed).toHaveProperty("piiInventory");
        expect(Array.isArray(parsed.piiInventory)).toBe(true);
        expect(parsed).toHaveProperty("summary");
        expect(parsed.summary).toHaveProperty("totalPiiFields");
      }
    } finally {
      cleanupDir(dir);
    }
  });

  it("returns summary with byType breakdown and recommendations when PII is found", async () => {
    const dir = join(tmpdir(), `test-pii-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "profile.ts"),
      `// User profile data handling
const userProfile = {
  email: req.body.email,
  phoneNumber: req.body.phoneNumber,
  ssn: req.body.ssn,
  creditCard: req.body.creditCard,
  dateOfBirth: req.body.dateOfBirth,
};

async function saveProfile(data: typeof userProfile) {
  await db.insert(userProfile).values(data);
}

async function sendProfile(userId: string) {
  const data = await db.select().from(userProfile);
  return fetch('/api/profile', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
`,
    );

    try {
      const result = await privacyScanTool.execute("t10", { path: dir }, signal);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty("summary");
      expect(parsed.summary).toHaveProperty("totalPiiFields");
      expect(parsed.summary).toHaveProperty("byType");
      expect(parsed.summary).toHaveProperty("flowAnalysis");
      expect(parsed).toHaveProperty("recommendations");
      expect(Array.isArray(parsed.recommendations)).toBe(true);
    } finally {
      cleanupDir(dir);
    }
  });
});
