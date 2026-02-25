/**
 * Agentic domain registrar.
 *
 * Registers agent configuration review, safety audit, and architecture
 * pattern check tools with their slash commands.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { agentReviewTool, safetyAuditTool, patternCheckTool } from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(agentReviewTool);
  pi.registerTool(safetyAuditTool);
  pi.registerTool(patternCheckTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerAgentic(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
