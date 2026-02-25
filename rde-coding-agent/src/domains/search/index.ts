/**
 * Search domain — registers tools and commands with pi-mono.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { registerSearchTools } from "./tools.js";
import { registerSearchCommands } from "./commands.js";

export function registerSearch(
  pi: PiExtensionAPI,
  _config: ResolvedConfig,
): void {
  registerSearchTools(pi);
  registerSearchCommands(pi);
}
