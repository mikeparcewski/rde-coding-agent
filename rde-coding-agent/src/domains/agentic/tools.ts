/**
 * Agentic domain tools.
 *
 * Reviews agent configurations, audits for safety issues, and checks
 * agent architectures against best practices.
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
    return `[could not read: ${(err as Error).message}]`;
  }
}

async function findAgentFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const agentPatterns = [
    /agent/i, /tool/i, /prompt/i, /system.*prompt/i, /config/i, /handler/i, /executor/i,
  ];
  const relevantExts = new Set([".ts", ".js", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".md"]);
  const ignore = new Set(["node_modules", ".git", "dist", "coverage"]);

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 5) return;
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
        await walk(full, depth + 1);
      } else if (
        relevantExts.has(extname(entry).toLowerCase()) &&
        agentPatterns.some((p) => p.test(entry))
      ) {
        result.push(full);
      }
    }
  }

  await walk(dir, 0);
  return result;
}

// ── agent_review ──────────────────────────────────────────────────────────────

export const agentReviewTool: PiTool = {
  name: "agent_review",
  label: "Agent Configuration Review",
  description:
    "Reads agent configuration files and reviews them for anti-patterns, missing guardrails, and best practice violations.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Directory containing agent configuration and implementation files.",
    }),
    files: Type.Optional(
      Type.Array(Type.String(), {
        description: "Specific files to review (overrides directory scan).",
      }),
    ),
  }),

  async execute(_id, input) {
    const { directory, files: explicitFiles } = input as {
      directory: string;
      files?: string[];
    };

    const sections: string[] = [];
    sections.push(`# Agent Configuration Review`);
    sections.push(`Directory: \`${directory}\`\n`);

    const filesToReview = explicitFiles ?? await findAgentFiles(directory);

    if (filesToReview.length === 0) {
      sections.push("No agent configuration files detected. Looked for files matching: agent, tool, prompt, config, handler patterns.");
      return textResult(sections.join("\n"));
    }

    sections.push(`Found **${filesToReview.length}** file(s) to review.\n`);

    type Finding = {
      file: string;
      severity: "critical" | "high" | "medium" | "low" | "info";
      pattern: string;
      line?: number;
      message: string;
      recommendation: string;
    };

    const findings: Finding[] = [];
    const goodPractices: string[] = [];

    for (const filePath of filesToReview) {
      const content = await readFileSafe(filePath);
      if (content.startsWith("[could not read")) continue;

      const lines = content.split("\n");

      // ── Anti-patterns ──

      // Unbounded tool loops
      if (/while\s*\(\s*true\s*\)|for\s*\(;;/.test(content) && /tool|agent|run|exec/i.test(content)) {
        findings.push({
          file: filePath, severity: "high", pattern: "Unbounded Loop",
          message: "Infinite loop with tool/agent execution — could consume tokens/resources without bound.",
          recommendation: "Add a maximum iteration count (e.g., max 10 tool calls) and a circuit breaker.",
        });
      }

      // Missing max_tokens or token limit
      if (/maxTokens|max_tokens|maxLength/i.test(content)) {
        goodPractices.push(`\`${filePath.split("/").pop()}\`: max_tokens limit configured.`);
      } else if (/\b(?:model|llm|openai|anthropic|gpt|claude)\b/i.test(content)) {
        findings.push({
          file: filePath, severity: "medium", pattern: "Missing Token Limit",
          message: "LLM call without explicit max_tokens — could generate runaway responses.",
          recommendation: "Set explicit maxTokens to prevent unexpectedly large completions.",
        });
      }

      // Logging of prompts/responses
      if (/console\.log.*(?:prompt|response|completion|message)/i.test(content)) {
        findings.push({
          file: filePath, severity: "medium", pattern: "Prompt Logging",
          message: "LLM prompt or response logged to console — may expose sensitive user data.",
          recommendation: "Use structured logging with PII masking. Never log raw user messages in production.",
        });
      }

      // Hardcoded system prompts in source
      const systemPromptMatches = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /system.*prompt\s*[:=]\s*[`'"]/i.test(l));
      for (const { i } of systemPromptMatches.slice(0, 3)) {
        findings.push({
          file: filePath, severity: "low", line: i + 1, pattern: "Hardcoded System Prompt",
          message: `System prompt hardcoded in source at line ${i + 1} — hard to update without redeployment.`,
          recommendation: "Externalize system prompts to configuration files or a prompt registry.",
        });
      }

      // Direct shell execution from agent
      if (/exec\s*\(|spawn\s*\(|execSync|spawnSync/.test(content)) {
        findings.push({
          file: filePath, severity: "high", pattern: "Shell Execution",
          message: "Agent code performs direct shell command execution — possible command injection vector.",
          recommendation: "Use execFileSync with explicit command + args array (never string interpolation). Add an allowlist of permitted commands.",
        });
      }

      // Unvalidated LLM output used in execution
      if (/JSON\.parse.*(?:response|completion|text|content)/i.test(content) &&
        !/try\s*\{/.test(content)) {
        findings.push({
          file: filePath, severity: "high", pattern: "Unvalidated LLM Output",
          message: "LLM response parsed as JSON without error handling — malformed output will crash the agent.",
          recommendation: "Wrap JSON.parse in try/catch; validate output schema with Zod or TypeBox before use.",
        });
      }

      // Recursive agent calls without depth limit
      if (/(?:agent|run|execute).*(?:agent|run|execute)/i.test(content) && !/depth|recursion|level|limit/i.test(content)) {
        findings.push({
          file: filePath, severity: "medium", pattern: "Potential Unbounded Recursion",
          message: "Agent may call itself or other agents recursively without a depth limit.",
          recommendation: "Pass and decrement a `depth` counter; throw when depth reaches 0.",
        });
      }

      // Missing abort signal handling
      if (/execute\s*\(|run\s*\(/.test(content) && !/AbortSignal|AbortController|signal/i.test(content)) {
        findings.push({
          file: filePath, severity: "medium", pattern: "No Cancellation Support",
          message: "Tool/agent execution may not support cancellation via AbortSignal.",
          recommendation: "Thread AbortSignal through all async tool calls to support user-initiated cancellation.",
        });
      }

      // Good patterns
      if (/AbortSignal|AbortController/.test(content)) {
        goodPractices.push(`\`${filePath.split("/").pop()}\`: AbortSignal cancellation support.`);
      }
      if (/zod|typebox|joi|yup/.test(content.toLowerCase())) {
        goodPractices.push(`\`${filePath.split("/").pop()}\`: Schema validation library detected.`);
      }
      if (/\bcatch\b.*error|\.catch\(/.test(content)) {
        goodPractices.push(`\`${filePath.split("/").pop()}\`: Error handling detected.`);
      }
    }

    // Summary
    const bySeverity: Record<string, Finding[]> = { critical: [], high: [], medium: [], low: [], info: [] };
    for (const f of findings) bySeverity[f.severity].push(f);

    sections.push("## Review Summary");
    sections.push(`| Severity | Count |`);
    sections.push(`|----------|-------|`);
    sections.push(`| Critical | ${bySeverity.critical.length} |`);
    sections.push(`| High | ${bySeverity.high.length} |`);
    sections.push(`| Medium | ${bySeverity.medium.length} |`);
    sections.push(`| Low | ${bySeverity.low.length} |`);
    sections.push(`| **Total** | **${findings.length}** |`);
    sections.push("");

    if (goodPractices.length > 0) {
      sections.push("## Positive Practices");
      sections.push([...new Set(goodPractices)].map((p) => `- ${p}`).join("\n"));
      sections.push("");
    }

    const order: Array<Finding["severity"]> = ["critical", "high", "medium", "low", "info"];
    for (const sev of order) {
      if (bySeverity[sev].length === 0) continue;
      sections.push(`## ${sev.charAt(0).toUpperCase() + sev.slice(1)} Findings`);
      for (const f of bySeverity[sev]) {
        sections.push(`\n### ${f.pattern}`);
        sections.push(`**File**: \`${f.file}\`${f.line ? ` line ${f.line}` : ""}`);
        sections.push(`**Issue**: ${f.message}`);
        sections.push(`**Recommendation**: ${f.recommendation}`);
      }
      sections.push("");
    }

    if (findings.length === 0) {
      sections.push("**No anti-patterns detected.** Manual review of agent behavior is still recommended.");
    }

    return textResult(sections.join("\n"));
  },
};

// ── safety_audit ──────────────────────────────────────────────────────────────

export const safetyAuditTool: PiTool = {
  name: "safety_audit",
  label: "Agent Safety Audit",
  description:
    "Audits agent system prompts, tool definitions, and code for prompt injection vulnerabilities and missing safety guardrails.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Directory containing agent files to audit.",
    }),
    check_prompts: Type.Optional(
      Type.Boolean({
        description: "Also check for prompt injection patterns in prompts. Default: true.",
      }),
    ),
  }),

  async execute(_id, input) {
    const { directory, check_prompts = true } = input as {
      directory: string;
      check_prompts?: boolean;
    };

    const sections: string[] = [];
    sections.push(`# Agent Safety Audit`);
    sections.push(`Directory: \`${directory}\``);
    sections.push(`Date: ${new Date().toISOString().split("T")[0]}\n`);

    const agentFiles = await findAgentFiles(directory);
    // Also look for any .md or text files that might be system prompts
    const allFiles = agentFiles;

    // Try to find explicit prompt files
    try {
      const entries = await readdir(directory);
      for (const e of entries) {
        if (/prompt|system/i.test(e) && [".md", ".txt", ".yaml", ".yml", ".json"].includes(extname(e))) {
          allFiles.push(join(directory, e));
        }
      }
    } catch {
      // ignore
    }

    if (allFiles.length === 0) {
      sections.push("No agent files found for safety audit.");
      return textResult(sections.join("\n"));
    }

    type SafetyFinding = {
      category: string;
      severity: "critical" | "high" | "medium" | "low";
      file: string;
      finding: string;
      guidance: string;
    };

    const safetyFindings: SafetyFinding[] = [];
    const safeguardsFound: string[] = [];

    // Prompt injection patterns to check in system prompts / user input handling
    const injectionPatterns = [
      {
        pattern: /ignore\s+(?:previous|above|all)\s+instructions/i,
        label: "Classic ignore-previous-instructions injection vector",
      },
      {
        pattern: /you\s+are\s+now\s+(?:a\s+)?(?:an?\s+)?\w+/i,
        label: "Role override prompt injection",
      },
      {
        pattern: /(?:system|assistant|user)\s*:/i,
        label: "Potential role prefix injection in user input processing",
      },
      {
        pattern: /\[(?:SYSTEM|INST|SYS)\]/i,
        label: "Model-specific injection tokens",
      },
      {
        pattern: /<\|(?:system|user|assistant)\|>/i,
        label: "Special token injection attempt",
      },
    ];

    for (const filePath of allFiles) {
      const content = await readFileSafe(filePath);
      if (content.startsWith("[could not read")) continue;

      const lines = content.split("\n");

      // Check for prompt injection patterns in prompts (only flag if file looks like a prompt)
      if (check_prompts && /prompt|system/i.test(filePath)) {
        for (const { pattern, label } of injectionPatterns) {
          if (pattern.test(content)) {
            safetyFindings.push({
              category: "Prompt Injection",
              severity: "high",
              file: filePath,
              finding: `Potential injection vector: ${label}`,
              guidance: "Sanitize user inputs before appending to prompts. Use structured message formats that separate system/user content clearly.",
            });
          }
        }
      }

      // Check for user input directly interpolated into prompts
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/`.*\$\{(?:user|input|message|query|request|args)/i.test(l)) {
          safetyFindings.push({
            category: "Prompt Injection Risk",
            severity: "high",
            file: filePath,
            finding: `Line ${i + 1}: User input directly interpolated into template literal prompt: \`${l.trim().slice(0, 80)}\``,
            guidance: "Never directly interpolate user input into prompts. Use structured messages with clear role delineation.",
          });
        }
      }

      // Missing output validation
      if (/model|llm|complete|generate|chat/i.test(content) && !/validate|sanitize|check|assert/i.test(content)) {
        safetyFindings.push({
          category: "Output Validation",
          severity: "medium",
          file: filePath,
          finding: "LLM calls detected without output validation or sanitization.",
          guidance: "Always validate LLM output against expected schema before acting on it. Use Zod/TypeBox schemas.",
        });
      }

      // Excessive permissions in tool definitions
      const toolPermissions = content.match(/(?:permission|scope|access)\s*[:=]\s*['"]?(?:write|delete|admin|sudo|root)['"]?/gi);
      if (toolPermissions && toolPermissions.length > 0) {
        safetyFindings.push({
          category: "Excessive Permissions",
          severity: "high",
          file: filePath,
          finding: `Tools may have excessive permissions: ${toolPermissions.slice(0, 3).join(", ")}`,
          guidance: "Apply principle of least privilege — grant tools only the minimum permissions needed for their task.",
        });
      }

      // No rate limiting
      if (/registerTool|tool\s*=\s*\{|tools\s*[:=]\s*\[/i.test(content) && !/rateLimit|throttle|cooldown|maxCalls/i.test(content)) {
        safetyFindings.push({
          category: "Rate Limiting",
          severity: "medium",
          file: filePath,
          finding: "Tool registration detected without rate limiting.",
          guidance: "Add rate limiting to prevent tools from being called excessively in a loop.",
        });
      }

      // Safeguards present
      if (/confirm\s*\(|ui\.confirm|require.*confirm/i.test(content)) {
        safeguardsFound.push(`\`${filePath.split("/").pop()}\`: User confirmation gates present.`);
      }
      if (/allowlist|whitelist|permitted.*commands|allowed.*tools/i.test(content)) {
        safeguardsFound.push(`\`${filePath.split("/").pop()}\`: Command/tool allowlist detected.`);
      }
      if (/block.*reason|blocked.*by|guardrail/i.test(content)) {
        safeguardsFound.push(`\`${filePath.split("/").pop()}\`: Guardrail/block mechanism detected.`);
      }
      if (/AbortSignal|AbortController|timeout/i.test(content)) {
        safeguardsFound.push(`\`${filePath.split("/").pop()}\`: Cancellation/timeout support detected.`);
      }
    }

    // Safety checklist
    sections.push("## Safety Checklist");
    const checklist = [
      { item: "User input sanitized before prompt injection", met: !safetyFindings.some((f) => f.category === "Prompt Injection Risk") },
      { item: "LLM output validated before execution", met: !safetyFindings.some((f) => f.category === "Output Validation") },
      { item: "User confirmation gates for destructive actions", met: safeguardsFound.some((s) => s.includes("confirmation")) },
      { item: "Tool rate limiting configured", met: !safetyFindings.some((f) => f.category === "Rate Limiting") },
      { item: "Principle of least privilege for tool permissions", met: !safetyFindings.some((f) => f.category === "Excessive Permissions") },
      { item: "Cancellation/timeout support", met: safeguardsFound.some((s) => s.includes("Cancellation")) },
      { item: "Guardrail/block mechanism", met: safeguardsFound.some((s) => s.includes("Guardrail")) },
    ];

    sections.push("| Status | Check |");
    sections.push("|--------|-------|");
    for (const c of checklist) {
      sections.push(`| ${c.met ? "PASS" : "FAIL"} | ${c.item} |`);
    }
    sections.push("");

    const passed = checklist.filter((c) => c.met).length;
    sections.push(`**${passed}/${checklist.length} safety checks passed.**\n`);

    if (safeguardsFound.length > 0) {
      sections.push("## Safeguards Detected");
      sections.push([...new Set(safeguardsFound)].map((s) => `- ${s}`).join("\n"));
      sections.push("");
    }

    if (safetyFindings.length > 0) {
      sections.push("## Safety Findings");
      for (const f of safetyFindings) {
        sections.push(`\n### [${f.severity.toUpperCase()}] ${f.category}`);
        sections.push(`**File**: \`${f.file}\``);
        sections.push(`**Finding**: ${f.finding}`);
        sections.push(`**Guidance**: ${f.guidance}`);
      }
    } else {
      sections.push("## Safety Findings\nNo critical safety issues detected.");
    }

    sections.push("\n## AI Safety Best Practices");
    sections.push("1. **Defense in depth**: Layer multiple safety controls — don't rely on a single guardrail.");
    sections.push("2. **Human-in-the-loop**: Require explicit confirmation for any action with real-world consequences.");
    sections.push("3. **Minimal footprint**: Grant tools only the permissions they need for their specific task.");
    sections.push("4. **Structured outputs**: Use JSON schema to constrain LLM outputs rather than free-form text parsing.");
    sections.push("5. **Audit logging**: Log all tool calls with inputs/outputs for forensic analysis.");
    sections.push("6. **Fail closed**: When in doubt, block and ask for clarification rather than proceeding.");
    sections.push("7. **Prompt separation**: Never mix user-controlled content with system instructions in the same message.");

    return textResult(sections.join("\n"));
  },
};

// ── pattern_check ─────────────────────────────────────────────────────────────

export const patternCheckTool: PiTool = {
  name: "pattern_check",
  label: "Agent Architecture Pattern Check",
  description:
    "Analyzes an agent implementation against known best practices and anti-patterns in agentic AI systems.",
  parameters: Type.Object({
    directory: Type.String({
      description: "Directory containing the agent implementation.",
    }),
  }),

  async execute(_id, input) {
    const { directory } = input as { directory: string };

    const sections: string[] = [];
    sections.push(`# Agent Architecture Pattern Check`);
    sections.push(`Directory: \`${directory}\`\n`);

    const agentFiles = await findAgentFiles(directory);
    const allContent = (
      await Promise.all(agentFiles.map((f) => readFileSafe(f)))
    ).join("\n");

    // Pattern analysis
    type PatternResult = {
      pattern: string;
      status: "present" | "missing" | "partial";
      description: string;
      details: string;
    };

    const patterns: PatternResult[] = [];

    // Tool abstraction layer
    const hasToolLayer = /registerTool|tool\.execute|ToolResult|PiTool/.test(allContent);
    patterns.push({
      pattern: "Tool Abstraction Layer",
      status: hasToolLayer ? "present" : "missing",
      description: "Tools are registered through a typed abstraction, not called directly.",
      details: hasToolLayer
        ? "Tool registration pattern detected."
        : "Tools appear to be called directly — add a typed tool abstraction for safety and testability.",
    });

    // Schema validation
    const hasSchema = /Type\.Object|z\.object|Joi\.object|yup\.object|zod/i.test(allContent);
    patterns.push({
      pattern: "Input Schema Validation",
      status: hasSchema ? "present" : "missing",
      description: "Tool inputs are validated against a defined schema before execution.",
      details: hasSchema
        ? "Schema validation (TypeBox/Zod/Joi) detected."
        : "No schema validation found — add TypeBox or Zod schemas to validate all tool inputs.",
    });

    // Structured results
    const hasStructuredResult = /PiToolResult|ToolResult|content.*type.*text/.test(allContent);
    patterns.push({
      pattern: "Structured Tool Results",
      status: hasStructuredResult ? "present" : "missing",
      description: "Tools return structured results rather than raw strings.",
      details: hasStructuredResult
        ? "Structured result format detected."
        : "Tools may return unstructured strings — define a consistent result type.",
    });

    // Observability
    const hasObservability = /onUpdate|update.*callback|progress|event.*emit|stream/.test(allContent);
    patterns.push({
      pattern: "Streaming / Progress Updates",
      status: hasObservability ? "present" : "missing",
      description: "Long-running tools emit progress updates to the UI.",
      details: hasObservability
        ? "Progress update mechanism detected."
        : "No progress updates for long operations — users may think the agent is stuck.",
    });

    // Idempotency
    const hasIdempotency = /idempotent|dedup|already.*exists|check.*before|exists.*return/i.test(allContent);
    patterns.push({
      pattern: "Idempotent Operations",
      status: hasIdempotency ? "partial" : "missing",
      description: "Tool operations are safe to retry — duplicate calls produce same result.",
      details: hasIdempotency
        ? "Some idempotency checks detected."
        : "No idempotency guards detected — ensure tool operations are safe to retry.",
    });

    // Domain separation
    const hasDomainSep = /domain|domains|registry|registrar/.test(allContent);
    patterns.push({
      pattern: "Domain Separation",
      status: hasDomainSep ? "present" : "missing",
      description: "Tools are organized into logical domains with clear boundaries.",
      details: hasDomainSep
        ? "Domain/registry pattern detected."
        : "No domain separation detected — consider grouping tools by capability domain.",
    });

    // Error propagation
    const hasErrorPropagation = /catch.*block|try.*catch|\.catch\(|reject\(/.test(allContent);
    patterns.push({
      pattern: "Error Propagation",
      status: hasErrorPropagation ? "present" : "missing",
      description: "Errors from tools are caught, logged, and returned as structured results (not thrown to the LLM loop).",
      details: hasErrorPropagation
        ? "Error handling blocks detected."
        : "No error handling — unhandled exceptions will crash the agent loop.",
    });

    // Cancellation support
    const hasCancellation = /AbortSignal|AbortController|signal\.aborted|signal\.throwIfAborted/.test(allContent);
    patterns.push({
      pattern: "Cancellation Support",
      status: hasCancellation ? "present" : "missing",
      description: "All async operations respect AbortSignal for user-initiated cancellation.",
      details: hasCancellation
        ? "AbortSignal cancellation detected."
        : "No AbortSignal support — users cannot cancel long-running operations.",
    });

    // Stateless tools
    const hasStateInTools = /this\.\w+\s*=|static\s+\w+\s*=.*\[\]/.test(allContent);
    patterns.push({
      pattern: "Stateless Tool Design",
      status: hasStateInTools ? "partial" : "present",
      description: "Tools are stateless — all inputs come via parameters, not shared mutable state.",
      details: hasStateInTools
        ? "Some mutable state detected in tools — review whether state belongs in a store instead."
        : "Tools appear stateless — good.",
    });

    // Count by status
    const presentCount = patterns.filter((p) => p.status === "present").length;
    const partialCount = patterns.filter((p) => p.status === "partial").length;
    const missingCount = patterns.filter((p) => p.status === "missing").length;

    sections.push("## Pattern Analysis Summary");
    sections.push(`| Status | Count |`);
    sections.push(`|--------|-------|`);
    sections.push(`| Present | ${presentCount} |`);
    sections.push(`| Partial | ${partialCount} |`);
    sections.push(`| Missing | ${missingCount} |`);
    sections.push(`| **Total** | **${patterns.length}** |`);
    sections.push("");

    const score = Math.round(((presentCount + partialCount * 0.5) / patterns.length) * 100);
    sections.push(`**Architecture Health Score**: ${score}/100\n`);

    sections.push("## Pattern Details");
    for (const p of patterns) {
      const icon = p.status === "present" ? "PASS" : p.status === "partial" ? "PARTIAL" : "FAIL";
      sections.push(`\n### ${icon}: ${p.pattern}`);
      sections.push(`*${p.description}*`);
      sections.push(`> ${p.details}`);
    }

    sections.push("\n## Architecture Recommendations");
    const missing = patterns.filter((p) => p.status === "missing");
    if (missing.length === 0) {
      sections.push("Architecture aligns well with best practices. Focus on expanding coverage and test quality.");
    } else {
      for (const p of missing) {
        sections.push(`- **Add ${p.pattern}**: ${p.description}`);
      }
    }

    sections.push("\n## Reference: Agentic Architecture Checklist");
    sections.push("Based on emerging best practices for production agentic systems:");
    sections.push("- [Anthropic: Building Effective Agents](https://anthropic.com/research)");
    sections.push("- [OpenAI Cookbook: Tool Use Patterns](https://cookbook.openai.com)");
    sections.push("- [LangChain: Agent Best Practices](https://python.langchain.com)");

    return textResult(sections.join("\n"));
  },
};
