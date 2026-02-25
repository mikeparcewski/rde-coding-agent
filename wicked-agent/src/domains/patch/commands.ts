/**
 * Patch domain slash commands: /rename, /remove
 */

import type { PiExtensionAPI, PiCommandContext } from "../../types.js";

export function registerPatchCommands(pi: PiExtensionAPI): void {
  // /rename <old-name> <new-name> [--glob *.ts] [--path src/]
  pi.registerCommand(
    "/rename",
    async (args: string, ctx: PiCommandContext) => {
      const parts = args.trim().split(/\s+/);
      const oldName = parts[0] ?? "";
      const newName = parts[1] ?? "";

      if (!oldName || !newName) {
        ctx.ui.showMessage(
          "warn",
          "Usage: /rename <old-name> <new-name> [--glob *.ts] [--path src/]",
        );
        return;
      }

      ctx.ui.showMessage(
        "info",
        `To rename "${oldName}" → "${newName}", use the rename_symbol tool ` +
          `which provides a full patch plan with preview.`,
      );
    },
  );

  // /remove <symbol> — find all references for cleanup
  pi.registerCommand(
    "/remove",
    async (args: string, ctx: PiCommandContext) => {
      const symbol = args.trim();

      if (!symbol) {
        ctx.ui.showMessage("warn", "Usage: /remove <symbol-name>");
        return;
      }

      ctx.ui.showMessage(
        "info",
        `To remove "${symbol}", use the remove_symbol tool ` +
          `which finds all references for cleanup.`,
      );
    },
  );
}
