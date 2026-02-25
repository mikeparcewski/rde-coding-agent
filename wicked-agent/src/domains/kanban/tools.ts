/**
 * Kanban domain tools: task_create, task_list, task_update.
 */

import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI } from "../../types.js";
import type { KanbanStore } from "./store.js";

export function registerKanbanTools(
  pi: PiExtensionAPI,
  store: KanbanStore,
): void {
  // ── task_create ──────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "task_create",
    label: "Create Task",
    description:
      "Create a new task on the kanban board for a project. Tasks track work items " +
      "with status (todo/in-progress/done/blocked) and priority.",
    parameters: Type.Object({
      project_id: Type.String({
        description: "Project slug identifier (e.g. 'auth-refactor')",
      }),
      title: Type.String({ description: "Task title" }),
      description: Type.Optional(
        Type.String({ description: "Detailed task description" }),
      ),
      status: Type.Optional(
        Type.Union(
          [
            Type.Literal("todo"),
            Type.Literal("in-progress"),
            Type.Literal("done"),
            Type.Literal("blocked"),
          ],
          { description: "Initial status; defaults to 'todo'" },
        ),
      ),
      priority: Type.Optional(
        Type.Union(
          [
            Type.Literal("high"),
            Type.Literal("medium"),
            Type.Literal("low"),
          ],
          { description: "Task priority; defaults to 'medium'" },
        ),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const task = await store.createTask({
        projectId: input["project_id"] as string,
        title: input["title"] as string,
        description: (input["description"] as string | undefined) ?? "",
        status:
          (input["status"] as
            | "todo"
            | "in-progress"
            | "done"
            | "blocked"
            | undefined) ?? "todo",
        priority:
          (input["priority"] as "high" | "medium" | "low" | undefined) ??
          "medium",
      });

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task,
              message: `Task "${task.title}" created (id: ${task.id.slice(0, 8)})`,
            }),
          },
        ],
      };
    },
  });

  // ── task_list ────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "task_list",
    label: "List Tasks",
    description:
      "List tasks for a project, optionally filtered by status. Returns tasks sorted by priority.",
    parameters: Type.Object({
      project_id: Type.String({ description: "Project slug identifier" }),
      status: Type.Optional(
        Type.Union(
          [
            Type.Literal("todo"),
            Type.Literal("in-progress"),
            Type.Literal("done"),
            Type.Literal("blocked"),
            Type.Literal("all"),
          ],
          { description: "Filter by status; 'all' returns everything" },
        ),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const statusFilter = input["status"] as string | undefined;
      const result = await store.listTasks(
        input["project_id"] as string,
        statusFilter === "all" ? undefined : statusFilter,
      );

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  });

  // ── task_update ──────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "task_update",
    label: "Update Task",
    description:
      "Update the status, priority, or description of an existing task. " +
      "Use append_note to add progress notes without replacing the description.",
    parameters: Type.Object({
      project_id: Type.String({ description: "Project slug identifier" }),
      task_id: Type.String({
        description: "Task id (full UUID or first 8 characters)",
      }),
      status: Type.Optional(
        Type.Union([
          Type.Literal("todo"),
          Type.Literal("in-progress"),
          Type.Literal("done"),
          Type.Literal("blocked"),
        ]),
      ),
      priority: Type.Optional(
        Type.Union([
          Type.Literal("high"),
          Type.Literal("medium"),
          Type.Literal("low"),
        ]),
      ),
      description: Type.Optional(
        Type.String({ description: "Replace the task description" }),
      ),
      append_note: Type.Optional(
        Type.String({
          description: "Append a progress note to the task's history",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const task = await store.updateTask({
        projectId: input["project_id"] as string,
        taskId: input["task_id"] as string,
        status: input["status"] as string | undefined,
        priority: input["priority"] as string | undefined,
        description: input["description"] as string | undefined,
        appendNote: input["append_note"] as string | undefined,
      });

      if (!task) {
        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Task "${input["task_id"]}" not found in project "${input["project_id"]}".`,
              }),
            },
          ],
        };
      }

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task,
              message: `Task updated: "${task.title}" is now ${task.status} [${task.priority}]`,
            }),
          },
        ],
      };
    },
  });
}
