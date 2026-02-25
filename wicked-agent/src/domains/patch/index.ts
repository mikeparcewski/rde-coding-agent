/**
 * Patch domain — structured code generation via symbol-graph patches.
 *
 * Provides tools for codebase-wide rename, add-field, and remove operations
 * using ripgrep for reference discovery and structured patch plans.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { registerPatchTools } from "./tools.js";
import { registerPatchCommands } from "./commands.js";

export function registerPatch(
  pi: PiExtensionAPI,
  _config: ResolvedConfig,
): void {
  registerPatchTools(pi);
  registerPatchCommands(pi);
}
