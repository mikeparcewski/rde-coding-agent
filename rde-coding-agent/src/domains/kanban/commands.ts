/**
 * Kanban domain slash commands: /task, /board
 *
 * /task create <project> <title>    — create a task
 * /task done <project> <task-id>    — mark done
 * /task start <project> <task-id>   — mark in-progress
 * /task block <project> <task-id>   — mark blocked
 * /board <project>                  — show board summary
 */

import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import type { KanbanStore, TaskStatus } from "./store.js";

export function registerKanbanCommands(
  pi: PiExtensionAPI,
  store: KanbanStore,
): void {
  // /task — create and update tasks
  pi.registerCommand("/task", async (args: string, ctx: PiCommandContext) => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() ?? "";
    const rest = parts.slice(1);

    switch (subcommand) {
      case "create": {
        const projectId = rest[0];
        const title = rest.slice(1).join(" ");

        if (!projectId || !title) {
          ctx.ui.showMessage(
            "warn",
            "Usage: /task create <project-id> <title>\n  Example: /task create auth-refactor Implement JWT middleware",
          );
          return;
        }

        const task = await store.createTask({
          projectId,
          title,
          description: "",
          status: "todo",
          priority: "medium",
        });

        ctx.ui.showMessage(
          "info",
          `Task created: "${task.title}" [${task.status}/${task.priority}] (id: ${task.id.slice(0, 8)})`,
        );
        break;
      }

      case "done":
      case "start":
      case "block": {
        const projectId = rest[0];
        const taskId = rest[1];

        if (!projectId || !taskId) {
          ctx.ui.showMessage(
            "warn",
            `Usage: /task ${subcommand} <project-id> <task-id>`,
          );
          return;
        }

        const statusMap: Record<string, TaskStatus> = {
          done: "done",
          start: "in-progress",
          block: "blocked",
        };

        const newStatus = statusMap[subcommand]!;
        const task = await store.updateTask({
          projectId,
          taskId,
          status: newStatus,
        });

        if (!task) {
          ctx.ui.showMessage(
            "warn",
            `Task "${taskId}" not found in project "${projectId}".`,
          );
          return;
        }

        ctx.ui.showMessage(
          "info",
          `Task "${task.title}" is now ${task.status}.`,
        );
        break;
      }

      case "list": {
        const projectId = rest[0];
        const statusFilter = rest[1];

        if (!projectId) {
          ctx.ui.showMessage("warn", "Usage: /task list <project-id> [status]");
          return;
        }

        const result = await store.listTasks(projectId, statusFilter);

        if (result.total === 0) {
          ctx.ui.showMessage(
            "info",
            `No tasks found for project "${projectId}".`,
          );
          return;
        }

        const lines = [
          `Tasks for "${projectId}" (${result.total} total):`,
          `  todo: ${result.counts.todo}  in-progress: ${result.counts["in-progress"]}  blocked: ${result.counts.blocked}  done: ${result.counts.done}`,
          "",
        ];

        for (const task of result.tasks) {
          lines.push(
            `  [${task.priority}] [${task.status}] ${task.title} (${task.id.slice(0, 8)})`,
          );
        }

        ctx.ui.showMessage("info", lines.join("\n"));
        break;
      }

      default: {
        ctx.ui.showMessage(
          "info",
          "Usage: /task <subcommand>\n" +
            "  /task create <project-id> <title>\n" +
            "  /task start <project-id> <task-id>\n" +
            "  /task done <project-id> <task-id>\n" +
            "  /task block <project-id> <task-id>\n" +
            "  /task list <project-id> [status]",
        );
      }
    }
  });

  // /board <project-id> — show a formatted kanban board
  pi.registerCommand("/board", async (args: string, ctx: PiCommandContext) => {
    const projectId = args.trim();

    if (!projectId) {
      ctx.ui.showMessage("warn", "Usage: /board <project-id>");
      return;
    }

    const result = await store.listTasks(projectId);

    if (result.total === 0) {
      ctx.ui.showMessage(
        "info",
        `No tasks on the board for project "${projectId}". Use /task create to add tasks.`,
      );
      return;
    }

    const columns: Array<{ status: TaskStatus; label: string }> = [
      { status: "in-progress", label: "In Progress" },
      { status: "blocked", label: "Blocked" },
      { status: "todo", label: "Todo" },
      { status: "done", label: "Done" },
    ];

    const lines = [`Board: ${projectId}`];

    for (const col of columns) {
      const colTasks = result.tasks.filter((t) => t.status === col.status);
      if (colTasks.length === 0) continue;
      lines.push(`\n${col.label} (${colTasks.length}):`);
      for (const task of colTasks) {
        const noteCount =
          task.notes.length > 0 ? ` [${task.notes.length} notes]` : "";
        lines.push(
          `  [${task.priority}] ${task.title}${noteCount} (${task.id.slice(0, 8)})`,
        );
      }
    }

    ctx.ui.showMessage("info", lines.join("\n"));
  });
}
