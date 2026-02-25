/**
 * Platform domain hooks.
 *
 * Gate hook that intercepts tool_call events and blocks dangerous
 * commands (destructive file ops, database drops, etc.) unless the
 * user explicitly confirms via ctx.ui.confirm().
 */

import type { PiExtensionAPI, PiEventHandler } from "../../types.js";

// Patterns for dangerous operations
const DANGEROUS_PATTERNS: Array<{
  pattern: RegExp;
  label: string;
  severity: "critical" | "high";
}> = [
  // Shell destructive ops
  { pattern: /\brm\s+-[rf]{1,2}\s/i, label: "recursive file deletion (rm -rf)", severity: "critical" },
  { pattern: /\bformat\s+(c:|\/dev\/)/i, label: "disk format", severity: "critical" },
  { pattern: /\bdd\s+if=/i, label: "raw disk write (dd)", severity: "critical" },
  { pattern: /\btruncate\s+/i, label: "file truncation", severity: "high" },
  { pattern: />\s*\/dev\/sd[a-z]/i, label: "raw device write", severity: "critical" },
  { pattern: /\bchmod\s+-?R\s+777/i, label: "world-writable permissions (chmod 777)", severity: "high" },
  { pattern: /\bchown\s+-R\s+/i, label: "recursive ownership change", severity: "high" },

  // Database destructive ops
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i, label: "DROP TABLE/DATABASE", severity: "critical" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, label: "TRUNCATE TABLE", severity: "critical" },
  { pattern: /\bDELETE\s+FROM\b(?!\s+\w+\s+WHERE)/i, label: "DELETE without WHERE clause", severity: "high" },
  { pattern: /\bALTER\s+TABLE\b.*\bDROP\s+COLUMN\b/i, label: "ALTER TABLE DROP COLUMN", severity: "high" },

  // Git destructive ops
  { pattern: /\bgit\s+push\s+(?:--force|-f)\b/i, label: "force push to remote", severity: "high" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "hard git reset", severity: "high" },
  { pattern: /\bgit\s+clean\s+-[fFdx]{1,3}\b/i, label: "git clean (removes untracked files)", severity: "high" },
  { pattern: /\bgit\s+branch\s+-[Dd]\b/i, label: "branch deletion", severity: "high" },

  // Production environment modifications
  { pattern: /\bkubectl\s+delete\b/i, label: "kubectl delete", severity: "critical" },
  { pattern: /\bkubectl\s+(?:drain|cordon)\b/i, label: "kubectl node drain/cordon", severity: "high" },
  { pattern: /\bdocker\s+(?:rmi|rm)\s+-f/i, label: "force docker remove", severity: "high" },
  { pattern: /\bdocker\s+system\s+prune\b/i, label: "docker system prune", severity: "high" },

  // Credential/secret exposure
  { pattern: /\benv\b.*\bproduction\b.*\bexport\b/i, label: "exporting production env", severity: "high" },
  { pattern: /\bcurl\s+.*(?:password|secret|token)\s+/i, label: "curl with credentials in args", severity: "high" },
];

// Extract command string from a tool_call event
function extractCommandText(event: Record<string, unknown>): string {
  // Common tool call structures
  const toolInput = event["input"] as Record<string, unknown> | undefined;
  const toolName = (event["name"] ?? event["tool_name"] ?? "") as string;

  let commandText = "";

  if (toolInput) {
    // bash/shell tool patterns
    if (typeof toolInput["command"] === "string") commandText += " " + toolInput["command"];
    if (typeof toolInput["cmd"] === "string") commandText += " " + toolInput["cmd"];
    if (typeof toolInput["shell"] === "string") commandText += " " + toolInput["shell"];
    if (typeof toolInput["query"] === "string") commandText += " " + toolInput["query"];
    if (typeof toolInput["sql"] === "string") commandText += " " + toolInput["sql"];
    // flatten nested input
    for (const val of Object.values(toolInput)) {
      if (typeof val === "string" && val.length > 2) commandText += " " + val;
    }
  }

  commandText = (toolName + " " + commandText).toLowerCase();
  return commandText;
}

export function registerHooks(pi: PiExtensionAPI, guardrails: boolean): void {
  if (!guardrails) return;

  const handler: PiEventHandler = async (event, ctx) => {
    const commandText = extractCommandText(event);

    // Collect ALL matching patterns before prompting
    const matched = DANGEROUS_PATTERNS.filter(({ pattern }) =>
      pattern.test(commandText),
    );

    if (matched.length === 0) return;

    const labels = matched.map((m) => m.label).join(", ");
    const maxSeverity = matched.some((m) => m.severity === "critical")
      ? "CRITICAL"
      : "WARNING";

    const confirmed = await ctx.ui.confirm(
      `${maxSeverity}: Dangerous Operation Detected`,
      `The agent is about to perform: **${labels}**\n\n` +
      `Matched pattern in: \`${commandText.slice(0, 200)}\`\n\n` +
      `This action may be irreversible. Do you want to proceed?`,
    );

    if (!confirmed) {
      return {
        block: true,
        reason: `Operation blocked by platform guardrail: ${labels}. User declined to proceed.`,
      };
    }

    ctx.ui.showMessage(
      "warn",
      `Platform guardrail: User approved dangerous operation — ${labels}`,
    );
  };

  pi.on("tool_call", handler);
}
