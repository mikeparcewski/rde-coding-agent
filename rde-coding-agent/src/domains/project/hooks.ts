/**
 * Project domain lifecycle hooks.
 *
 * session_start   — load the active project from the .pi/project file
 * context         — inject active project goals into LLM context
 * session_shutdown — persist any pending state
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PiExtensionAPI } from "../../types.js";
import type { ProjectStore, ProjectRecord } from "./store.js";

// ── Session state ──────────────────────────────────────────────────────────────

let activeProject: ProjectRecord | null = null;

// ── Registrar ──────────────────────────────────────────────────────────────────

export function registerProjectHooks(
  pi: PiExtensionAPI,
  store: ProjectStore,
): void {
  // session_start: load active project based on .pi/project file
  pi.on("session_start", async (event, ctx) => {
    const startEvent = event as { cwd?: string };
    const cwd = startEvent.cwd ?? ctx.session.cwd;

    const projectId = await detectProjectId(cwd);
    if (!projectId) {
      activeProject = null;
      return;
    }

    try {
      const project = await store.get(projectId);
      activeProject = project;
    } catch {
      activeProject = null;
    }
  });

  // context: inject active project context into LLM before each call
  pi.on("context", async (event, _ctx) => {
    if (!activeProject) return;

    const ctxEvent = event as {
      injectSystemMessage?(msg: string): void;
    };

    if (!ctxEvent.injectSystemMessage) return;

    const goalLines =
      activeProject.goals.length > 0
        ? activeProject.goals.map((g) => `- ${g}`).join("\n")
        : "(no active goals)";

    ctxEvent.injectSystemMessage(
      `[Active Project: ${activeProject.name}]\n` +
        `Phase: ${activeProject.phase}\n` +
        `Goals:\n${goalLines}`,
    );
  });

  // session_shutdown: clear state
  pi.on("session_shutdown", async (_event, _ctx) => {
    activeProject = null;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function detectProjectId(cwd: string): Promise<string | null> {
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
