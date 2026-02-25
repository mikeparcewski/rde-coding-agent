/**
 * Delivery domain registrar.
 *
 * Registers experiment design, risk assessment, and progress report tools.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { experimentDesignTool, riskAssessTool, progressReportTool, rolloutPlanTool, costAnalyzeTool } from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(experimentDesignTool);
  pi.registerTool(riskAssessTool);
  pi.registerTool(progressReportTool);
  pi.registerTool(rolloutPlanTool);
  pi.registerTool(costAnalyzeTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerDelivery(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
