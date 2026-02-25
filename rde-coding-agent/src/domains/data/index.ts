/**
 * Data domain registrar.
 *
 * Registers dataset analysis, pipeline review, and ML guidance tools.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { analyzeDatasetTool, pipelineReviewTool, mlGuidanceTool } from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(analyzeDatasetTool);
  pi.registerTool(pipelineReviewTool);
  pi.registerTool(mlGuidanceTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerData(pi: PiExtensionAPI, config: ResolvedConfig): void {
  register(pi, config);
}
