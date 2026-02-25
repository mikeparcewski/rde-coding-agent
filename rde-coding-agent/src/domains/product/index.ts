/**
 * Product domain registrar.
 *
 * Registers requirements elicitation, UX review, and acceptance criteria tools.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import {
  elicitRequirementsTool,
  uxReviewTool,
  acceptanceCriteriaTool,
  feedbackAnalyzeTool,
  onboardGuideTool,
  a11yAuditTool,
  competitiveAnalyzeTool,
} from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(elicitRequirementsTool);
  pi.registerTool(uxReviewTool);
  pi.registerTool(acceptanceCriteriaTool);
  pi.registerTool(feedbackAnalyzeTool);
  pi.registerTool(onboardGuideTool);
  pi.registerTool(a11yAuditTool);
  pi.registerTool(competitiveAnalyzeTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerProduct(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
