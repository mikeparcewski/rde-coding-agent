/**
 * Memory domain tools: remember, recall, forget.
 */

import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import type { MemoryStore } from "./store.js";

export function registerMemoryTools(
  pi: PiExtensionAPI,
  store: MemoryStore,
): void {
  // ── remember ────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Store a fact, decision, note, or preference for recall in future sessions. " +
      "Use type='decision' for architectural choices, 'procedural' for how-to steps, " +
      "'preference' for user preferences, 'episodic' for general facts.",
    parameters: Type.Object({
      content: Type.String({ description: "The fact or note to remember" }),
      type: Type.Optional(
        Type.Union(
          [
            Type.Literal("episodic"),
            Type.Literal("decision"),
            Type.Literal("procedural"),
            Type.Literal("preference"),
          ],
          { description: "Memory type; defaults to 'episodic'" },
        ),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tags for filtering recall (e.g. ['auth', 'security'])",
        }),
      ),
      importance: Type.Optional(
        Type.Union(
          [
            Type.Literal("low"),
            Type.Literal("medium"),
            Type.Literal("high"),
          ],
          { description: "Memory importance; defaults to 'medium'" },
        ),
      ),
      project_id: Type.Optional(
        Type.String({
          description:
            "Associate with a specific project slug; omit for global memory",
        }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const entry = await store.remember(input["content"] as string, {
        type: input["type"] as
          | "episodic"
          | "decision"
          | "procedural"
          | "preference"
          | undefined,
        tags: (input["tags"] as string[] | undefined) ?? [],
        importance: input["importance"] as
          | "low"
          | "medium"
          | "high"
          | undefined,
        projectId: (input["project_id"] as string | undefined) ?? null,
      });
      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              stored: true,
              id: entry.id,
              type: entry.type,
              importance: entry.importance,
              tags: entry.tags,
            }),
          },
        ],
      };
    },
  });

  // ── recall ───────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description:
      "Search stored memories by content, tags, or type. Returns matching entries sorted by importance.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search term to match against content and tags",
      }),
      project_id: Type.Optional(
        Type.String({
          description:
            "Filter to a specific project; omit to include global memories",
        }),
      ),
      type: Type.Optional(
        Type.Union([
          Type.Literal("episodic"),
          Type.Literal("decision"),
          Type.Literal("procedural"),
          Type.Literal("preference"),
        ]),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Filter by these tags (any match)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum entries to return; defaults to 20",
          minimum: 1,
          maximum: 100,
        }),
      ),
      mode: Type.Optional(
        Type.Union(
          [Type.Literal("search"), Type.Literal("stats")],
          {
            description:
              "Mode: 'search' returns matching entries (default), 'stats' returns counts by type, tag, and importance.",
          },
        ),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const mode = (input["mode"] as string | undefined) ?? "search";

      if (mode === "stats") {
        const all = await store.readAll();
        const byType: Record<string, number> = {};
        const byImportance: Record<string, number> = {};
        const byTag: Record<string, number> = {};

        for (const entry of all) {
          byType[entry.type] = (byType[entry.type] ?? 0) + 1;
          byImportance[entry.importance] =
            (byImportance[entry.importance] ?? 0) + 1;
          for (const tag of entry.tags) {
            byTag[tag] = (byTag[tag] ?? 0) + 1;
          }
        }

        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                total: all.length,
                byType,
                byImportance,
                byTag,
              }),
            },
          ],
        };
      }

      const entries = await store.recall(input["query"] as string, {
        projectId: input["project_id"] as string | undefined,
        type: input["type"] as
          | "episodic"
          | "decision"
          | "procedural"
          | "preference"
          | undefined,
        tags: input["tags"] as string[] | undefined,
        limit: (input["limit"] as number | undefined) ?? 20,
      });
      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ entries, count: entries.length }),
          },
        ],
      };
    },
  });

  // ── forget ───────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "forget",
    label: "Forget",
    description: "Delete a specific stored memory by its id.",
    parameters: Type.Object({
      id: Type.String({ description: "The memory entry id to delete" }),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate,
    ) {
      const deleted = await store.forget(input["id"] as string);
      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted, id: input["id"] }),
          },
        ],
      };
    },
  });
}
