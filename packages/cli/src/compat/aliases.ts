import { z } from "zod";

export const AliasMapSchema = z.record(z.string());  // old command -> new capability tag

/**
 * DEFAULT_ALIASES maps legacy /plugin:command syntax to the-agent capability tags.
 * Enabled when compat_mode: true in .agent/config.yaml.
 *
 * @deprecated Will be removed in v2.0. Migrate to natural language intents.
 */
export const DEFAULT_ALIASES: Record<string, string> = {
  // wicked-engineering
  "/wicked-engineering:review": "code-review",
  "/wicked-engineering:debug": "debug",
  "/wicked-engineering:arch": "architecture-analysis",
  "/wicked-engineering:plan": "implementation",
  "/wicked-engineering:docs": "general",
  // wicked-qe
  "/wicked-qe:scenarios": "test-scenarios",
  "/wicked-qe:qe-plan": "test-strategy",
  "/wicked-qe:qe-review": "code-review",
  "/wicked-qe:automate": "test-execution",
  // wicked-platform
  "/wicked-platform:security": "security-scan",
  "/wicked-platform:compliance": "compliance-check",
  "/wicked-platform:actions": "cicd-pipeline",
  // wicked-product
  "/wicked-product:elicit": "requirements",
  "/wicked-product:acceptance": "acceptance-criteria",
  "/wicked-product:ux-review": "ux-review",
  // wicked-jam
  "/wicked-jam:brainstorm": "brainstorm",
  "/wicked-jam:jam": "brainstorm",
  // wicked-crew
  "/wicked-crew:start": "orchestrate",
  "/wicked-crew:execute": "phase-routing",
  "/wicked-crew:status": "progress-report",
  // wicked-mem
  "/wicked-mem:store": "memory-store",
  "/wicked-mem:recall": "memory-recall",
  // wicked-data
  "/wicked-data:analyze": "data-analysis",
};

/**
 * Resolves a legacy command to a capability tag, or returns undefined
 * if the command is not in the alias map.
 */
export function resolveAlias(
  input: string,
  customAliases?: Record<string, string>
): { capability: string; original: string } | undefined {
  const allAliases = { ...DEFAULT_ALIASES, ...customAliases };
  const trimmed = input.trim();

  const capability = allAliases[trimmed];
  if (capability) {
    return { capability, original: trimmed };
  }

  return undefined;
}

let _deprecationNoticeSent = false;

/**
 * Emits a one-time deprecation warning per session when compat_mode aliases are used.
 */
export function emitDeprecationNotice(): void {
  if (_deprecationNoticeSent) return;
  _deprecationNoticeSent = true;
  console.warn(
    "[the-agent] compat_mode is enabled. Legacy /plugin:command syntax will be removed in v2.0. " +
      "Migrate to natural language intents."
  );
}

/**
 * Resets the deprecation notice flag (for testing).
 */
export function resetDeprecationNotice(): void {
  _deprecationNoticeSent = false;
}
