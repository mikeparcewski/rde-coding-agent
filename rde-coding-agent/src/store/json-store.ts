/**
 * Atomic JSON store for project and kanban state.
 * Uses temp-file + rename for crash-safe writes.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface JsonDocument {
  schemaVersion: number;
}

export class JsonStore<T extends JsonDocument> {
  private readonly path: string;
  private readonly currentVersion: number;
  private readonly migrate: (raw: Record<string, unknown>) => T;
  private readonly defaultValue: () => T;

  constructor(
    path: string,
    currentVersion: number,
    migrate: (raw: Record<string, unknown>) => T,
    defaultValue: () => T,
  ) {
    this.path = path;
    this.currentVersion = currentVersion;
    this.migrate = migrate;
    this.defaultValue = defaultValue;
  }

  async read(): Promise<T> {
    try {
      const raw = await readFile(this.path, "utf-8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj["schemaVersion"] === this.currentVersion) {
        return obj as T;
      }
      return this.migrate(obj);
    } catch {
      return this.defaultValue();
    }
  }

  async write(data: T): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.tmp-${randomUUID()}.json`);
    await writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    await rename(tmpPath, this.path);
  }

  async update(fn: (current: T) => T): Promise<T> {
    const current = await this.read();
    const updated = fn(current);
    await this.write(updated);
    return updated;
  }
}
