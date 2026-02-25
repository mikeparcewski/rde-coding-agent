import { access } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import type { AgentConfig } from "@the-agent/core";

export type AgentHooks = NonNullable<AgentConfig["hooks"]>;

/**
 * Resolves the co-located lifecycle hook file for an agent markdown file.
 *
 * Convention:
 *   agents/coder.md    ->   agents/coder.hooks.ts   (or .hooks.js)
 *   agents/default.md  ->   agents/default.hooks.ts
 *
 * Returns the resolved path if found, or undefined if no hooks file exists.
 */
export async function resolveHooks(
  agentFilePath: string
): Promise<string | undefined> {
  const dir = dirname(agentFilePath);
  const base = basename(agentFilePath, extname(agentFilePath));

  const candidates = [
    join(dir, `${base}.hooks.ts`),
    join(dir, `${base}.hooks.js`),
    join(dir, `${base}.hooks.mjs`),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // File doesn't exist — continue
    }
  }

  return undefined;
}

/**
 * Dynamically imports a hooks module and returns the exported hooks.
 * The module must export: { beforeTurn?, afterTurn?, onError? }
 */
export async function loadHooks(
  hooksPath: string,
  agentId: string
): Promise<AgentHooks> {
  try {
    const mod = await import(hooksPath) as {
      beforeTurn?: AgentHooks["beforeTurn"];
      afterTurn?: AgentHooks["afterTurn"];
      onError?: AgentHooks["onError"];
      default?: AgentHooks;
    };

    // Support both named exports and default export
    if (mod.default) {
      return mod.default;
    }

    const hooks: AgentHooks = {};
    if (mod.beforeTurn) hooks.beforeTurn = mod.beforeTurn;
    if (mod.afterTurn) hooks.afterTurn = mod.afterTurn;
    if (mod.onError) hooks.onError = mod.onError;

    return hooks;
  } catch (err) {
    throw new Error(
      `Failed to load hooks for agent "${agentId}" at ${hooksPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
