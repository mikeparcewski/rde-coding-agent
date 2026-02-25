/**
 * Project domain — registers tools, commands, and hooks with pi-mono.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { ProjectStore } from "./store.js";
import { registerProjectTools } from "./tools.js";
import { registerProjectCommands } from "./commands.js";
import { registerProjectHooks } from "./hooks.js";

export function registerProject(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  const store = new ProjectStore(config.storePath);
  config.storeRegistry.set("project", store);
  registerProjectTools(pi, store);
  registerProjectCommands(pi, store);
  registerProjectHooks(pi, store);
}
