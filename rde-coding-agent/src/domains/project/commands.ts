/**
 * Project domain slash commands: /project with subcommands.
 *
 * /project start <id> <name>       — start or resume a project
 * /project status <id>             — show project status
 * /project advance <id> <summary>  — log progress
 * /project pause <id>              — pause a project
 * /project complete <id>           — mark complete
 */

import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import type { ProjectStore } from "./store.js";

export function registerProjectCommands(
  pi: PiExtensionAPI,
  store: ProjectStore,
): void {
  pi.registerCommand(
    "/project",
    async (args: string, ctx: PiCommandContext) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() ?? "";
      const rest = parts.slice(1);

      switch (subcommand) {
        case "start": {
          const id = rest[0];
          const name = rest.slice(1).join(" ");

          if (!id) {
            ctx.ui.showMessage(
              "warn",
              "Usage: /project start <id> [name]\n  Example: /project start auth-refactor Authentication Refactor",
            );
            return;
          }

          const project = await store.startOrResume({
            id,
            name: name || id,
            description: "",
            goals: [],
            sessionId: ctx.session.id,
          });

          const resumed = project.sessionIds.length > 1;
          ctx.ui.showMessage(
            "info",
            resumed
              ? `Resumed project "${project.name}" (${project.phase}, ${project.goals.length} goals, ${project.advances.length} advances)`
              : `Started new project "${project.name}" (id: ${project.id})`,
          );
          break;
        }

        case "status": {
          const id = rest[0];

          if (!id) {
            ctx.ui.showMessage("warn", "Usage: /project status <id>");
            return;
          }

          const project = await store.get(id);
          if (!project) {
            ctx.ui.showMessage(
              "warn",
              `Project "${id}" not found. Use /project start <id> to create it.`,
            );
            return;
          }

          const goalLines =
            project.goals.length > 0
              ? project.goals.map((g) => `  - ${g}`).join("\n")
              : "  (no goals defined)";

          const recentAdvance = project.advances[project.advances.length - 1];
          const advanceLine = recentAdvance
            ? `\nLast advance: ${recentAdvance.summary.slice(0, 100)} (${new Date(recentAdvance.timestamp).toLocaleDateString()})`
            : "";

          ctx.ui.showMessage(
            "info",
            `Project: ${project.name} [${project.phase}]\n` +
              `Goals (${project.goals.length}):\n${goalLines}` +
              advanceLine +
              `\n${project.advances.length} advances logged`,
          );
          break;
        }

        case "advance": {
          const id = rest[0];
          const summary = rest.slice(1).join(" ");

          if (!id || !summary) {
            ctx.ui.showMessage(
              "warn",
              "Usage: /project advance <id> <summary>\n  Example: /project advance auth-refactor Completed JWT implementation",
            );
            return;
          }

          const project = await store.advance({
            projectId: id,
            summary,
            completedGoals: [],
            newGoals: [],
            sessionId: ctx.session.id,
          });

          ctx.ui.showMessage(
            "info",
            `Progress logged for "${project.id}": "${summary.slice(0, 80)}"\n${project.goals.length} goals remaining.`,
          );
          break;
        }

        case "pause": {
          const id = rest[0];
          if (!id) {
            ctx.ui.showMessage("warn", "Usage: /project pause <id>");
            return;
          }
          await store.setPhase(id, "paused");
          ctx.ui.showMessage("info", `Project "${id}" paused.`);
          break;
        }

        case "complete": {
          const id = rest[0];
          if (!id) {
            ctx.ui.showMessage("warn", "Usage: /project complete <id>");
            return;
          }
          await store.setPhase(id, "complete");
          ctx.ui.showMessage("info", `Project "${id}" marked complete.`);
          break;
        }

        default: {
          ctx.ui.showMessage(
            "info",
            "Usage: /project <subcommand>\n" +
              "  /project start <id> [name]\n" +
              "  /project status <id>\n" +
              "  /project advance <id> <summary>\n" +
              "  /project pause <id>\n" +
              "  /project complete <id>",
          );
        }
      }
    },
  );
}
