/**
 * Memory domain — registers tools, commands, and hooks with pi-mono.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { MemoryStore } from "./store.js";
import { registerMemoryTools } from "./tools.js";
import { registerMemoryCommands } from "./commands.js";
import { registerMemoryHooks } from "./hooks.js";

export function registerMemory(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  const store = new MemoryStore(config.storePath);
  config.storeRegistry.set("memory", store);
  registerMemoryTools(pi, store);
  registerMemoryCommands(pi, store);
  registerMemoryHooks(pi, store);
}
