/**
 * MemoryStore — wraps JsonlStore with domain-level operations.
 *
 * Each MemoryEntry is a structured fact stored by the agent across sessions.
 * The JSONL backing file is append-only for concurrency safety.
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonlStore } from "../../store/jsonl-store.js";

export interface MemoryEntry {
  schemaVersion: 1;
  id: string;
  content: string;
  type: "episodic" | "decision" | "procedural" | "preference";
  tags: string[];
  importance: "low" | "medium" | "high";
  createdAt: string;
  accessCount: number;
  projectId: string | null;
  sessionId: string;
}

// ── Migration ──────────────────────────────────────────────────────────────────

function migrateMemoryEntry(raw: Record<string, unknown>): MemoryEntry {
  const version = raw["schemaVersion"] as number | undefined;

  if (version === undefined || version < 1) {
    return {
      schemaVersion: 1,
      id: (raw["id"] as string | undefined) ?? randomUUID(),
      content: (raw["content"] as string | undefined) ?? "",
      type: (raw["type"] as MemoryEntry["type"] | undefined) ?? "episodic",
      tags: (raw["tags"] as string[] | undefined) ?? [],
      importance:
        (raw["importance"] as MemoryEntry["importance"] | undefined) ??
        "medium",
      createdAt:
        (raw["createdAt"] as string | undefined) ?? new Date().toISOString(),
      accessCount: (raw["accessCount"] as number | undefined) ?? 0,
      projectId: (raw["projectId"] as string | null | undefined) ?? null,
      sessionId: (raw["sessionId"] as string | undefined) ?? "unknown",
    };
  }

  // Future versions: add cases here
  return raw as unknown as MemoryEntry;
}

// ── MemoryStore ────────────────────────────────────────────────────────────────

export class MemoryStore {
  private readonly store: JsonlStore<MemoryEntry>;

  constructor(storePath: string) {
    this.store = new JsonlStore<MemoryEntry>(
      join(storePath, "memory", "memories.jsonl"),
      1,
      migrateMemoryEntry,
    );
  }

  async remember(
    content: string,
    options: {
      type?: MemoryEntry["type"];
      tags?: string[];
      importance?: MemoryEntry["importance"];
      projectId?: string | null;
      sessionId?: string;
    } = {},
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      schemaVersion: 1,
      id: randomUUID(),
      content,
      type: options.type ?? "episodic",
      tags: options.tags ?? [],
      importance: options.importance ?? "medium",
      createdAt: new Date().toISOString(),
      accessCount: 0,
      projectId: options.projectId ?? null,
      sessionId: options.sessionId ?? "unknown",
    };
    await this.store.append(entry);
    return entry;
  }

  async recall(
    query: string,
    options: {
      projectId?: string | null;
      tags?: string[];
      type?: MemoryEntry["type"];
      limit?: number;
    } = {},
  ): Promise<MemoryEntry[]> {
    const all = await this.store.readAll();
    const lower = query.toLowerCase().trim();

    let results = all.filter((e) => {
      // Project filter
      if (options.projectId !== undefined) {
        const matches =
          e.projectId === options.projectId || e.projectId === null;
        if (!matches) return false;
      }

      // Type filter
      if (options.type && e.type !== options.type) return false;

      // Tag filter
      if (options.tags && options.tags.length > 0) {
        const entryTagsLower = e.tags.map((t) => t.toLowerCase());
        const hasTag = options.tags.some((tag) =>
          entryTagsLower.includes(tag.toLowerCase()),
        );
        if (!hasTag) return false;
      }

      // Text match
      if (lower) {
        const contentMatch = e.content.toLowerCase().includes(lower);
        const tagMatch = e.tags.some((t) => t.toLowerCase().includes(lower));
        return contentMatch || tagMatch;
      }

      return true;
    });

    // Sort by importance then recency
    results = results.sort((a, b) => {
      const importanceOrder = { high: 3, medium: 2, low: 1 };
      const importanceDiff =
        importanceOrder[b.importance] - importanceOrder[a.importance];
      if (importanceDiff !== 0) return importanceDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (options.limit != null && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async forget(id: string): Promise<boolean> {
    return this.store.deleteById(id);
  }

  async readAll(): Promise<MemoryEntry[]> {
    return this.store.readAll();
  }
}
