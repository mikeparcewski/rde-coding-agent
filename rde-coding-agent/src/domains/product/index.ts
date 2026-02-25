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
} from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(elicitRequirementsTool);
  pi.registerTool(uxReviewTool);
  pi.registerTool(acceptanceCriteriaTool);
  pi.registerTool(feedbackAnalyzeTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerProduct(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
