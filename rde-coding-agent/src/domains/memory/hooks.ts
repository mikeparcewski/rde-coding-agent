/**
 * Memory domain lifecycle hooks.
 *
 * session_start  — detect current project, pre-fetch relevant memories (primes)
 * session_shutdown — flush transient state
 *
 * Note: context injection is handled by the cross-domain context assembler
 * (src/context/assembler.ts) which queries the memory store via the store
 * registry each turn.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PiExtensionAPI } from "../../types.js";
import type { MemoryStore, MemoryEntry } from "./store.js";

// ── Session state ──────────────────────────────────────────────────────────────

interface SessionMemoryState {
  sessionId: string;
  projectId: string | null;
  primeMemories: MemoryEntry[];
}

let sessionState: SessionMemoryState | null = null;

// ── Registrar ──────────────────────────────────────────────────────────────────

export function registerMemoryHooks(
  pi: PiExtensionAPI,
  store: MemoryStore,
): void {
  // session_start: identify current project and pre-fetch relevant memories
  pi.on("session_start", async (event, ctx) => {
    const startEvent = event as { sessionId?: string; cwd?: string };
    const sessionId = startEvent.sessionId ?? ctx.session?.id ?? "unknown";
    const cwd = startEvent.cwd ?? ctx.session?.cwd ?? process.cwd();

    const projectId = await detectProjectId(cwd);
    const primeMemories = await store.recall("", {
      projectId,
      limit: 20,
    });

    sessionState = {
      sessionId,
      projectId,
      primeMemories,
    };
  });

  // Note: memory context injection is handled by the cross-domain context
  // assembler (src/context/assembler.ts) which queries the memory store via
  // the store registry each turn. No legacy context hook is needed here.

  // session_shutdown: clear transient state
  pi.on("session_shutdown", async (_event, _ctx) => {
    sessionState = null;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function detectProjectId(cwd: string): Promise<string | null> {
  // Walk up directory tree looking for .pi/project file
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
