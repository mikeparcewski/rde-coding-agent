/**
 * Engineering domain registrar.
 *
 * Registers tools and commands for code review, debugging, architecture
 * review, and documentation generation.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import {
  codeReviewTool,
  debugAnalyzeTool,
  architectureReviewTool,
  generateDocsTool,
} from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(codeReviewTool);
  pi.registerTool(debugAnalyzeTool);
  pi.registerTool(architectureReviewTool);
  pi.registerTool(generateDocsTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerEngineering(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  register(pi, config);
}
