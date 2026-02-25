/**
 * Append-only JSONL store for memory entries.
 * Each line is a JSON object with `id` and `schemaVersion` fields.
 * Appends are POSIX-safe for concurrent processes.
 */

import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonlEntry {
  id: string;
  schemaVersion: number;
}

export class JsonlStore<T extends JsonlEntry> {
  private readonly path: string;
  private readonly currentVersion: number;
  private readonly migrate: (raw: Record<string, unknown>) => T;

  constructor(
    path: string,
    currentVersion: number,
    migrate: (raw: Record<string, unknown>) => T,
  ) {
    this.path = path;
    this.currentVersion = currentVersion;
    this.migrate = migrate;
  }

  async readAll(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf-8");
    } catch {
      return [];
    }

    const entries: T[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (obj["schemaVersion"] === this.currentVersion) {
          entries.push(obj as T);
        } else {
          entries.push(this.migrate(obj));
        }
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  }

  async append(entry: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n", "utf-8");
  }

  async deleteById(id: string): Promise<boolean> {
    const entries = await this.readAll();
    const filtered = entries.filter((e) => e.id !== id);
    if (filtered.length === entries.length) return false;
    await mkdir(dirname(this.path), { recursive: true });
    const content = filtered.map((e) => JSON.stringify(e)).join("\n") + (filtered.length > 0 ? "\n" : "");
    await writeFile(this.path, content, "utf-8");
    return true;
  }

  async filter(predicate: (entry: T) => boolean): Promise<T[]> {
    const all = await this.readAll();
    return all.filter(predicate);
  }
}
