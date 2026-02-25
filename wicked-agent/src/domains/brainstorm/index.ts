/**
 * Brainstorm domain — registers tools and commands with pi-mono.
 *
 * The brainstorm tool needs access to pi.ai.streamSimple for persona sub-calls.
 * This is passed via ResolvedConfig.ai.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { registerBrainstormTools } from "./tools.js";
import { registerBrainstormCommands } from "./commands.js";

export function registerBrainstorm(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  registerBrainstormTools(pi, config.ai, config.getModel);
  registerBrainstormCommands(pi);
}
