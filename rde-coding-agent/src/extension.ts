/**
 * rdeCodingAgent() — the pi-mono extension factory.
 *
 * Returns a PiExtension object. pi-mono calls register(pi) once at startup.
 * Each domain is wrapped in try/catch so a broken domain never prevents the
 * others from loading.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type {
  RdeConfig,
  PiExtensionAPI,
  ResolvedConfig,
  DomainName,
  DomainRegistrar,
} from "./types.js";
import { DOMAIN_NAMES } from "./types.js";
import { registerMemory } from "./domains/memory/index.js";
import { registerSearch } from "./domains/search/index.js";
import { registerBrainstorm } from "./domains/brainstorm/index.js";
import { registerProject } from "./domains/project/index.js";
import { registerKanban } from "./domains/kanban/index.js";
import { registerEngineering } from "./domains/engineering/index.js";
import { registerQe } from "./domains/qe/index.js";
import { registerPlatform } from "./domains/platform/index.js";
import { registerProduct } from "./domains/product/index.js";
import { registerData } from "./domains/data/index.js";
import { registerDelivery } from "./domains/delivery/index.js";
import { registerAgentic } from "./domains/agentic/index.js";
import { registerScenarios } from "./domains/scenarios/index.js";
import { registerPatch } from "./domains/patch/index.js";
import { registerContextAssembler } from "./context/assembler.js";

// ── Domain registrar map ───────────────────────────────────────────────────────

const DOMAIN_REGISTRARS: Record<DomainName, DomainRegistrar> = {
  memory: registerMemory,
  search: registerSearch,
  brainstorm: registerBrainstorm,
  project: registerProject,
  kanban: registerKanban,
  engineering: registerEngineering,
  qe: registerQe,
  platform: registerPlatform,
  product: registerProduct,
  data: registerData,
  delivery: registerDelivery,
  agentic: registerAgentic,
  scenarios: registerScenarios,
  patch: registerPatch,
};

// ── Path helpers ───────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return p;
}

// ── Config resolver ────────────────────────────────────────────────────────────

function resolveConfig(config?: RdeConfig): ResolvedConfig {
  const rawPath = config?.storePath ?? "~/.pi/agent/rde";
  const storePath = expandHome(rawPath);

  const capabilities: Set<DomainName> =
    !config?.capabilities || config.capabilities === "all"
      ? new Set(DOMAIN_NAMES)
      : new Set(config.capabilities);

  return {
    storePath,
    guardrails: config?.guardrails ?? true,
    capabilities,
    ai: undefined,
    storeRegistry: new Map(),
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create an rde-coding-agent pi-mono extension.
 *
 * @example
 * ```typescript
 * // ~/.pi/agent/extensions/rde.ts
 * import { rdeCodingAgent } from "rde-coding-agent";
 * export default rdeCodingAgent({ capabilities: "all" });
 * ```
 */
export function rdeCodingAgent(
  config?: RdeConfig,
): (pi: PiExtensionAPI) => void {
  const resolved = resolveConfig(config);

  return (pi: PiExtensionAPI): void => {
    // Capture AI and model resolver from pi-mono if available
    if (pi.ai && !resolved.ai) {
      resolved.ai = pi.ai;
    }
    if (pi.getModel && !resolved.getModel) {
      resolved.getModel = () => pi.getModel!();
    }

    const enabled = [...resolved.capabilities];

    for (const domain of enabled) {
      const registrar = DOMAIN_REGISTRARS[domain];
      if (!registrar) continue;
      try {
        registrar(pi, resolved);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[rde-coding-agent] Failed to register domain "${domain}": ${message}`,
        );
      }
    }

    // Register cross-domain context assembler (after domains populate storeRegistry)
    registerContextAssembler(pi, resolved);
  };
}
