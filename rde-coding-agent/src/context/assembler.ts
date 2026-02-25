/**
 * Cross-domain context assembler.
 *
 * Replaces the memory-only context hook. Each turn, the assembler:
 *   1. Reads fresh data from all registered stores (memory, project, kanban)
 *   2. Builds a token-budgeted system message
 *   3. Injects it via the context event — no state carried between turns
 *
 * The store registry is populated at domain init time. Missing stores
 * are silently skipped (graceful degradation).
 */

import type { PiExtensionAPI, ResolvedConfig } from "../types.js";
import type { MemoryEntry } from "../domains/memory/store.js";

// ── Token budget ────────────────────────────────────────────────────────────

/** Approximate chars-per-token for budget calculations. */
const CHARS_PER_TOKEN = 4;

interface TokenBudget {
  memory: number;
  project: number;
  kanban: number;
}

const DEFAULT_BUDGET: TokenBudget = {
  memory: 1500,   // ~6000 chars
  project: 500,   // ~2000 chars
  kanban: 500,    // ~2000 chars
};

// ── Store interfaces (what we expect from registered stores) ──────────────

interface MemoryStoreLike {
  recall(
    query: string,
    options: { projectId?: string | null; limit?: number },
  ): Promise<MemoryEntry[]>;
}

interface ProjectRecordLike {
  id: string;
  name: string;
  phase: string;
  goals: string[];
}

interface ProjectStoreLike {
  get(id: string): Promise<ProjectRecordLike | null>;
}

interface KanbanTaskLike {
  title: string;
  status: string;
  priority: string;
}

interface KanbanStoreLike {
  listTasks(
    projectId: string,
    statusFilter?: string,
  ): Promise<{
    tasks: KanbanTaskLike[];
    counts: Record<string, number>;
    total: number;
  }>;
}

// ── Assembler ───────────────────────────────────────────────────────────────

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

async function assembleMemoryBlock(
  store: MemoryStoreLike,
  lastUserMessage: string,
  budget: number,
): Promise<string> {
  const entries = await store.recall(lastUserMessage, { limit: 20 });
  if (entries.length === 0) return "";

  const lines = entries.map((m) => {
    const tagStr = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    return `- [${m.type}/${m.importance}]${tagStr} ${m.content}`;
  });

  return truncateToTokens(lines.join("\n"), budget);
}

async function assembleProjectBlock(
  store: ProjectStoreLike,
  projectId: string,
  budget: number,
): Promise<string> {
  const project = await store.get(projectId);
  if (!project) return "";

  const lines = [
    `Project: ${project.name} (${project.phase})`,
  ];
  if (project.goals.length > 0) {
    lines.push("Goals:");
    for (const g of project.goals.slice(0, 10)) {
      lines.push(`  - ${g}`);
    }
  }

  return truncateToTokens(lines.join("\n"), budget);
}

async function assembleKanbanBlock(
  store: KanbanStoreLike,
  projectId: string,
  budget: number,
): Promise<string> {
  const { tasks, counts, total } = await store.listTasks(projectId);
  if (total === 0) return "";

  const lines = [
    `Board: ${total} tasks (todo:${counts["todo"] ?? 0} in-progress:${counts["in-progress"] ?? 0} done:${counts["done"] ?? 0} blocked:${counts["blocked"] ?? 0})`,
  ];

  // Show active tasks (in-progress and blocked first, then todo)
  const active = tasks.filter(
    (t) => t.status === "in-progress" || t.status === "blocked",
  );
  const todo = tasks.filter((t) => t.status === "todo");

  for (const t of [...active, ...todo].slice(0, 10)) {
    lines.push(`  - [${t.status}/${t.priority}] ${t.title}`);
  }

  return truncateToTokens(lines.join("\n"), budget);
}

// ── Hook registrar ──────────────────────────────────────────────────────────

export function registerContextAssembler(
  pi: PiExtensionAPI,
  config: ResolvedConfig,
): void {
  // Detect project ID once at session start; store in closure
  let currentProjectId: string | null = null;

  pi.on("session_start", async (event, ctx) => {
    const startEvent = event as { cwd?: string };
    const cwd = startEvent.cwd ?? ctx.session.cwd;
    currentProjectId = await detectProjectId(cwd);
  });

  // Context hook: assemble fresh context each turn — no cached state
  pi.on("context", async (event, _ctx) => {
    const ctxEvent = event as {
      messages?: Array<{ role: string; content: string }>;
      injectSystemMessage?(msg: string): void;
    };

    if (!ctxEvent.injectSystemMessage) return;

    // Extract last user message for relevant memory recall
    const lastUserMessage =
      ctxEvent.messages
        ?.slice()
        .reverse()
        .find((m) => m.role === "user")?.content?.trim() ?? "";

    const sections: string[] = [];

    // ── Memory ──
    const memoryStore = config.storeRegistry.get("memory") as
      | MemoryStoreLike
      | undefined;
    if (memoryStore) {
      try {
        const block = await assembleMemoryBlock(
          memoryStore,
          lastUserMessage,
          DEFAULT_BUDGET.memory,
        );
        if (block) sections.push(`## Memory\n${block}`);
      } catch {
        // graceful skip
      }
    }

    // ── Project ──
    const projectStore = config.storeRegistry.get("project") as
      | ProjectStoreLike
      | undefined;
    if (projectStore && currentProjectId) {
      try {
        const block = await assembleProjectBlock(
          projectStore,
          currentProjectId,
          DEFAULT_BUDGET.project,
        );
        if (block) sections.push(`## Project\n${block}`);
      } catch {
        // graceful skip
      }
    }

    // ── Kanban ──
    const kanbanStore = config.storeRegistry.get("kanban") as
      | KanbanStoreLike
      | undefined;
    if (kanbanStore && currentProjectId) {
      try {
        const block = await assembleKanbanBlock(
          kanbanStore,
          currentProjectId,
          DEFAULT_BUDGET.kanban,
        );
        if (block) sections.push(`## Kanban\n${block}`);
      } catch {
        // graceful skip
      }
    }

    if (sections.length === 0) return;

    ctxEvent.injectSystemMessage(
      `[Wicked Agent — Situational Context]\n${sections.join("\n\n")}`,
    );
  });

  // Clean up on session end
  pi.on("session_shutdown", async () => {
    currentProjectId = null;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function detectProjectId(cwd: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");

  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    try {
      const content = await readFile(join(dir, ".pi", "project"), "utf-8");
      return content.trim() || null;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
