/**
 * QE domain registrar.
 *
 * Registers test strategy, scenario generation, and automation stub tools
 * with their corresponding slash commands.
 */

import type { DomainRegistrar, PiExtensionAPI, ResolvedConfig } from "../../types.js";
import {
  testStrategyTool,
  generateScenariosTool,
  testAutomationTool,
} from "./tools.js";
import { registerCommands } from "./commands.js";

export const register: DomainRegistrar = (pi, _config) => {
  pi.registerTool(testStrategyTool);
  pi.registerTool(generateScenariosTool);
  pi.registerTool(testAutomationTool);
  registerCommands(pi);
};

/** Named export used by extension.ts */
export function registerQe(pi: PiExtensionAPI, config: ResolvedConfig): void {
  register(pi, config);
}
