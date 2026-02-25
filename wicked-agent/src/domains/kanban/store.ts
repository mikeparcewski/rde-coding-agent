/**
 * KanbanStore — wraps JsonStore for per-project task board state.
 *
 * Each project's kanban board is stored as:
 *   {storePath}/kanban/{project-id}.kanban.json
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-store.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "todo" | "in-progress" | "done" | "blocked";
export type TaskPriority = "high" | "medium" | "low";

export interface KanbanNote {
  id: string;
  text: string;
  timestamp: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  notes: KanbanNote[];
}

export interface KanbanBoard {
  schemaVersion: number;
  projectId: string;
  tasks: KanbanTask[];
  createdAt: string;
  updatedAt: string;
}

// ── Migration ──────────────────────────────────────────────────────────────────

function migrateKanbanBoard(raw: Record<string, unknown>): KanbanBoard {
  return {
    schemaVersion: 1,
    projectId: (raw["projectId"] as string | undefined) ?? "",
    tasks: (raw["tasks"] as KanbanTask[] | undefined) ?? [],
    createdAt:
      (raw["createdAt"] as string | undefined) ?? new Date().toISOString(),
    updatedAt:
      (raw["updatedAt"] as string | undefined) ?? new Date().toISOString(),
  };
}

// ── KanbanStore ────────────────────────────────────────────────────────────────

export class KanbanStore {
  private readonly kanbanDir: string;

  constructor(storePath: string) {
    this.kanbanDir = join(storePath, "kanban");
  }

  private storeFor(projectId: string): JsonStore<KanbanBoard> {
    const path = join(this.kanbanDir, `${projectId}.kanban.json`);
    const now = new Date().toISOString();
    return new JsonStore<KanbanBoard>(
      path,
      1,
      migrateKanbanBoard,
      () => ({
        schemaVersion: 1,
        projectId,
        tasks: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  async createTask(opts: {
    projectId: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
  }): Promise<KanbanTask> {
    const store = this.storeFor(opts.projectId);
    const now = new Date().toISOString();

    const task: KanbanTask = {
      id: randomUUID(),
      title: opts.title,
      description: opts.description,
      status: opts.status,
      priority: opts.priority,
      createdAt: now,
      updatedAt: now,
      notes: [],
    };

    await store.update((board) => ({
      ...board,
      tasks: [...board.tasks, task],
      updatedAt: now,
    }));

    return task;
  }

  async listTasks(
    projectId: string,
    statusFilter?: string,
  ): Promise<{
    tasks: KanbanTask[];
    counts: Record<TaskStatus, number>;
    total: number;
  }> {
    const store = this.storeFor(projectId);
    const board = await store.read();

    const filtered =
      statusFilter && statusFilter !== "all"
        ? board.tasks.filter((t) => t.status === statusFilter)
        : board.tasks;

    // Sort: high priority first, then by creation time
    const priorityOrder: Record<TaskPriority, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };
    const sorted = [...filtered].sort((a, b) => {
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const counts: Record<TaskStatus, number> = {
      todo: 0,
      "in-progress": 0,
      done: 0,
      blocked: 0,
    };
    for (const task of board.tasks) {
      counts[task.status]++;
    }

    return { tasks: sorted, counts, total: board.tasks.length };
  }

  async updateTask(opts: {
    projectId: string;
    taskId: string;
    status?: string;
    priority?: string;
    description?: string;
    appendNote?: string;
  }): Promise<KanbanTask | null> {
    const store = this.storeFor(opts.projectId);
    const now = new Date().toISOString();
    let updatedTask: KanbanTask | null = null;

    await store.update((board) => {
      const taskIndex = board.tasks.findIndex((t) => t.id === opts.taskId);
      if (taskIndex === -1) return board;

      const task = board.tasks[taskIndex]!;
      const notes = opts.appendNote
        ? [
            ...task.notes,
            {
              id: randomUUID(),
              text: opts.appendNote,
              timestamp: now,
            },
          ]
        : task.notes;

      updatedTask = {
        ...task,
        status: (opts.status as TaskStatus | undefined) ?? task.status,
        priority:
          (opts.priority as TaskPriority | undefined) ?? task.priority,
        description: opts.description ?? task.description,
        notes,
        updatedAt: now,
      };

      const tasks = [...board.tasks];
      tasks[taskIndex] = updatedTask;
      return { ...board, tasks, updatedAt: now };
    });

    return updatedTask;
  }
}
