/**
 * Platform domain tools.
 *
 * Security scanning, compliance checking, and CI/CD config review.
 */

import { Type } from "@sinclair/typebox";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
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

function rgAvailable(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function rgSearch(pattern: string, dir: string, extraArgs: string[] = []): string {
  try {
    return execFileSync(
      "rg",
      [
        "--no-heading",
        "--line-number",
        "--color=never",
        "--max-count=20",
        "-g", "!node_modules",
        "-g", "!dist",
        "-g", "!.git",
        ...extraArgs,
        pattern,
        dir,
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    return "";
  }
}

// ── security_scan ─────────────────────────────────────────────────────────────

interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low";
  pattern: string;
  description: string;
  matches: string[];
}

export const securityScanTool: PiTool = {
  name: "security_scan",
  label: "Security Scan",
  description:
    "Runs grep/ripgrep-based security pattern checks for hardcoded secrets, SQL injection, XSS vulnerabilities, and other common issues.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Directory to scan.",
    }),
    include_patterns: Type.Optional(
      Type.Array(Type.String(), {
        description: "Additional regex patterns to search for.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { directory, include_patterns = [] } = input as {
      directory: string;
      include_patterns?: string[];
    };

    const sections: string[] = [];
    sections.push(`# Security Scan: \`${directory}\``);
    sections.push(`Scan time: ${new Date().toISOString()}\n`);

    const hasRg = rgAvailable();
    if (!hasRg) {
      sections.push("> Note: `ripgrep` (rg) not found — falling back to manual file scan.");
    }

    // Define security patterns
    const patterns: Array<{
      id: string;
      severity: SecurityFinding["severity"];
      pattern: string;
      description: string;
      fileGlobs?: string[];
    }> = [
      {
        id: "SEC-001",
        severity: "critical",
        pattern: `(?i)(password|passwd|pwd|secret|api_key|apikey|auth_token|access_token)\\s*[=:]\\s*['"][^'"]{4,}['"]`,
        description: "Hardcoded credential or secret in source code",
      },
      {
        id: "SEC-002",
        severity: "critical",
        pattern: `(?i)(aws_access_key_id|aws_secret_access_key|AKIA[0-9A-Z]{16})`,
        description: "AWS credential pattern detected",
      },
      {
        id: "SEC-003",
        severity: "high",
        pattern: `process\\.env\\.\\w+\\s*\\|\\|\\s*['"][^'"]+['"]`,
        description: "Environment variable with hardcoded fallback value",
      },
      {
        id: "SEC-004",
        severity: "high",
        pattern: `(?i)SELECT\\s+.+\\s+FROM\\s+.+\\s+WHERE\\s+.+\\+\\s*`,
        description: "Potential SQL injection via string concatenation",
      },
      {
        id: "SEC-005",
        severity: "high",
        pattern: `innerHTML\\s*=\\s*(?!['"\`]<)`,
        description: "Potential XSS via direct innerHTML assignment",
      },
      {
        id: "SEC-006",
        severity: "high",
        pattern: `dangerouslySetInnerHTML`,
        description: "React dangerouslySetInnerHTML usage — verify input is sanitized",
      },
      {
        id: "SEC-007",
        severity: "medium",
        pattern: `eval\\s*\\(`,
        description: "Use of eval() — potential code injection risk",
      },
      {
        id: "SEC-008",
        severity: "medium",
        pattern: `new Function\\s*\\(`,
        description: "Dynamic function construction — potential code injection",
      },
      {
        id: "SEC-009",
        severity: "medium",
        pattern: `(?i)http://(?!localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)`,
        description: "Non-localhost HTTP (non-HTTPS) URL — potential insecure transport",
      },
      {
        id: "SEC-010",
        severity: "medium",
        pattern: `console\\.log\\s*\\(.*(?:password|token|secret|key|credential)`,
        description: "Potential secret logged to console",
      },
      {
        id: "SEC-011",
        severity: "low",
        pattern: `TODO.*(?:security|auth|fix|hack|vulnerability|vuln)`,
        description: "Security-related TODO comment — review and remediate",
      },
      {
        id: "SEC-012",
        severity: "low",
        pattern: `\\/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\/.*(?:disable|ignore).*(?:eslint|tslint).*(?:security|no-eval)`,
        description: "Linting security rule suppression",
      },
      // PII detection patterns
      {
        id: "PII-001",
        severity: "high",
        pattern: `\\b\\d{3}-\\d{2}-\\d{4}\\b`,
        description: "PII: Social Security Number pattern (XXX-XX-XXXX)",
      },
      {
        id: "PII-002",
        severity: "medium",
        pattern: `\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b`,
        description: "PII: Email address pattern",
        fileGlobs: ["!*.lock", "!package-lock.json"],
      },
      {
        id: "PII-003",
        severity: "high",
        pattern: `\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b`,
        description: "PII: Credit card number pattern (Visa, MC, Amex, Discover)",
      },
      {
        id: "PII-004",
        severity: "medium",
        pattern: `(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b`,
        description: "PII: US phone number pattern",
        fileGlobs: ["!*.lock", "!package-lock.json"],
      },
      {
        id: "PII-005",
        severity: "low",
        pattern: `\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b`,
        description: "PII: IPv4 address pattern (may indicate hardcoded infrastructure)",
        fileGlobs: ["!*.lock", "!package-lock.json"],
      },
    ];

    // Add custom patterns
    for (let i = 0; i < include_patterns.length; i++) {
      patterns.push({
        id: `CUSTOM-${i + 1}`,
        severity: "medium",
        pattern: include_patterns[i],
        description: `Custom pattern ${i + 1}: ${include_patterns[i]}`,
      });
    }

    const findings: SecurityFinding[] = [];

    if (hasRg) {
      for (const p of patterns) {
        const output = rgSearch(p.pattern, directory, p.fileGlobs ? p.fileGlobs.flatMap((g) => ["-g", g]) : []);
        if (output.trim()) {
          const matches = output
            .trim()
            .split("\n")
            .filter(Boolean)
            .slice(0, 10);
          findings.push({
            severity: p.severity,
            pattern: `${p.id}: ${p.description}`,
            description: p.description,
            matches,
          });
        }
      }
    } else {
      // Fallback: manual scan of JS/TS files
      const allFiles: string[] = [];
      async function walkFiles(dir: string): Promise<void> {
        const entries = await readdir(dir).catch(() => [] as string[]);
        for (const e of entries) {
          if (["node_modules", ".git", "dist"].includes(e)) continue;
          const full = join(dir, e);
          const s = await stat(full).catch(() => null);
          if (s?.isDirectory()) await walkFiles(full);
          else if ([".ts", ".js", ".tsx", ".jsx", ".env", ".json"].includes(extname(e))) {
            allFiles.push(full);
          }
        }
      }
      await walkFiles(directory);

      for (const f of allFiles.slice(0, 100)) {
        const content = await readFileSafe(f);
        const lines = content.split("\n");
        for (const p of patterns) {
          // Strip (?i) prefix — ripgrep-only syntax; JS uses the "i" flag instead
          const jsPattern = p.pattern.replace(/^\(\?i\)/g, "");
          let re: RegExp;
          try {
            re = new RegExp(jsPattern, "i");
          } catch {
            continue; // skip invalid regex patterns
          }
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              const existing = findings.find((f) => f.pattern.startsWith(p.id));
              if (existing) {
                existing.matches.push(`${f}:${i + 1}: ${lines[i].trim()}`);
              } else {
                findings.push({
                  severity: p.severity,
                  pattern: `${p.id}: ${p.description}`,
                  description: p.description,
                  matches: [`${f}:${i + 1}: ${lines[i].trim()}`],
                });
              }
            }
          }
        }
      }
    }

    // Organize by severity
    const bySeverity: Record<string, SecurityFinding[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };
    for (const f of findings) {
      bySeverity[f.severity].push(f);
    }

    const totalFindings = findings.length;
    sections.push(`## Summary`);
    sections.push(`| Severity | Count |`);
    sections.push(`|----------|-------|`);
    sections.push(`| Critical | ${bySeverity.critical.length} |`);
    sections.push(`| High | ${bySeverity.high.length} |`);
    sections.push(`| Medium | ${bySeverity.medium.length} |`);
    sections.push(`| Low | ${bySeverity.low.length} |`);
    sections.push(`| **Total** | **${totalFindings}** |`);
    sections.push("");

    if (totalFindings === 0) {
      sections.push("**No security issues detected.** This is a heuristic scan — manual review is still recommended.");
      return textResult(sections.join("\n"));
    }

    const order: Array<SecurityFinding["severity"]> = ["critical", "high", "medium", "low"];
    for (const sev of order) {
      if (bySeverity[sev].length === 0) continue;
      sections.push(`## ${sev.charAt(0).toUpperCase() + sev.slice(1)} Severity Findings`);
      for (const finding of bySeverity[sev]) {
        sections.push(`\n### ${finding.pattern}`);
        sections.push("```");
        sections.push(finding.matches.slice(0, 5).join("\n"));
        if (finding.matches.length > 5) {
          sections.push(`... (${finding.matches.length - 5} more matches)`);
        }
        sections.push("```");
      }
    }

    sections.push("\n## Recommendations");
    if (bySeverity.critical.length > 0) {
      sections.push("- **CRITICAL**: Remove all hardcoded credentials immediately. Use environment variables or a secrets manager (e.g., AWS Secrets Manager, Vault, 1Password Secrets Automation).");
    }
    if (bySeverity.high.length > 0) {
      sections.push("- **HIGH**: Review all SQL query construction — use parameterized queries. Sanitize all user input before inserting into the DOM.");
    }
    if (bySeverity.medium.length > 0) {
      sections.push("- **MEDIUM**: Replace `eval()` and `new Function()` with safer alternatives. Enforce HTTPS for all external URLs.");
    }
    sections.push("- Run this scan in CI on every pull request.");
    sections.push("- Consider adding a dedicated SAST tool (e.g., Semgrep, SonarQube) for deeper analysis.");

    return textResult(sections.join("\n"));
  },
};

// ── compliance_check ──────────────────────────────────────────────────────────

export const complianceCheckTool: PiTool = {
  name: "compliance_check",
  label: "Compliance Check",
  description:
    "Checks for required project files (LICENSE, README, SECURITY.md, CHANGELOG), code of conduct, and other compliance artifacts.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Root directory to check.",
    }),
  }),

  async execute(_id, input) {
    const { directory } = input as { directory: string };

    const sections: string[] = [];
    sections.push(`# Compliance Check: \`${directory}\``);
    sections.push(`Checked at: ${new Date().toISOString()}\n`);

    let rootFiles: string[];
    try {
      rootFiles = (await readdir(directory)).map((f) => f.toLowerCase());
    } catch (err) {
      return textResult(`Error reading directory: ${(err as Error).message}`);
    }

    // Define required and recommended files
    const checks: Array<{
      file: string;
      category: string;
      required: boolean;
      description: string;
    }> = [
      { file: "readme.md", category: "Documentation", required: true, description: "Project overview, setup, and usage instructions" },
      { file: "license", category: "Legal", required: true, description: "Open source or proprietary license file" },
      { file: "license.md", category: "Legal", required: false, description: "License in Markdown format (alternative)" },
      { file: "license.txt", category: "Legal", required: false, description: "License in text format (alternative)" },
      { file: "security.md", category: "Security", required: true, description: "Security policy and vulnerability reporting process" },
      { file: "changelog.md", category: "Documentation", required: false, description: "Version history and release notes" },
      { file: "contributing.md", category: "Community", required: false, description: "Contribution guidelines" },
      { file: "code_of_conduct.md", category: "Community", required: false, description: "Community code of conduct" },
      { file: ".gitignore", category: "VCS", required: true, description: "Files excluded from version control" },
      { file: ".editorconfig", category: "Tooling", required: false, description: "Consistent editor settings" },
    ];

    // Package-specific checks
    const hasPkg = rootFiles.includes("package.json");
    if (hasPkg) {
      checks.push(
        { file: "package.json", category: "Node.js", required: true, description: "Package manifest" },
        { file: ".npmignore", category: "Node.js", required: false, description: "Files excluded from npm publish" },
      );
    }

    const hasDockerfile = rootFiles.includes("dockerfile");
    if (hasDockerfile) {
      checks.push({ file: ".dockerignore", category: "Docker", required: true, description: "Files excluded from Docker build context" });
    }

    // License check
    const hasLicense = rootFiles.some((f) => f === "license" || f === "license.md" || f === "license.txt");

    // Evaluate checks
    type CheckResult = { file: string; category: string; required: boolean; found: boolean; description: string };
    const results: CheckResult[] = checks.map((c) => ({
      ...c,
      found: rootFiles.includes(c.file),
    }));

    const passed = results.filter((r) => r.found);
    const failed = results.filter((r) => !r.found);
    const failedRequired = failed.filter((r) => r.required);
    const failedOptional = failed.filter((r) => !r.required);

    sections.push(`## Results`);
    sections.push(`- Checks run: ${results.length}`);
    sections.push(`- Passed: ${passed.length}`);
    sections.push(`- Failed (required): ${failedRequired.length}`);
    sections.push(`- Missing (optional): ${failedOptional.length}\n`);

    if (failedRequired.length === 0) {
      sections.push("**All required compliance files are present.**\n");
    } else {
      sections.push(`**WARNING: ${failedRequired.length} required file(s) missing.**\n`);
    }

    // Present results as table
    sections.push("## File Checklist");
    sections.push("| Status | File | Category | Description |");
    sections.push("|--------|------|----------|-------------|");
    for (const r of results) {
      const status = r.found ? "PASS" : r.required ? "FAIL" : "WARN";
      sections.push(`| ${status} | \`${r.file}\` | ${r.category} | ${r.description} |`);
    }

    // License content check
    if (hasLicense) {
      const licFile = ["license", "license.md", "license.txt"].find((f) => rootFiles.includes(f));
      if (licFile) {
        try {
          const licContent = await readFile(join(directory, licFile), "utf-8");
          const licTypes = [
            { name: "MIT", pattern: /MIT License/i },
            { name: "Apache 2.0", pattern: /Apache License.*2\.0/i },
            { name: "GPL v3", pattern: /GNU GENERAL PUBLIC LICENSE.*Version 3/i },
            { name: "BSD 3-Clause", pattern: /BSD 3-Clause/i },
            { name: "ISC", pattern: /ISC License/i },
          ];
          const detected = licTypes.find((t) => t.pattern.test(licContent));
          sections.push(`\n## License Details`);
          sections.push(`- **Type**: ${detected ? detected.name : "Unknown — manual review required"}`);
          sections.push(`- **File**: \`${licFile}\``);
          sections.push(`- **Size**: ${licContent.length} characters`);
        } catch {
          // ignore
        }
      }
    }

    // Package.json compliance
    if (hasPkg) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf-8"));
        sections.push("\n## package.json Compliance");
        const pkgChecks = [
          { field: "name", ok: !!pkg.name, desc: "Package name" },
          { field: "version", ok: !!pkg.version, desc: "Version" },
          { field: "description", ok: !!pkg.description, desc: "Description" },
          { field: "license", ok: !!pkg.license, desc: "License field" },
          { field: "repository", ok: !!pkg.repository, desc: "Repository URL" },
          { field: "author", ok: !!pkg.author, desc: "Author field" },
          { field: "keywords", ok: Array.isArray(pkg.keywords) && pkg.keywords.length > 0, desc: "Keywords" },
        ];
        for (const c of pkgChecks) {
          sections.push(`- ${c.ok ? "PASS" : "WARN"} \`${c.field}\`: ${c.desc}`);
        }
      } catch {
        // ignore
      }
    }

    sections.push("\n## Recommendations");
    for (const r of failedRequired) {
      sections.push(`- Add \`${r.file}\`: ${r.description}`);
    }
    for (const r of failedOptional) {
      sections.push(`- Consider adding \`${r.file}\`: ${r.description}`);
    }
    if (failedRequired.length === 0 && failedOptional.length === 0) {
      sections.push("- No compliance gaps found.");
    }

    return textResult(sections.join("\n"));
  },
};

// ── ci_cd_review ──────────────────────────────────────────────────────────────

export const ciCdReviewTool: PiTool = {
  name: "ci_cd_review",
  label: "CI/CD Config Review",
  description:
    "Reads CI/CD configuration files (GitHub Actions, GitLab CI, CircleCI, Jenkins) and flags common issues.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Root directory to search for CI/CD configs.",
    }),
  }),

  async execute(_id, input) {
    const { directory } = input as { directory: string };

    const sections: string[] = [];
    sections.push(`# CI/CD Config Review: \`${directory}\``);

    // Find CI/CD config files
    type CiFile = { path: string; system: string; content: string };
    const ciFiles: CiFile[] = [];

    // GitHub Actions
    const ghActionsDir = join(directory, ".github", "workflows");
    try {
      const workflows = await readdir(ghActionsDir);
      for (const wf of workflows.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
        const path = join(ghActionsDir, wf);
        ciFiles.push({ path, system: "GitHub Actions", content: await readFileSafe(path) });
      }
    } catch {
      // no github actions
    }

    // GitLab CI
    const gitlabCi = join(directory, ".gitlab-ci.yml");
    try {
      await stat(gitlabCi);
      ciFiles.push({ path: gitlabCi, system: "GitLab CI", content: await readFileSafe(gitlabCi) });
    } catch {
      // not found
    }

    // CircleCI
    const circleCi = join(directory, ".circleci", "config.yml");
    try {
      await stat(circleCi);
      ciFiles.push({ path: circleCi, system: "CircleCI", content: await readFileSafe(circleCi) });
    } catch {
      // not found
    }

    // Jenkinsfile
    const jenkinsfile = join(directory, "Jenkinsfile");
    try {
      await stat(jenkinsfile);
      ciFiles.push({ path: jenkinsfile, system: "Jenkins", content: await readFileSafe(jenkinsfile) });
    } catch {
      // not found
    }

    // Travis CI
    const travisCi = join(directory, ".travis.yml");
    try {
      await stat(travisCi);
      ciFiles.push({ path: travisCi, system: "Travis CI", content: await readFileSafe(travisCi) });
    } catch {
      // not found
    }

    if (ciFiles.length === 0) {
      sections.push("\nNo CI/CD configuration files found. Checked:");
      sections.push("- `.github/workflows/` (GitHub Actions)");
      sections.push("- `.gitlab-ci.yml` (GitLab CI)");
      sections.push("- `.circleci/config.yml` (CircleCI)");
      sections.push("- `Jenkinsfile` (Jenkins)");
      sections.push("- `.travis.yml` (Travis CI)");
      return textResult(sections.join("\n"));
    }

    sections.push(`\nFound **${ciFiles.length}** CI/CD configuration file(s).\n`);

    for (const ciFile of ciFiles) {
      sections.push(`---\n\n## ${ciFile.system}: \`${ciFile.path}\``);

      const content = ciFile.content;
      const lines = content.split("\n");
      sections.push(`Lines: ${lines.length}\n`);

      const issues: string[] = [];
      const good: string[] = [];

      // Generic checks applicable to most CI systems
      if (/\$\{\{.*secrets\.\w+.*\}\}/.test(content)) {
        good.push("Uses secrets from secret store (not hardcoded).");
      }
      if (/password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(content)) {
        issues.push("CRITICAL: Possible hardcoded password in CI config.");
      }

      // Pinned versions check
      const unpinnedActions = content.match(/uses:\s+\S+@(?:main|master|latest)/g);
      if (unpinnedActions) {
        issues.push(`Unpinned action versions (using branch/tag instead of SHA): ${unpinnedActions.slice(0, 3).join(", ")}`);
      }

      // Cache usage
      if (/cache/.test(content)) {
        good.push("Dependency caching configured — good for build speed.");
      } else {
        issues.push("No caching configured — consider caching dependencies to improve build times.");
      }

      // Test step presence
      if (/test|jest|vitest|pytest|go test|cargo test/.test(content.toLowerCase())) {
        good.push("Test step detected in pipeline.");
      } else {
        issues.push("No test step detected — ensure tests run in CI.");
      }

      // Lint step
      if (/lint|eslint|tslint|flake8|pylint|golint/.test(content.toLowerCase())) {
        good.push("Lint step detected.");
      } else {
        issues.push("No lint step detected — consider adding linting to catch code quality issues early.");
      }

      // Build step
      if (/build|compile|tsc|webpack|vite/.test(content.toLowerCase())) {
        good.push("Build step detected.");
      } else {
        issues.push("No explicit build step detected.");
      }

      // Timeout settings
      if (/timeout/.test(content)) {
        good.push("Job timeouts configured.");
      } else {
        issues.push("No job timeout configured — runaway jobs could consume credits indefinitely.");
      }

      // Permissions (GitHub Actions)
      if (ciFile.system === "GitHub Actions") {
        if (/permissions:/.test(content)) {
          good.push("Explicit permissions block found — good security practice.");
        } else {
          issues.push("No `permissions:` block — default to least-privilege by adding explicit permissions.");
        }
        if (/pull_request_target/.test(content)) {
          issues.push("WARNING: `pull_request_target` trigger can be dangerous if combined with checkout + run steps — review carefully.");
        }
      }

      // Docker security
      if (/docker/.test(content.toLowerCase())) {
        if (/trivy|snyk|grype|scan/.test(content.toLowerCase())) {
          good.push("Container vulnerability scanning detected.");
        } else {
          issues.push("Docker used but no container vulnerability scanning detected (consider Trivy, Snyk, or Grype).");
        }
      }

      if (good.length > 0) {
        sections.push("### What's Good");
        sections.push(good.map((g) => `- ${g}`).join("\n"));
      }

      if (issues.length > 0) {
        sections.push("\n### Issues Found");
        sections.push(issues.map((i) => `- ${i}`).join("\n"));
      } else {
        sections.push("\n### Issues Found\nNone detected.");
      }

      // Show first 30 lines
      sections.push("\n### Config Preview (first 30 lines)");
      sections.push("```yaml");
      sections.push(lines.slice(0, 30).join("\n"));
      if (lines.length > 30) sections.push(`... (${lines.length - 30} more lines)`);
      sections.push("```");
    }

    return textResult(sections.join("\n"));
  },
};

// ── incident_triage ────────────────────────────────────────────────────────

export const incidentTriageTool: PiTool = {
  name: "incident_triage",
  label: "Incident Triage",
  description:
    "Parse error logs or stack traces and return a structured triage: error classification, affected components, suggested root cause, and severity estimate.",
  parameters: Type.Object({
    error_text: Type.String({
      description: "Error message, log output, or stack trace to triage.",
    }),
    service_name: Type.Optional(
      Type.String({ description: "Name of the service that produced the error." }),
    ),
  }),

  async execute(_id, input) {
    const { error_text, service_name } = input as {
      error_text: string;
      service_name?: string;
    };

    const sections: string[] = [];
    sections.push("# Incident Triage");
    if (service_name) sections.push(`**Service**: ${service_name}`);
    sections.push(`**Timestamp**: ${new Date().toISOString()}\n`);

    // ── Error Classification ──
    const lower = error_text.toLowerCase();
    let classification = "Unknown";
    let severity: "critical" | "high" | "medium" | "low" = "medium";

    if (/oom|out of memory|heap|allocation failed/i.test(error_text)) {
      classification = "Memory Exhaustion (OOM)";
      severity = "critical";
    } else if (/econnrefused|connection refused|connect timeout/i.test(error_text)) {
      classification = "Connection Failure — downstream service unreachable";
      severity = "high";
    } else if (/timeout|timed out|deadline exceeded/i.test(lower)) {
      classification = "Timeout — operation exceeded allowed time";
      severity = "high";
    } else if (/enoent|no such file/i.test(error_text)) {
      classification = "File Not Found (ENOENT)";
      severity = "medium";
    } else if (/permission denied|eacces|forbidden|403/i.test(error_text)) {
      classification = "Permission/Authorization Failure";
      severity = "high";
    } else if (/401|unauthorized|auth.*fail/i.test(error_text)) {
      classification = "Authentication Failure";
      severity = "high";
    } else if (/500|internal server error/i.test(error_text)) {
      classification = "Internal Server Error (500)";
      severity = "high";
    } else if (/502|bad gateway/i.test(error_text)) {
      classification = "Bad Gateway (502) — upstream server down";
      severity = "critical";
    } else if (/503|service unavailable/i.test(error_text)) {
      classification = "Service Unavailable (503)";
      severity = "critical";
    } else if (/typeerror/i.test(error_text)) {
      classification = "TypeError — null/undefined access or wrong type";
      severity = "medium";
    } else if (/syntaxerror/i.test(error_text)) {
      classification = "SyntaxError — malformed code or data";
      severity = "medium";
    } else if (/cannot read prop/i.test(lower)) {
      classification = "Null/Undefined Property Access";
      severity = "medium";
    } else if (/segfault|segmentation fault|sigsegv/i.test(error_text)) {
      classification = "Segmentation Fault — memory corruption";
      severity = "critical";
    } else if (/disk full|no space left/i.test(error_text)) {
      classification = "Disk Full — storage exhausted";
      severity = "critical";
    }

    sections.push("## Error Classification");
    sections.push(`- **Type**: ${classification}`);
    sections.push(`- **Severity**: ${severity.toUpperCase()}`);

    // ── Affected Components ──
    const components: string[] = [];

    const frameRe = /at\s+(?:\S+\s+\()?([^():]+):(\d+)(?::(\d+))?\)?/g;
    let match;
    const frames: Array<{ file: string; line: number }> = [];
    while ((match = frameRe.exec(error_text)) !== null) {
      const file = match[1].trim();
      if (!file.includes("node_modules") && !file.includes("node:")) {
        frames.push({ file, line: parseInt(match[2], 10) });
      }
    }

    for (const frame of frames.slice(0, 5)) {
      const parts = frame.file.split("/");
      const mod = parts.find((p) =>
        !["src", "lib", "dist", "build", "app"].includes(p) && p.length > 1,
      );
      if (mod && !components.includes(mod)) {
        components.push(mod);
      }
    }

    sections.push("\n## Affected Components");
    if (components.length > 0) {
      sections.push(components.map((c) => `- ${c}`).join("\n"));
    } else {
      sections.push("- Unable to identify specific components from the error text.");
    }

    if (frames.length > 0) {
      sections.push("\n## Stack Trace (user code)");
      for (const f of frames.slice(0, 8)) {
        sections.push(`- \`${f.file}\` line ${f.line}`);
      }
    }

    // ── Root Cause Suggestions ──
    sections.push("\n## Suggested Root Cause");
    const suggestions: string[] = [];

    if (/oom|out of memory/i.test(error_text)) {
      suggestions.push("Memory leak or unbounded data structure growth.");
    }
    if (/econnrefused|connection refused/i.test(error_text)) {
      suggestions.push("Downstream service is not running or not reachable. Verify service health and network policies.");
    }
    if (/timeout/i.test(lower)) {
      suggestions.push("Operation too slow. Check for slow queries, network latency, or resource contention.");
    }
    if (/cannot read prop/i.test(lower) || /typeerror/i.test(lower)) {
      suggestions.push("Null/undefined value accessed. Verify async operations complete before accessing results.");
    }
    if (suggestions.length === 0) {
      suggestions.push("Review stack frames and check recent deployments for regressions.");
    }

    sections.push(suggestions.map((s) => `- ${s}`).join("\n"));

    // ── Recommended Actions ──
    sections.push("\n## Recommended Actions");
    if (severity === "critical") {
      sections.push("1. Page on-call engineer and escalate.");
      sections.push("2. Consider rollback if error correlates with recent deployment.");
      sections.push("3. Post to #incidents channel.");
    } else if (severity === "high") {
      sections.push("1. Check monitoring dashboards for correlated anomalies.");
      sections.push("2. Attempt to reproduce in staging.");
      sections.push("3. Implement fix or temporary workaround.");
    } else {
      sections.push("1. Ensure error is logged with context.");
      sections.push("2. Create a ticket to investigate.");
      sections.push("3. Set up alert if error recurs frequently.");
    }

    return textResult(sections.join("\n"));
  },
};

// ── ci_generate ──────────────────────────────────────────────────────────────

export const ciGenerateTool: PiTool = {
  name: "ci_generate",
  label: "CI Generate",
  description:
    "Detect the project stack from config files and generate a CI/CD workflow (GitHub Actions or GitLab CI) with appropriate build, test, and lint steps.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Root directory of the project.",
    }),
    target: Type.Optional(
      Type.Union(
        [Type.Literal("github-actions"), Type.Literal("gitlab-ci")],
        { description: "CI system to generate for. Default: github-actions." },
      ),
    ),
  }),

  async execute(_id, input) {
    const { directory, target = "github-actions" } = input as {
      directory: string;
      target?: "github-actions" | "gitlab-ci";
    };

    let rootFiles: string[];
    try {
      rootFiles = await readdir(directory);
    } catch (err) {
      return textResult(`Error reading directory: ${(err as Error).message}`);
    }

    const rootSet = new Set(rootFiles.map((f) => f.toLowerCase()));

    interface StackInfo {
      language: string;
      runtime: string;
      packageManager: string;
      hasTests: boolean;
      hasLint: boolean;
      hasBuild: boolean;
      runtimeVersion: string;
    }

    const stack: StackInfo = {
      language: "unknown",
      runtime: "unknown",
      packageManager: "unknown",
      hasTests: false,
      hasLint: false,
      hasBuild: false,
      runtimeVersion: "lts/*",
    };

    if (rootSet.has("package.json")) {
      stack.language = "typescript";
      stack.runtime = "node";

      try {
        const pkg = JSON.parse(await readFileSafe(join(directory, "package.json")));
        const scripts = pkg.scripts ?? {};
        stack.hasTests = !!scripts.test;
        stack.hasLint = !!scripts.lint;
        stack.hasBuild = !!scripts.build;

        if (rootSet.has("bun.lockb") || rootSet.has("bun.lock")) {
          stack.packageManager = "bun";
        } else if (rootSet.has("pnpm-lock.yaml")) {
          stack.packageManager = "pnpm";
        } else if (rootSet.has("yarn.lock")) {
          stack.packageManager = "yarn";
        } else {
          stack.packageManager = "npm";
        }

        stack.language = rootSet.has("tsconfig.json") ? "typescript" : "javascript";

        if (pkg.engines?.node) {
          const m = pkg.engines.node.match(/(\d+)/);
          if (m) stack.runtimeVersion = m[1];
        }
      } catch {
        stack.packageManager = "npm";
      }
    } else if (rootSet.has("pyproject.toml") || rootSet.has("requirements.txt")) {
      stack.language = "python";
      stack.runtime = "python";
      stack.runtimeVersion = "3.12";
      stack.packageManager = rootSet.has("pyproject.toml") ? "uv" : "pip";
      stack.hasTests = true;
      stack.hasLint = true;
      stack.hasBuild = rootSet.has("pyproject.toml");
    } else if (rootSet.has("go.mod")) {
      stack.language = "go";
      stack.runtime = "go";
      stack.runtimeVersion = "1.22";
      stack.packageManager = "go";
      stack.hasTests = true;
      stack.hasLint = true;
      stack.hasBuild = true;
    } else if (rootSet.has("cargo.toml")) {
      stack.language = "rust";
      stack.runtime = "rust";
      stack.runtimeVersion = "stable";
      stack.packageManager = "cargo";
      stack.hasTests = true;
      stack.hasLint = true;
      stack.hasBuild = true;
    }

    const yaml =
      target === "github-actions"
        ? generateGitHubActionsYaml(stack)
        : generateGitLabCIYaml(stack);

    const sections: string[] = [];
    sections.push(`# Generated CI Config: ${target}`);
    sections.push(`\n## Detected Stack`);
    sections.push(`- Language: ${stack.language}`);
    sections.push(`- Runtime: ${stack.runtime} ${stack.runtimeVersion}`);
    sections.push(`- Package Manager: ${stack.packageManager}`);
    sections.push(`- Tests: ${stack.hasTests ? "detected" : "not detected"}`);
    sections.push(`- Lint: ${stack.hasLint ? "detected" : "not detected"}`);
    sections.push(`- Build: ${stack.hasBuild ? "detected" : "not detected"}`);
    sections.push(`\n## Generated Workflow\n`);
    sections.push("```yaml");
    sections.push(yaml);
    sections.push("```");

    return textResult(sections.join("\n"));
  },
};

function generateGitHubActionsYaml(stack: {
  runtime: string;
  packageManager: string;
  hasTests: boolean;
  hasLint: boolean;
  hasBuild: boolean;
  runtimeVersion: string;
}): string {
  const l: string[] = [];
  l.push("name: CI", "", "on:", "  push:", "    branches: [main]", "  pull_request:", "    branches: [main]");
  l.push("", "permissions:", "  contents: read", "", "jobs:", "  ci:", "    runs-on: ubuntu-latest", "    timeout-minutes: 15", "    steps:", "      - uses: actions/checkout@v4");

  if (stack.runtime === "node") {
    if (stack.packageManager === "bun") {
      l.push("      - uses: oven-sh/setup-bun@v2", "      - run: bun install");
      if (stack.hasLint) l.push("      - run: bun run lint");
      if (stack.hasBuild) l.push("      - run: bun run build");
      if (stack.hasTests) l.push("      - run: bun test");
    } else {
      l.push("      - uses: actions/setup-node@v4", "        with:", `          node-version: '${stack.runtimeVersion}'`);
      if (stack.packageManager !== "npm") l.push(`          cache: '${stack.packageManager}'`);
      if (stack.packageManager === "pnpm") l.push("      - run: corepack enable");
      const inst = stack.packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : stack.packageManager === "yarn" ? "yarn install --frozen-lockfile" : "npm ci";
      const run = stack.packageManager === "npm" ? "npm run" : stack.packageManager;
      l.push(`      - run: ${inst}`);
      if (stack.hasLint) l.push(`      - run: ${run} lint`);
      if (stack.hasBuild) l.push(`      - run: ${run} build`);
      if (stack.hasTests) l.push(`      - run: ${run} test`);
    }
  } else if (stack.runtime === "python") {
    l.push("      - uses: actions/setup-python@v5", "        with:", `          python-version: '${stack.runtimeVersion}'`);
    if (stack.packageManager === "uv") {
      l.push("      - uses: astral-sh/setup-uv@v4", "      - run: uv sync");
      if (stack.hasLint) l.push("      - run: uv run ruff check .");
      if (stack.hasTests) l.push("      - run: uv run pytest");
    } else {
      l.push("      - run: pip install -r requirements.txt");
      if (stack.hasTests) l.push("      - run: pytest");
    }
  } else if (stack.runtime === "go") {
    l.push("      - uses: actions/setup-go@v5", "        with:", `          go-version: '${stack.runtimeVersion}'`);
    l.push("      - run: go build ./...", "      - run: go vet ./...", "      - run: go test ./...");
  } else if (stack.runtime === "rust") {
    l.push("      - uses: dtolnay/rust-toolchain@stable", "      - run: cargo build", "      - run: cargo clippy -- -D warnings", "      - run: cargo test");
  }

  return l.join("\n");
}

function generateGitLabCIYaml(stack: {
  runtime: string;
  packageManager: string;
  hasTests: boolean;
  hasLint: boolean;
  hasBuild: boolean;
  runtimeVersion: string;
}): string {
  const l: string[] = [];
  l.push("stages:", "  - lint", "  - build", "  - test", "");

  if (stack.runtime === "node") {
    const img = stack.packageManager === "bun" ? "oven/bun:latest" : `node:${stack.runtimeVersion}`;
    l.push(`image: ${img}`, "");
    const inst = stack.packageManager === "bun" ? "bun install" : stack.packageManager === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile" : stack.packageManager === "yarn" ? "yarn install --frozen-lockfile" : "npm ci";
    const run = stack.packageManager === "bun" ? "bun run" : stack.packageManager === "npm" ? "npm run" : stack.packageManager;
    l.push("before_script:", `  - ${inst}`, "");
    if (stack.hasLint) l.push("lint:", "  stage: lint", `  script: ${run} lint`, "");
    if (stack.hasBuild) l.push("build:", "  stage: build", `  script: ${run} build`, "");
    if (stack.hasTests) l.push("test:", "  stage: test", `  script: ${run} test`);
  } else if (stack.runtime === "python") {
    l.push(`image: python:${stack.runtimeVersion}`, "", "test:", "  stage: test", "  script:", "    - pip install -r requirements.txt", "    - pytest");
  } else if (stack.runtime === "go") {
    l.push(`image: golang:${stack.runtimeVersion}`, "", "build:", "  stage: build", "  script: go build ./...", "", "test:", "  stage: test", "  script: go test ./...");
  } else if (stack.runtime === "rust") {
    l.push("image: rust:latest", "", "build:", "  stage: build", "  script: cargo build", "", "lint:", "  stage: lint", "  script: cargo clippy -- -D warnings", "", "test:", "  stage: test", "  script: cargo test");
  }

  return l.join("\n");
}
