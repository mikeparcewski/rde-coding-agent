/**
 * Scenarios domain — markdown-based E2E test runner.
 *
 * Parses .md scenario files, extracts steps, executes them,
 * and returns structured pass/fail reports.
 */

import type { PiExtensionAPI, ResolvedConfig } from "../../types.js";
import { registerScenariosTools } from "./tools.js";
import { registerScenariosCommands } from "./commands.js";

export function registerScenarios(
  pi: PiExtensionAPI,
  _config: ResolvedConfig,
): void {
  registerScenariosTools(pi);
  registerScenariosCommands(pi);
}
