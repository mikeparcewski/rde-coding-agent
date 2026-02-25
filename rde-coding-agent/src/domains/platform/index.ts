/**
 * Platform domain registrar.
 *
 * Registers security, compliance, and CI/CD review tools with commands,
 * plus a gate hook that blocks dangerous operations when guardrails are enabled.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { securityScanTool, complianceCheckTool, ciCdReviewTool, incidentTriageTool, ciGenerateTool, iacReviewTool, releasePlanTool, errorAnalysisTool, auditEvidenceTool, privacyScanTool } from "./tools.js";
import { registerCommands } from "./commands.js";
import { registerHooks } from "./hooks.js";

export const register: DomainRegistrar = (pi, config) => {
  pi.registerTool(securityScanTool);
  pi.registerTool(complianceCheckTool);
  pi.registerTool(ciCdReviewTool);
  pi.registerTool(incidentTriageTool);
  pi.registerTool(ciGenerateTool);
  pi.registerTool(iacReviewTool);
  pi.registerTool(releasePlanTool);
  pi.registerTool(errorAnalysisTool);
  pi.registerTool(auditEvidenceTool);
  pi.registerTool(privacyScanTool);
  registerCommands(pi);
  registerHooks(pi, config.guardrails);
};

/** Named export used by extension.ts */
export function registerPlatform(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
