/**
 * ProjectStore — wraps JsonStore for per-project state.
 *
 * Each project is stored as a separate JSON file:
 *   {storePath}/projects/{project-id}.json
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-store.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProjectAdvance {
  id: string;
  timestamp: string;
  summary: string;
  completedGoals: string[];
  addedGoals: string[];
  sessionId: string;
}

export interface ProjectRecord {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  phase: "active" | "paused" | "complete";
  goals: string[];
  createdAt: string;
  updatedAt: string;
  sessionIds: string[];
  advances: ProjectAdvance[];
}

// ── Migration ──────────────────────────────────────────────────────────────────

function migrateProjectRecord(raw: Record<string, unknown>): ProjectRecord {
  return {
    schemaVersion: 1,
    id: (raw["id"] as string | undefined) ?? "",
    name: (raw["name"] as string | undefined) ?? "",
    description: (raw["description"] as string | undefined) ?? "",
    phase: (raw["phase"] as ProjectRecord["phase"] | undefined) ?? "active",
    goals: (raw["goals"] as string[] | undefined) ?? [],
    createdAt:
      (raw["createdAt"] as string | undefined) ?? new Date().toISOString(),
    updatedAt:
      (raw["updatedAt"] as string | undefined) ?? new Date().toISOString(),
    sessionIds: (raw["sessionIds"] as string[] | undefined) ?? [],
    advances: (raw["advances"] as ProjectAdvance[] | undefined) ?? [],
  };
}

// ── ProjectStore ───────────────────────────────────────────────────────────────

export class ProjectStore {
  private readonly projectsDir: string;

  constructor(storePath: string) {
    this.projectsDir = join(storePath, "projects");
  }

  private storeFor(id: string): JsonStore<ProjectRecord> {
    const path = join(this.projectsDir, `${id}.json`);
    return new JsonStore<ProjectRecord>(
      path,
      1,
      migrateProjectRecord,
      () =>
        ({
          schemaVersion: 1,
          id,
          name: "",
          description: "",
          phase: "active" as const,
          goals: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sessionIds: [],
          advances: [],
        }) satisfies ProjectRecord,
    );
  }

  async get(id: string): Promise<ProjectRecord | null> {
    const store = this.storeFor(id);
    const record = await store.read();
    // If the record has no name it was never written — treat as not found
    if (!record.name) return null;
    return record;
  }

  async startOrResume(opts: {
    id: string;
    name: string;
    description: string;
    goals: string[];
    sessionId: string;
  }): Promise<ProjectRecord> {
    const store = this.storeFor(opts.id);
    const existing = await store.read();
    const now = new Date().toISOString();

    if (existing.name) {
      // Resume existing project
      return store.update((current) => ({
        ...current,
        phase: current.phase === "complete" ? "active" : current.phase,
        sessionIds: current.sessionIds.includes(opts.sessionId)
          ? current.sessionIds
          : [...current.sessionIds, opts.sessionId],
        updatedAt: now,
      }));
    }

    // Create new project
    const record: ProjectRecord = {
      schemaVersion: 1,
      id: opts.id,
      name: opts.name,
      description: opts.description,
      phase: "active",
      goals: opts.goals,
      createdAt: now,
      updatedAt: now,
      sessionIds: [opts.sessionId],
      advances: [],
    };
    await store.write(record);
    return record;
  }

  async advance(opts: {
    projectId: string;
    summary: string;
    completedGoals: string[];
    newGoals: string[];
    sessionId: string;
  }): Promise<ProjectRecord> {
    const store = this.storeFor(opts.projectId);
    return store.update((current) => {
      const advance: ProjectAdvance = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        summary: opts.summary,
        completedGoals: opts.completedGoals,
        addedGoals: opts.newGoals,
        sessionId: opts.sessionId,
      };

      // Remove completed goals from active goals, add new ones
      const remainingGoals = current.goals.filter(
        (g) => !opts.completedGoals.includes(g),
      );
      const updatedGoals = [...remainingGoals, ...opts.newGoals];

      return {
        ...current,
        goals: updatedGoals,
        advances: [...current.advances, advance],
        updatedAt: new Date().toISOString(),
        sessionIds: current.sessionIds.includes(opts.sessionId)
          ? current.sessionIds
          : [...current.sessionIds, opts.sessionId],
      };
    });
  }

  async setPhase(
    id: string,
    phase: ProjectRecord["phase"],
  ): Promise<ProjectRecord> {
    const store = this.storeFor(id);
    return store.update((current) => ({
      ...current,
      phase,
      updatedAt: new Date().toISOString(),
    }));
  }
}
