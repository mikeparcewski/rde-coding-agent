/**
 * Delivery domain tools.
 *
 * A/B experiment design, risk assessment, and progress reporting from git.
 */

import { Type } from "@sinclair/typebox";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
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

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

// ── experiment_design ─────────────────────────────────────────────────────────

export const experimentDesignTool: PiTool = {
  name: "experiment_design",
  label: "A/B Experiment Design",
  description:
    "Designs a rigorous A/B test with hypothesis, primary/secondary metrics, sample size estimation, and rollout plan.",
  parameters: Type.Object({
    feature: Type.String({
      description: "Name of the feature or change to test.",
    }),
    hypothesis: Type.String({
      description: "The hypothesis to test (e.g. 'showing social proof increases sign-up rate').",
    }),
    primary_metric: Type.String({
      description: "The primary metric to measure (e.g. 'conversion rate', 'revenue per user').",
    }),
    baseline_rate: Type.Optional(
      Type.Number({
        description: "Current baseline rate for the primary metric (0-1 or absolute value).",
      }),
    ),
    minimum_detectable_effect: Type.Optional(
      Type.Number({
        description: "Minimum relative change to detect (e.g. 0.05 for 5%). Default: 0.05.",
        minimum: 0.001,
        maximum: 1,
      }),
    ),
    confidence_level: Type.Optional(
      Type.Number({
        description: "Statistical confidence level (e.g. 0.95). Default: 0.95.",
        minimum: 0.8,
        maximum: 0.99,
      }),
    ),
    daily_traffic: Type.Optional(
      Type.Number({
        description: "Daily traffic or user count for the relevant surface.",
        minimum: 1,
      }),
    ),
  }),

  async execute(_id, input) {
    const {
      feature,
      hypothesis,
      primary_metric,
      baseline_rate,
      minimum_detectable_effect = 0.05,
      confidence_level = 0.95,
      daily_traffic,
    } = input as {
      feature: string;
      hypothesis: string;
      primary_metric: string;
      baseline_rate?: number;
      minimum_detectable_effect?: number;
      confidence_level?: number;
      daily_traffic?: number;
    };

    const sections: string[] = [];
    sections.push(`# A/B Experiment Design: ${feature}`);
    sections.push(`Date: ${new Date().toISOString().split("T")[0]}\n`);

    sections.push("## Hypothesis");
    sections.push(`**H0 (null)**: ${feature} has no effect on ${primary_metric}.`);
    sections.push(`**H1 (alternative)**: ${hypothesis}`);
    sections.push(`**Direction**: Two-tailed test (detect both positive and negative effects)\n`);

    sections.push("## Metrics");
    sections.push(`**Primary metric**: ${primary_metric}`);
    if (baseline_rate !== undefined) {
      sections.push(`**Baseline rate**: ${(baseline_rate * 100).toFixed(2)}%`);
      const mdeAbs = baseline_rate * minimum_detectable_effect;
      sections.push(`**MDE (relative)**: ${(minimum_detectable_effect * 100).toFixed(1)}%`);
      sections.push(`**MDE (absolute)**: ${(mdeAbs * 100).toFixed(3)}%`);
    }

    sections.push(`\n**Secondary metrics** (guardrail metrics to monitor for harm):`);
    sections.push(`- Session duration`);
    sections.push(`- Error rate / 5xx rate`);
    sections.push(`- User retention (Day 1, Day 7)`);
    sections.push(`- Customer support ticket volume`);
    sections.push(`- Revenue per user (if primary is not revenue)`);

    // Sample size calculation (simplified using normal approximation)
    sections.push("\n## Sample Size Estimation");

    if (baseline_rate !== undefined && baseline_rate > 0 && baseline_rate < 1) {
      // z-scores for common confidence levels
      const zAlpha: Record<number, number> = {
        0.80: 1.282,
        0.85: 1.440,
        0.90: 1.645,
        0.95: 1.960,
        0.99: 2.576,
      };
      const closestAlpha = Object.keys(zAlpha)
        .map(Number)
        .reduce((a, b) => Math.abs(b - confidence_level) < Math.abs(a - confidence_level) ? b : a);
      const z = zAlpha[closestAlpha] ?? 1.96;
      const power = 0.8; // 80% power (z = 0.842)
      const zPower = 0.842;

      const p1 = baseline_rate;
      const p2 = baseline_rate * (1 + minimum_detectable_effect);
      const pooledP = (p1 + p2) / 2;
      const n = Math.ceil(
        2 * pooledP * (1 - pooledP) * Math.pow(z + zPower, 2) / Math.pow(p2 - p1, 2),
      );

      sections.push(`Using: confidence = ${(confidence_level * 100).toFixed(0)}% (α = ${(1 - confidence_level).toFixed(2)}), power = ${(power * 100).toFixed(0)}%\n`);
      sections.push(`**Required sample size per variant**: ~${n.toLocaleString()} users`);
      sections.push(`**Total required**: ~${(n * 2).toLocaleString()} users (both variants combined)`);

      if (daily_traffic) {
        const daysNeeded = Math.ceil((n * 2) / daily_traffic);
        sections.push(`**Estimated experiment duration**: ~${daysNeeded} day(s) at ${daily_traffic.toLocaleString()} users/day`);

        if (daysNeeded < 7) {
          sections.push(`> Note: Running for fewer than 7 days risks day-of-week bias. Consider running for at least 1-2 full business cycles.`);
        }
        if (daysNeeded > 90) {
          sections.push(`> Warning: Experiment would take > 90 days. Consider increasing MDE or focusing on a higher-traffic surface.`);
        }
      }
    } else {
      sections.push("Provide `baseline_rate` to get a precise sample size estimate.\n");
      sections.push("**Rule of thumb**: Most A/B tests require 1,000–10,000 users per variant to detect a 5% relative change at 95% confidence.");
    }

    // Traffic allocation
    sections.push("\n## Traffic Allocation");
    sections.push("| Variant | Traffic % | Description |");
    sections.push("|---------|-----------|-------------|");
    sections.push("| Control (A) | 50% | Existing behavior |");
    sections.push(`| Treatment (B) | 50% | ${feature} |`);
    sections.push("> Adjust to 90/10 initially for a ramp if risk is high.\n");

    // Rollout plan
    sections.push("## Rollout Plan");
    sections.push("| Phase | Traffic | Duration | Decision |");
    sections.push("|-------|---------|----------|----------|");
    sections.push("| Phase 1: Canary | 5% | 1 day | Check for crashes, errors, performance regressions |");
    sections.push("| Phase 2: Ramp | 20% | 2-3 days | Monitor guardrail metrics |");
    sections.push("| Phase 3: Full | 50/50 | Until sample size reached | Collect statistically significant data |");
    sections.push("| Phase 4: Decision | N/A | 1 day | Ship or rollback based on results |");

    // Stopping criteria
    sections.push("\n## Stopping Rules");
    sections.push("**Early stopping for harm**:");
    sections.push("- Stop if error rate increases by > 20% relative in the treatment group.");
    sections.push("- Stop if primary metric shows > 10% negative relative change with p < 0.01.");
    sections.push("");
    sections.push("**Do NOT stop early for positive results** — peeking inflates false positive rate.");

    // Analysis plan
    sections.push("\n## Analysis Plan");
    sections.push("1. **Pre-registration**: Document this plan before the experiment starts.");
    sections.push("2. **Randomization check**: Verify variants are balanced on key dimensions (device, geography, user segment).");
    sections.push("3. **Statistical test**: Use two-proportion z-test for conversion rates; t-test for continuous metrics.");
    sections.push("4. **Segmentation analysis**: Break results down by device, new vs. returning users, traffic source.");
    sections.push("5. **Long-term effects**: Schedule a 30-day follow-up analysis to check for novelty effects.");

    // Decision framework
    sections.push("\n## Decision Framework");
    sections.push("| Outcome | Decision |");
    sections.push("|---------|----------|");
    sections.push("| p < α AND primary metric positive | Ship treatment |");
    sections.push("| p < α AND primary metric negative | Rollback |");
    sections.push("| p > α (no significant result) | Do not ship (no effect detected) — revisit hypothesis |");
    sections.push("| Mixed results (primary positive, guardrail negative) | Further investigation required |");

    return textResult(sections.join("\n"));
  },
};

// ── risk_assess ───────────────────────────────────────────────────────────────

export const riskAssessTool: PiTool = {
  name: "risk_assess",
  label: "Delivery Risk Assessment",
  description:
    "Reads project files to identify technical, delivery, and operational risks with mitigation strategies.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Project root directory to analyze.",
    }),
  }),

  async execute(_id, input) {
    const { directory } = input as { directory: string };

    const sections: string[] = [];
    sections.push(`# Delivery Risk Assessment: \`${directory}\``);
    sections.push(`Assessment date: ${new Date().toISOString().split("T")[0]}\n`);

    // Read project files
    let rootFiles: string[];
    try {
      rootFiles = (await readdir(directory)).map((f) => f.toLowerCase());
    } catch (err) {
      return textResult(`Error reading directory: ${(err as Error).message}`);
    }

    // Package.json analysis
    let pkg: Record<string, unknown> = {};
    if (rootFiles.includes("package.json")) {
      try {
        pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf-8"));
      } catch {
        // ignore
      }
    }

    type Risk = {
      id: string;
      category: string;
      severity: "critical" | "high" | "medium" | "low";
      title: string;
      description: string;
      mitigation: string;
    };

    const risks: Risk[] = [];

    // ── Technical Risks ──
    const deps = { ...(pkg["dependencies"] as Record<string, string> ?? {}), ...(pkg["devDependencies"] as Record<string, string> ?? {}) };

    // Outdated/pinned dependencies
    const pinnedDeps = Object.entries(deps).filter(([, v]) => typeof v === "string" && /^\d/.test(v));
    if (pinnedDeps.length > 0) {
      risks.push({
        id: "T-01", category: "Technical", severity: "medium",
        title: "Pinned dependency versions",
        description: `${pinnedDeps.length} dependencies use pinned versions — may accumulate security vulnerabilities over time.`,
        mitigation: "Run `npm audit` regularly; use Dependabot or Renovate for automated updates.",
      });
    }

    // No lock file
    const hasLockFile = rootFiles.some((f) => ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"].includes(f));
    if (!hasLockFile && rootFiles.includes("package.json")) {
      risks.push({
        id: "T-02", category: "Technical", severity: "high",
        title: "No dependency lock file",
        description: "Without a lock file, dependency versions can vary between environments, causing 'works on my machine' issues.",
        mitigation: "Commit `package-lock.json` or `yarn.lock` to version control.",
      });
    }

    // No tests
    const hasTestDir = rootFiles.some((f) => ["test", "tests", "__tests__", "spec"].includes(f));
    const hasTestScript = typeof pkg["scripts"] === "object" && "test" in (pkg["scripts"] as object);
    if (!hasTestDir && !hasTestScript) {
      risks.push({
        id: "T-03", category: "Technical", severity: "high",
        title: "No test suite detected",
        description: "Without automated tests, regressions will only be caught in production.",
        mitigation: "Add unit tests for critical paths. Start with smoke tests for the main entry points.",
      });
    }

    // No TypeScript types check
    const hasTypeCheck = typeof pkg["scripts"] === "object" &&
      Object.values(pkg["scripts"] as Record<string, string>).some((s) => /tsc|type.?check/i.test(s));
    if (rootFiles.includes("tsconfig.json") && !hasTypeCheck) {
      risks.push({
        id: "T-04", category: "Technical", severity: "medium",
        title: "TypeScript not included in CI scripts",
        description: "TypeScript errors won't be caught automatically before deployment.",
        mitigation: "Add `tsc --noEmit` to CI pipeline.",
      });
    }

    // ── Delivery Risks ──
    const hasCI = rootFiles.some((f) => f === ".github") ||
      rootFiles.includes(".gitlab-ci.yml") ||
      rootFiles.includes(".circleci");
    if (!hasCI) {
      risks.push({
        id: "D-01", category: "Delivery", severity: "high",
        title: "No CI/CD pipeline detected",
        description: "Manual deployments are error-prone and slow release velocity.",
        mitigation: "Set up a CI/CD pipeline with automated testing and deployment.",
      });
    }

    const hasChangelog = rootFiles.includes("changelog.md") || rootFiles.includes("history.md");
    if (!hasChangelog) {
      risks.push({
        id: "D-02", category: "Delivery", severity: "low",
        title: "No CHANGELOG",
        description: "No release history documented — hard to track what changed between versions.",
        mitigation: "Maintain a CHANGELOG.md; consider conventional commits + semantic-release.",
      });
    }

    // Git analysis
    const gitLog = runGit(["log", "--oneline", "-20"], directory);
    if (!gitLog) {
      risks.push({
        id: "D-03", category: "Delivery", severity: "medium",
        title: "Cannot read git history",
        description: "Not a git repository, or git is not available.",
        mitigation: "Initialize git and maintain version control for all project files.",
      });
    } else {
      const commits = gitLog.trim().split("\n").filter(Boolean);
      // Check for large commits
      const gitStats = runGit(["log", "--shortstat", "-5"], directory);
      if (gitStats) {
        const changedFiles = gitStats.match(/(\d+) file/g)?.map((m) => parseInt(m)) ?? [];
        const bigCommits = changedFiles.filter((n) => n > 50);
        if (bigCommits.length > 0) {
          risks.push({
            id: "D-04", category: "Delivery", severity: "medium",
            title: "Large commits detected",
            description: `${bigCommits.length} recent commit(s) changed 50+ files — large commits are hard to review and risky to deploy.`,
            mitigation: "Break large changes into smaller, focused commits for easier review and rollback.",
          });
        }
      }

      // Check commit message quality
      const badMessages = commits.filter((c) => /^[a-z0-9]+\s+(fix|wip|update|changes|misc|temp|test)\.?$/i.test(c));
      if (badMessages.length > 3) {
        risks.push({
          id: "D-05", category: "Delivery", severity: "low",
          title: "Low-quality commit messages",
          description: `${badMessages.length} recent commits have non-descriptive messages — makes tracing regressions harder.`,
          mitigation: "Adopt conventional commits standard: `feat:`, `fix:`, `chore:` prefixes.",
        });
      }
    }

    // ── Operational Risks ──
    if (!rootFiles.includes("security.md")) {
      risks.push({
        id: "O-01", category: "Operational", severity: "medium",
        title: "No SECURITY.md policy",
        description: "No documented security vulnerability reporting process.",
        mitigation: "Add SECURITY.md with vulnerability disclosure policy and contact.",
      });
    }

    const hasMonitoring = rootFiles.some((f) => /sentry|datadog|newrelic|rollbar|bugsnag|monitoring|observab/.test(f));
    const pkgDeps = Object.keys(deps).join(" ").toLowerCase();
    const hasMonitoringDep = /sentry|datadog|newrelic|rollbar|bugsnag|opentelemetry/.test(pkgDeps);
    if (!hasMonitoring && !hasMonitoringDep) {
      risks.push({
        id: "O-02", category: "Operational", severity: "high",
        title: "No error monitoring detected",
        description: "Without error monitoring, production failures may go undetected.",
        mitigation: "Add Sentry, Datadog, or similar error monitoring.",
      });
    }

    // Group and display risks
    const bySeverity: Record<string, Risk[]> = { critical: [], high: [], medium: [], low: [] };
    for (const r of risks) bySeverity[r.severity].push(r);

    sections.push("## Risk Summary");
    sections.push(`| Severity | Count |`);
    sections.push(`|----------|-------|`);
    sections.push(`| Critical | ${bySeverity.critical.length} |`);
    sections.push(`| High | ${bySeverity.high.length} |`);
    sections.push(`| Medium | ${bySeverity.medium.length} |`);
    sections.push(`| Low | ${bySeverity.low.length} |`);
    sections.push(`| **Total** | **${risks.length}** |`);
    sections.push("");

    const order: Array<Risk["severity"]> = ["critical", "high", "medium", "low"];
    for (const sev of order) {
      if (bySeverity[sev].length === 0) continue;
      sections.push(`## ${sev.charAt(0).toUpperCase() + sev.slice(1)} Risks`);
      for (const r of bySeverity[sev]) {
        sections.push(`\n### ${r.id}: ${r.title} [${r.category}]`);
        sections.push(`**Description**: ${r.description}`);
        sections.push(`**Mitigation**: ${r.mitigation}`);
      }
      sections.push("");
    }

    if (risks.length === 0) {
      sections.push("**No significant risks detected.** Continue monitoring as the project evolves.");
    }

    return textResult(sections.join("\n"));
  },
};

// ── rollout_plan ──────────────────────────────────────────────────────────────

export const rolloutPlanTool: PiTool = {
  name: "rollout_plan",
  label: "Rollout Plan",
  description:
    "Generates a risk-aware deployment rollout strategy with staged percentages, monitoring checklist, and rollback triggers.",
  parameters: Type.Object({
    feature: Type.String({
      description: "Feature name or description to roll out.",
    }),
    risk_level: Type.Optional(
      Type.Union(
        [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
        { description: "Risk level. If not provided, auto-detected from feature description." },
      ),
    ),
  }),

  async execute(_id, input) {
    const { feature, risk_level } = input as {
      feature: string;
      risk_level?: "low" | "medium" | "high";
    };

    // Auto-detect risk level if not provided
    let detectedLevel: "low" | "medium" | "high" = risk_level ?? "low";
    let detectionReason = "Default (no keywords matched)";
    const detectionFactors: string[] = [];

    if (!risk_level) {
      const fl = feature.toLowerCase();
      const highKeywords = ["database", "migration", "auth", "payment", "security", "infrastructure"];
      const mediumKeywords = ["api", "ui", "config", "integration", "dependency"];
      const lowKeywords = ["docs", "style", "logging", "test", "refactor"];

      const matchedHigh = highKeywords.filter((k) => fl.includes(k));
      const matchedMedium = mediumKeywords.filter((k) => fl.includes(k));
      const matchedLow = lowKeywords.filter((k) => fl.includes(k));

      if (matchedHigh.length > 0) {
        detectedLevel = "high";
        detectionFactors.push(...matchedHigh);
        detectionReason = `High-risk keywords detected: ${matchedHigh.join(", ")}`;
      } else if (matchedMedium.length > 0) {
        detectedLevel = "medium";
        detectionFactors.push(...matchedMedium);
        detectionReason = `Medium-risk keywords detected: ${matchedMedium.join(", ")}`;
      } else if (matchedLow.length > 0) {
        detectedLevel = "low";
        detectionFactors.push(...matchedLow);
        detectionReason = `Low-risk keywords detected: ${matchedLow.join(", ")}`;
      }
    } else {
      detectionReason = "Explicitly provided by caller";
      detectionFactors.push(`risk_level = ${risk_level}`);
    }

    // Build strategy based on risk level
    type Stage = { percentage: number; duration: string; criteria: string };
    let strategyType: string;
    let stages: Stage[];
    let estimatedDuration: string;

    if (detectedLevel === "low") {
      strategyType = "Big-bang deployment";
      stages = [
        { percentage: 100, duration: "Immediate", criteria: "No errors in first 30 minutes; error rate stable" },
      ];
      estimatedDuration = "< 1 day";
    } else if (detectedLevel === "medium") {
      strategyType = "Progressive rollout";
      stages = [
        { percentage: 10, duration: "24 hours", criteria: "Error rate < 0.5%, latency within 10% baseline" },
        { percentage: 25, duration: "24 hours", criteria: "All metrics stable, no regressions" },
        { percentage: 50, duration: "24 hours", criteria: "CPU/memory within 20% baseline, queue depth normal" },
        { percentage: 100, duration: "Final", criteria: "Full rollout — monitor for 24h post-completion" },
      ];
      estimatedDuration = "3–4 days";
    } else {
      strategyType = "Canary deployment";
      stages = [
        { percentage: 1, duration: "48 hours", criteria: "Zero critical errors; business metrics not degraded" },
        { percentage: 5, duration: "48 hours", criteria: "Error rate < 0.1%, data integrity verified" },
        { percentage: 10, duration: "48 hours", criteria: "Latency p99 within 5% baseline" },
        { percentage: 25, duration: "48 hours", criteria: "User satisfaction metrics stable" },
        { percentage: 50, duration: "48 hours", criteria: "Business metrics (conversion, revenue) unchanged" },
        { percentage: 100, duration: "Final", criteria: "Full rollout — 72h close monitoring" },
      ];
      estimatedDuration = "10–12 days";
    }

    // Monitoring checklist
    const monitoring: string[] = [
      "Error rate (5xx, unhandled exceptions)",
      "Latency p50 / p95 / p99",
      "Throughput (requests/sec)",
    ];
    if (detectedLevel === "medium" || detectedLevel === "high") {
      monitoring.push("CPU utilization per instance");
      monitoring.push("Memory utilization");
      monitoring.push("Database connection pool usage");
      monitoring.push("Queue depth / backlog");
    }
    if (detectedLevel === "high") {
      monitoring.push("Business metrics (conversion rate, revenue per user)");
      monitoring.push("User satisfaction (CSAT / NPS if available)");
      monitoring.push("Data integrity checks (row counts, consistency assertions)");
    }

    // Rollback triggers
    const errorThreshold = detectedLevel === "low" ? "1%" : detectedLevel === "medium" ? "0.5%" : "0.1%";
    const latencyThreshold = detectedLevel === "low" ? "50%" : detectedLevel === "medium" ? "25%" : "10%";

    const rollbackTriggers: string[] = [
      `Error rate exceeds ${errorThreshold} (relative to baseline)`,
      `Latency p99 increases by more than ${latencyThreshold} over baseline`,
      "Any service returning 5xx at > 2x normal rate",
    ];
    if (detectedLevel === "medium" || detectedLevel === "high") {
      rollbackTriggers.push("Database connection errors or pool exhaustion");
      rollbackTriggers.push("Queue depth grows unbounded (> 2x normal backlog)");
    }
    if (detectedLevel === "high") {
      rollbackTriggers.push("Business metric (e.g. conversion) drops > 5% relative");
      rollbackTriggers.push("Data integrity assertion failure");
      rollbackTriggers.push("Any security-related anomaly");
    }

    const result = {
      feature,
      riskLevel: detectedLevel,
      riskAssessment: {
        level: detectedLevel,
        reason: detectionReason,
        factors: detectionFactors,
      },
      strategy: {
        type: strategyType,
        stages,
      },
      monitoring,
      rollbackTriggers,
      estimatedDuration,
    };

    return textResult(JSON.stringify(result, null, 2));
  },
};

// ── progress_report ───────────────────────────────────────────────────────────

export const progressReportTool: PiTool = {
  name: "progress_report",
  label: "Progress Report",
  description:
    "Reads recent git commits and generates a structured progress report with completed work, in-progress items, and next steps.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Git repository directory.",
    }),
    days: Type.Optional(
      Type.Number({
        description: "Number of days of history to include. Default: 7.",
        minimum: 1,
        maximum: 90,
      }),
    ),
    author: Type.Optional(
      Type.String({ description: "Filter commits by author name or email." }),
    ),
  }),

  async execute(_id, input) {
    const { directory, days = 7, author } = input as {
      directory: string;
      days?: number;
      author?: string;
    };

    const sections: string[] = [];
    sections.push(`# Progress Report`);
    sections.push(`Period: Last ${days} day(s)`);
    sections.push(`Repository: \`${directory}\``);
    sections.push(`Generated: ${new Date().toISOString().split("T")[0]}\n`);

    // Fetch git log
    const since = `--since=${days}.days.ago`;
    const authorArg = author ? [`--author=${author}`] : [];
    const logFormat = `--pretty=format:%H|%an|%ae|%aI|%s`;

    const rawLog = runGit(
      ["log", since, ...authorArg, logFormat, "--no-merges"],
      directory,
    );

    if (!rawLog.trim()) {
      sections.push("No commits found in the specified period.");
      if (author) sections.push(`Filter: author = "${author}"`);
      return textResult(sections.join("\n"));
    }

    type Commit = {
      hash: string;
      author: string;
      email: string;
      date: string;
      subject: string;
      type: string;
      scope?: string;
      breaking: boolean;
    };

    const commits: Commit[] = rawLog
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, authorName, email, date, ...subjectParts] = line.split("|");
        const subject = subjectParts.join("|");

        // Parse conventional commit format
        const ccMatch = subject?.match(/^(feat|fix|chore|docs|style|refactor|test|perf|ci|build|revert)(\(([^)]+)\))?(!)?:\s*(.+)/i);
        return {
          hash: hash?.slice(0, 8) ?? "",
          author: authorName ?? "unknown",
          email: email ?? "",
          date: date ?? "",
          subject: subject ?? "",
          type: ccMatch ? ccMatch[1].toLowerCase() : "other",
          scope: ccMatch?.[3],
          breaking: ccMatch?.[4] === "!" || /BREAKING CHANGE/.test(subject ?? ""),
        };
      });

    // Group by type
    const byType: Record<string, Commit[]> = {};
    for (const c of commits) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }

    // Stats
    const authors = [...new Set(commits.map((c) => c.author))];
    const breakingChanges = commits.filter((c) => c.breaking);

    sections.push("## Summary");
    sections.push(`- Total commits: ${commits.length}`);
    sections.push(`- Contributors: ${authors.join(", ")}`);
    if (breakingChanges.length > 0) {
      sections.push(`- **Breaking changes**: ${breakingChanges.length}`);
    }
    sections.push("");

    // Completed work by type
    const typeOrder = ["feat", "fix", "perf", "refactor", "docs", "test", "ci", "build", "chore", "style", "revert", "other"];
    const typeLabels: Record<string, string> = {
      feat: "New Features",
      fix: "Bug Fixes",
      perf: "Performance Improvements",
      refactor: "Refactoring",
      docs: "Documentation",
      test: "Testing",
      ci: "CI/CD",
      build: "Build System",
      chore: "Maintenance",
      style: "Code Style",
      revert: "Reverts",
      other: "Other Changes",
    };

    sections.push("## Completed Work");
    let hasWork = false;
    for (const type of typeOrder) {
      if (!byType[type] || byType[type].length === 0) continue;
      hasWork = true;
      sections.push(`\n### ${typeLabels[type] ?? type}`);
      for (const c of byType[type]) {
        const scope = c.scope ? `**[${c.scope}]** ` : "";
        const breaking = c.breaking ? " ⚠️ BREAKING" : "";
        sections.push(`- ${scope}${c.subject}${breaking} (\`${c.hash}\` by ${c.author})`);
      }
    }
    if (!hasWork) sections.push("No categorized work in this period.");

    // File change statistics
    const diffStat = runGit(
      ["diff", `--stat`, `--shortstat`, `HEAD~${Math.min(commits.length, 20)}`, "HEAD"],
      directory,
    );
    if (diffStat) {
      sections.push("\n## Change Statistics");
      sections.push("```");
      sections.push(diffStat.trim().split("\n").slice(-3).join("\n"));
      sections.push("```");
    }

    // Most active files
    const nameOnly = runGit(
      ["log", since, ...authorArg, "--name-only", "--pretty=format:"],
      directory,
    );
    if (nameOnly) {
      const fileCounts: Record<string, number> = {};
      for (const f of nameOnly.trim().split("\n").filter(Boolean)) {
        fileCounts[f] = (fileCounts[f] ?? 0) + 1;
      }
      const topFiles = Object.entries(fileCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (topFiles.length > 0) {
        sections.push("\n## Most Changed Files");
        for (const [file, count] of topFiles) {
          sections.push(`- \`${file}\` (${count} commit(s))`);
        }
      }
    }

    // Breaking changes detail
    if (breakingChanges.length > 0) {
      sections.push("\n## Breaking Changes");
      for (const c of breakingChanges) {
        sections.push(`- \`${c.hash}\` **${c.subject}** — review impact before release.`);
      }
    }

    // Suggested next steps
    sections.push("\n## Suggested Next Steps");
    if (byType["fix"] && byType["fix"].length > byType["feat"]?.length) {
      sections.push("- High fix-to-feature ratio detected — investigate root cause and consider quality improvements.");
    }
    if (!byType["test"]) {
      sections.push("- No test commits this period — ensure new features have coverage.");
    }
    if (!byType["docs"]) {
      sections.push("- No documentation updates — consider updating docs for new features.");
    }
    sections.push("- Review any breaking changes with stakeholders before next release.");
    sections.push("- Update CHANGELOG.md with this period's changes.");

    return textResult(sections.join("\n"));
  },
};

// ── cost_analyze ──────────────────────────────────────────────────────────────

export const costAnalyzeTool: PiTool = {
  name: "cost_analyze",
  label: "Cost Analyze",
  description:
    "Analyzes IaC files (Terraform, Kubernetes YAML, Docker Compose) to estimate monthly infrastructure costs and generate optimization recommendations.",
  parameters: Type.Object({
    path: Type.String({
      description: "Path to IaC directory to analyze.",
    }),
  }),

  async execute(_id, input) {
    const { path: iacPath } = input as { path: string };

    // Walk directory recursively for IaC files
    async function walkDir(dir: string): Promise<string[]> {
      const results: string[] = [];
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return results;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let s;
        try {
          s = await stat(full);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          const sub = await walkDir(full);
          results.push(...sub);
        } else if (
          entry.endsWith(".tf") ||
          entry.endsWith(".yaml") ||
          entry.endsWith(".yml") ||
          entry.startsWith("docker-compose")
        ) {
          results.push(full);
        }
      }
      return results;
    }

    // Check if path is a file or directory
    let iacFiles: string[];
    try {
      const s = await stat(iacPath);
      if (s.isFile()) {
        iacFiles = [iacPath];
      } else {
        iacFiles = await walkDir(iacPath);
      }
    } catch (err) {
      return textResult(`Error accessing path: ${(err as Error).message}`);
    }

    if (iacFiles.length === 0) {
      return textResult(JSON.stringify({
        resources: [],
        totalEstimatedMonthlyCost: 0,
        byCategory: { compute: 0, database: 0, storage: 0, serverless: 0, other: 0 },
        optimizationRecommendations: ["No IaC files (.tf, .yaml, .yml, docker-compose*.yml) found in the specified path."],
        iacFilesAnalyzed: [],
      }, null, 2));
    }

    // Pricing table
    const ec2Pricing: Record<string, number> = {
      "t3.micro": 8, "t3.small": 15, "t3.medium": 30, "t3.large": 60, "t3.xlarge": 120,
      "m5.large": 70, "m5.xlarge": 140, "m5.2xlarge": 280,
    };
    const rdsPricing: Record<string, number> = {
      "db.t3.micro": 15, "db.t3.small": 25, "db.t3.medium": 50,
    };

    type CostResource = {
      type: string;
      name: string;
      specs: Record<string, string | number>;
      estimatedMonthlyCost: number;
    };

    const resources: CostResource[] = [];
    const byCategory = { compute: 0, database: 0, storage: 0, serverless: 0, other: 0 };
    const optimizations: string[] = [];

    for (const file of iacFiles) {
      const content = await readFileSafe(file);
      if (content.startsWith("[could not read")) continue;
      const lines = content.split("\n");

      if (file.endsWith(".tf")) {
        // Parse Terraform resources line-by-line
        let i = 0;
        while (i < lines.length) {
          const line = lines[i].trim();

          // Match resource "type" "name" {
          const resourceMatch = line.match(/^resource\s+"([^"]+)"\s+"([^"]+)"/);
          if (resourceMatch) {
            const resType = resourceMatch[1];
            const resName = resourceMatch[2];

            // Collect block lines until closing brace (simple depth tracking)
            const blockLines: string[] = [];
            let depth = 0;
            let j = i;
            while (j < lines.length) {
              const bl = lines[j];
              for (const ch of bl) {
                if (ch === "{") depth++;
                if (ch === "}") depth--;
              }
              blockLines.push(bl);
              j++;
              if (depth === 0 && blockLines.length > 1) break;
            }

            const blockText = blockLines.join("\n");

            if (resType === "aws_instance") {
              const itMatch = blockText.match(/instance_type\s*=\s*"([^"]+)"/);
              const countMatch = blockText.match(/count\s*=\s*(\d+)/);
              const instanceType = itMatch?.[1] ?? "t3.micro";
              const count = parseInt(countMatch?.[1] ?? "1");
              const unitCost = ec2Pricing[instanceType] ?? 30;
              const total = unitCost * count;
              resources.push({ type: "aws_instance", name: resName, specs: { instance_type: instanceType, count }, estimatedMonthlyCost: total });
              byCategory.compute += total;
              if (!ec2Pricing[instanceType]) optimizations.push(`Instance type "${instanceType}" not in pricing table — verify sizing.`);
            } else if (resType === "aws_db_instance") {
              const icMatch = blockText.match(/instance_class\s*=\s*"([^"]+)"/);
              const storMatch = blockText.match(/allocated_storage\s*=\s*(\d+)/);
              const instanceClass = icMatch?.[1] ?? "db.t3.micro";
              const storage = parseInt(storMatch?.[1] ?? "20");
              const unitCost = rdsPricing[instanceClass] ?? 25;
              const storageCost = storage * 0.115;
              const total = unitCost + storageCost;
              resources.push({ type: "aws_db_instance", name: resName, specs: { instance_class: instanceClass, storage_gb: storage }, estimatedMonthlyCost: Math.round(total) });
              byCategory.database += Math.round(total);
              if (storage > 1000) optimizations.push(`RDS "${resName}" has ${storage}GB storage — consider Aurora serverless for variable workloads.`);
            } else if (resType === "aws_s3_bucket") {
              resources.push({ type: "aws_s3_bucket", name: resName, specs: { pricing_note: "$0.023/GB/month" }, estimatedMonthlyCost: 0 });
              byCategory.storage += 0;
            } else if (resType === "aws_lambda_function") {
              resources.push({ type: "aws_lambda_function", name: resName, specs: { note: "First 1M requests free, then $0.20/1M" }, estimatedMonthlyCost: 0 });
              byCategory.serverless += 0;
            } else if (resType === "aws_ecs_service") {
              const desiredMatch = blockText.match(/desired_count\s*=\s*(\d+)/);
              const count = parseInt(desiredMatch?.[1] ?? "1");
              const total = count * 30;
              resources.push({ type: "aws_ecs_service", name: resName, specs: { desired_count: count }, estimatedMonthlyCost: total });
              byCategory.compute += total;
            }

            i = j;
            continue;
          }
          i++;
        }
      } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        const isK8s = /kind:\s*(Deployment|Service|StatefulSet|DaemonSet)/i.test(content);
        const isDockerCompose = /^services:/m.test(content) || file.includes("docker-compose");

        if (isK8s) {
          const kindMatch = content.match(/^kind:\s*(\w+)/m);
          const nameMatch = content.match(/^\s*name:\s*(\S+)/m);
          const kind = kindMatch?.[1] ?? "Unknown";
          const name = nameMatch?.[1] ?? "unnamed";

          const replicasMatch = content.match(/replicas:\s*(\d+)/);
          const replicas = parseInt(replicasMatch?.[1] ?? "1");

          const cpuReqMatch = content.match(/cpu:\s*["']?(\d+(?:m|\.?\d*)?)["']?/);
          const memReqMatch = content.match(/memory:\s*["']?(\d+(?:Mi|Gi|M|G)?)["']?/);
          const cpuReq = cpuReqMatch?.[1] ?? "500m";
          const memReq = memReqMatch?.[1] ?? "512Mi";

          const cpuNum = cpuReq.endsWith("m") ? parseFloat(cpuReq) / 1000 : parseFloat(cpuReq);
          const memStr = memReq.replace(/[^0-9]/g, "");
          const memUnit = memReq.replace(/[0-9]/g, "");
          const memGb = memUnit.startsWith("G") ? parseFloat(memStr) : parseFloat(memStr) / 1024;

          const costPerPod = cpuNum * 30 + memGb * 3;
          const total = Math.round(costPerPod * replicas);

          resources.push({
            type: `k8s/${kind}`,
            name,
            specs: { replicas, cpu_request: cpuReq, memory_request: memReq },
            estimatedMonthlyCost: total,
          });
          byCategory.compute += total;

          if (replicas > 10) optimizations.push(`K8s ${kind} "${name}" has ${replicas} replicas — verify autoscaling policies.`);
        } else if (isDockerCompose) {
          const serviceMatches = content.match(/^\s{2}[\w-]+:\s*$/gm) ?? [];
          const serviceCount = serviceMatches.length;
          const total = serviceCount * 20;
          resources.push({
            type: "docker-compose",
            name: file.split("/").pop() ?? "docker-compose.yml",
            specs: { service_count: serviceCount },
            estimatedMonthlyCost: total,
          });
          byCategory.compute += total;
        }
      }
    }

    const totalEstimatedMonthlyCost = resources.reduce((sum, r) => sum + r.estimatedMonthlyCost, 0);

    if (byCategory.compute > 500) {
      optimizations.push("Compute costs are high — consider Reserved Instances (1-year) for 30-40% savings on stable workloads.");
    }
    if (resources.some((r) => r.type === "aws_instance" && String(r.specs["instance_type"]).startsWith("m5"))) {
      optimizations.push("M5 instances detected — evaluate if T3 burstable instances suffice for variable workloads.");
    }
    const ec2Resources = resources.filter((r) => r.type === "aws_instance");
    if (ec2Resources.length > 3) {
      optimizations.push(`${ec2Resources.length} EC2 instances found — consider Spot Instances for non-critical or stateless workloads (up to 90% savings).`);
    }
    if (byCategory.database > 200) {
      optimizations.push("Database costs are significant — consider read replicas carefully and evaluate Aurora Serverless v2 for variable load.");
    }
    if (resources.length === 0) {
      optimizations.push("No parseable IaC resources detected. Ensure Terraform or K8s manifests use standard patterns.");
    }

    return textResult(JSON.stringify({
      resources,
      totalEstimatedMonthlyCost,
      byCategory,
      optimizationRecommendations: optimizations,
      iacFilesAnalyzed: iacFiles,
    }, null, 2));
  },
};
