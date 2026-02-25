/**
 * Kanban domain — registers tools and commands with pi-mono.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { KanbanStore } from "./store.js";
import { registerKanbanTools } from "./tools.js";
import { registerKanbanCommands } from "./commands.js";

export function registerKanban(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  const store = new KanbanStore(config.storePath);
  config.storeRegistry.set("kanban", store);
  registerKanbanTools(pi, store);
  registerKanbanCommands(pi, store);
}
