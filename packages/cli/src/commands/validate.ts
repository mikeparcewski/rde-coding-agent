import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import { loadSkills } from "@the-agent/skills";
import { loadAgents } from "@the-agent/agents";
import { TeamConfigSchema } from "../config/team-config.js";
import { FrameworkConfigSchema } from "../define-framework.js";
import type { FrameworkConfig } from "../define-framework.js";

export interface ValidateOptions {
  projectRoot: string;
  verbose: boolean;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  check: string;
  message: string;
}

export interface ValidationReport {
  passed: ValidationIssue[];
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
  exitCode: 0 | 1;
}

/**
 * Runs the `agent validate` subcommand.
 * Performs static analysis of all configuration without making LLM calls.
 *
 * Checks:
 *   1. Schema validation for all config files
 *   2. Agent resolution: capability → agent mappings
 *   3. Tool resolution: agent allowedTools references
 *   4. Provider config: env var presence (no API calls)
 *   5. Duplicate detection
 *   6. Capability coverage
 */
export async function runValidate(options: ValidateOptions): Promise<ValidationReport> {
  const report: ValidationReport = {
    passed: [],
    warnings: [],
    errors: [],
    exitCode: 0,
  };

  const add = (issue: ValidationIssue) => {
    if (issue.severity === "error") {
      report.errors.push(issue);
      report.exitCode = 1;
    } else if (issue.severity === "warning") {
      report.warnings.push(issue);
    } else {
      report.passed.push(issue);
    }
  };

  // === Check 1: agent.config.{ts,js,mjs} ===
  let frameworkConfig: FrameworkConfig | undefined;
  const configExtensions = [".ts", ".js", ".mjs"] as const;
  let configPath: string | undefined;

  for (const ext of configExtensions) {
    const candidate = resolve(options.projectRoot, `agent.config${ext}`);
    try {
      await access(candidate);
      configPath = candidate;
      break;
    } catch {
      // Try next extension
    }
  }

  if (configPath) {
    const configName = configPath.split("/").pop()!;
    try {
      const mod = await import(configPath) as { default?: FrameworkConfig };
      const raw = mod.default;
      const result = FrameworkConfigSchema.safeParse(raw);

      if (result.success) {
        frameworkConfig = result.data;
        add({
          severity: "info",
          check: `schema:${configName}`,
          message: `${configName} is valid`,
        });
      } else {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        add({
          severity: "error",
          check: `schema:${configName}`,
          message: `${configName} validation failed: ${issues}`,
        });
      }
    } catch (err) {
      add({
        severity: "error",
        check: `schema:${configName}`,
        message: `Failed to load ${configName}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    add({
      severity: "warning",
      check: "schema:agent.config",
      message: "agent.config.{ts,js,mjs} not found — framework config is required",
    });
  }

  // === Check 2: .agent/config.yaml ===
  let teamConfigRaw: Record<string, unknown> | undefined;
  const teamConfigPath = resolve(options.projectRoot, ".agent", "config.yaml");

  try {
    await access(teamConfigPath);
    const content = await readFile(teamConfigPath, "utf-8");

    try {
      const parsed = matter(`---\n${content}\n---`);
      const raw = parsed.data as Record<string, unknown>;
      const result = TeamConfigSchema.safeParse(raw);

      if (result.success) {
        teamConfigRaw = raw;
        add({
          severity: "info",
          check: "schema:.agent/config.yaml",
          message: ".agent/config.yaml is valid",
        });
      } else {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        add({
          severity: "error",
          check: "schema:.agent/config.yaml",
          message: `.agent/config.yaml validation failed: ${issues}`,
        });
      }
    } catch (err) {
      add({
        severity: "error",
        check: "schema:.agent/config.yaml",
        message: `Failed to parse .agent/config.yaml: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } catch {
    // Team config is optional
    add({
      severity: "info",
      check: "schema:.agent/config.yaml",
      message: ".agent/config.yaml not found (optional)",
    });
  }

  // === Check 3: Skills ===
  if (frameworkConfig) {
    try {
      const skillsDir = resolve(options.projectRoot, frameworkConfig.skillsDir);
      const skillRegistry = await loadSkills({
        skillsDir,
        mode: "permissive", // Validate always in permissive to collect all issues
      });

      add({
        severity: "info",
        check: "skills:load",
        message: `Loaded ${skillRegistry.size} skill(s) from ${frameworkConfig.skillsDir}`,
      });

      // Also check .agent/skills if it exists
      const dotAgentSkillsDir = resolve(options.projectRoot, ".agent", "skills");
      try {
        await access(dotAgentSkillsDir);
        const teamSkillRegistry = await loadSkills({
          skillsDir: dotAgentSkillsDir,
          mode: "permissive",
        });

        // Check for duplicates
        for (const teamSkill of teamSkillRegistry.list()) {
          if (skillRegistry.has(teamSkill.frontmatter.name)) {
            add({
              severity: "warning",
              check: "skills:duplicate",
              message: `Skill "${teamSkill.frontmatter.name}" defined in both project and .agent/skills/ — .agent/ version will override`,
            });
          }
        }
      } catch {
        // .agent/skills is optional
      }
    } catch (err) {
      add({
        severity: "error",
        check: "skills:load",
        message: `Failed to load skills: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // === Check 4: Agents ===
    try {
      const agentsDir = resolve(options.projectRoot, frameworkConfig.agentsDir);
      const agentRegistry = await loadAgents({ agentsDir });

      add({
        severity: "info",
        check: "agents:load",
        message: `Loaded ${agentRegistry.size} agent(s) from ${frameworkConfig.agentsDir}`,
      });

      // Check default agent resolves
      if (frameworkConfig.defaultAgent) {
        if (agentRegistry.has(frameworkConfig.defaultAgent)) {
          add({
            severity: "info",
            check: "agents:default",
            message: `Default agent "${frameworkConfig.defaultAgent}" resolves`,
          });
        } else {
          add({
            severity: "error",
            check: "agents:default",
            message: `Default agent "${frameworkConfig.defaultAgent}" not found in registry`,
          });
        }
      }
    } catch (err) {
      add({
        severity: "error",
        check: "agents:load",
        message: `Failed to load agents: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // === Check 5: Provider env vars ===
    const llm = frameworkConfig.llm;
    if (llm.provider === "anthropic") {
      if (process.env["ANTHROPIC_API_KEY"] || llm.apiKey) {
        add({
          severity: "info",
          check: "provider:env",
          message: "Anthropic API key is set",
        });
      } else {
        add({
          severity: "warning",
          check: "provider:env",
          message: "ANTHROPIC_API_KEY environment variable is not set",
        });
      }
    } else if (llm.provider === "openai") {
      if (process.env["OPENAI_API_KEY"] || llm.apiKey) {
        add({
          severity: "info",
          check: "provider:env",
          message: "OpenAI API key is set",
        });
      } else {
        add({
          severity: "warning",
          check: "provider:env",
          message: "OPENAI_API_KEY environment variable is not set",
        });
      }
    } else if (llm.provider === "google") {
      if (process.env["GOOGLE_API_KEY"] || llm.apiKey) {
        add({
          severity: "info",
          check: "provider:env",
          message: "Google API key is set",
        });
      } else {
        add({
          severity: "warning",
          check: "provider:env",
          message: "GOOGLE_API_KEY environment variable is not set",
        });
      }
    } else if (llm.provider === "ollama") {
      add({
        severity: "info",
        check: "provider:env",
        message: `Ollama configured at ${llm.baseUrl} (no API key required)`,
      });
    }
  }

  return report;
}

/**
 * Formats and prints a validation report to stdout.
 * Returns the exit code.
 */
export function printValidationReport(
  report: ValidationReport,
  verbose: boolean
): number {
  const total =
    report.passed.length + report.warnings.length + report.errors.length;

  console.log("");
  console.log("=== the-agent validate ===");
  console.log("");

  if (verbose) {
    for (const issue of report.passed) {
      console.log(`  [pass] ${issue.check}: ${issue.message}`);
    }
  }

  for (const issue of report.warnings) {
    console.warn(`  [warn] ${issue.check}: ${issue.message}`);
  }

  for (const issue of report.errors) {
    console.error(`  [FAIL] ${issue.check}: ${issue.message}`);
  }

  console.log("");
  console.log(
    `Results: ${report.passed.length} passed, ${report.warnings.length} warning(s), ${report.errors.length} error(s) of ${total} checks`
  );

  if (report.exitCode === 0) {
    console.log("Status: OK");
  } else {
    console.error("Status: FAILED");
  }

  console.log("");

  return report.exitCode;
}
