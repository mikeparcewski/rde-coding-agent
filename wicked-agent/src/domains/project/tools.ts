/**
 * Project domain tools: project_start, project_status, project_advance.
 */

import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI } from "../../types.js";
import type { ProjectStore } from "./store.js";

export function registerProjectTools(
  pi: PiExtensionAPI,
  store: ProjectStore,
): void {
  // ── project_start ────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "project_start",
    label: "Start Project",
    description:
      "Create a new project or resume an existing one. Sets the active project for this session. " +
      "Projects track goals, advances, and are persisted across sessions.",
    parameters: Type.Object({
      id: Type.String({
        description:
          "Project slug identifier (e.g. 'auth-refactor'). Used as the filename.",
      }),
      name: Type.String({ description: "Human-readable project name" }),
      description: Type.Optional(
        Type.String({ description: "Project description and context" }),
      ),
      goals: Type.Optional(
        Type.Array(Type.String(), {
          description: "Initial project goals or deliverables",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const project = await store.startOrResume({
        id: input["id"] as string,
        name: input["name"] as string,
        description: (input["description"] as string | undefined) ?? "",
        goals: (input["goals"] as string[] | undefined) ?? [],
        sessionId: "current",
      });

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              project,
              resumed: project.sessionIds.length > 1,
              message: project.sessionIds.length > 1
                ? `Resumed project "${project.name}" (${project.advances.length} advances logged)`
                : `Started new project "${project.name}"`,
            }),
          },
        ],
      };
    },
  });

  // ── project_status ───────────────────────────────────────────────────────────

  pi.registerTool({
    name: "project_status",
    label: "Project Status",
    description:
      "Return the current status, goals, and recent advance history of a project.",
    parameters: Type.Object({
      id: Type.String({ description: "Project slug identifier" }),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const project = await store.get(input["id"] as string);

      if (!project) {
        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Project "${input["id"]}" not found. Use project_start to create it.`,
              }),
            },
          ],
        };
      }

      // Include last 5 advances for context
      const recentAdvances = project.advances.slice(-5);

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              id: project.id,
              name: project.name,
              description: project.description,
              phase: project.phase,
              goals: project.goals,
              goalsCount: project.goals.length,
              advancesCount: project.advances.length,
              recentAdvances,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              sessionCount: project.sessionIds.length,
            }),
          },
        ],
      };
    },
  });

  // ── project_advance ──────────────────────────────────────────────────────────

  pi.registerTool({
    name: "project_advance",
    label: "Advance Project",
    description:
      "Record progress on a project: log what was accomplished, mark goals as complete, " +
      "and optionally add new goals. Creates an immutable advance log entry.",
    parameters: Type.Object({
      id: Type.String({ description: "Project slug identifier" }),
      summary: Type.String({
        description: "Summary of what was accomplished in this advance",
      }),
      completed_goals: Type.Optional(
        Type.Array(Type.String(), {
          description: "Goals from the current list that are now complete",
        }),
      ),
      new_goals: Type.Optional(
        Type.Array(Type.String(), {
          description: "New goals to add to the project",
        }),
      ),
      phase: Type.Optional(
        Type.Union(
          [
            Type.Literal("active"),
            Type.Literal("paused"),
            Type.Literal("complete"),
          ],
          { description: "Update the project phase" },
        ),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const project = await store.advance({
        projectId: input["id"] as string,
        summary: input["summary"] as string,
        completedGoals: (input["completed_goals"] as string[] | undefined) ?? [],
        newGoals: (input["new_goals"] as string[] | undefined) ?? [],
        sessionId: "current",
      });

      // Update phase if specified
      if (input["phase"]) {
        await store.setPhase(
          input["id"] as string,
          input["phase"] as "active" | "paused" | "complete",
        );
      }

      const advance = project.advances[project.advances.length - 1]!;

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              advance,
              remainingGoals: project.goals,
              phase: project.phase,
              message: `Progress logged. ${project.goals.length} goals remaining.`,
            }),
          },
        ],
      };
    },
  });
}
