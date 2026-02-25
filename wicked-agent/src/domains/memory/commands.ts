/**
 * Memory domain slash commands: /remember, /recall
 */

import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import type { MemoryStore } from "./store.js";

export function registerMemoryCommands(
  pi: PiExtensionAPI,
  store: MemoryStore,
): void {
  // /remember <content> [--tags tag1,tag2] [--type decision|episodic|procedural|preference] [--importance low|medium|high]
  pi.registerCommand(
    "/remember",
    async (args: string, ctx: PiCommandContext) => {
      const { content, tags, type, importance } = parseRememberArgs(args);

      if (!content) {
        ctx.ui.showMessage(
          "warn",
          "Usage: /remember <content> [--tags tag1,tag2] [--type decision|episodic|procedural|preference] [--importance low|medium|high]",
        );
        return;
      }

      const entry = await store.remember(content, {
        tags,
        type,
        importance,
        sessionId: ctx.session.id,
      });

      ctx.ui.showMessage(
        "info",
        `Remembered [${entry.importance}/${entry.type}]: "${entry.content.slice(0, 80)}${entry.content.length > 80 ? "..." : ""}" (id: ${entry.id.slice(0, 8)})`,
      );
    },
  );

  // /recall <query> [--type decision|episodic|procedural|preference] [--tags tag1,tag2]
  pi.registerCommand(
    "/recall",
    async (args: string, ctx: PiCommandContext) => {
      const { query, type, tags, limit } = parseRecallArgs(args);

      const entries = await store.recall(query, { type, tags, limit });

      if (entries.length === 0) {
        ctx.ui.showMessage(
          "info",
          `No memories found${query ? ` matching "${query}"` : ""}.`,
        );
        return;
      }

      const lines = entries.map((e) => {
        const tagStr = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
        return `[${e.importance}/${e.type}]${tagStr} ${e.content} (${e.id.slice(0, 8)})`;
      });

      ctx.ui.showMessage(
        "info",
        `Found ${entries.length} memories:\n${lines.join("\n")}`,
      );
    },
  );
}

// ── Argument parsers ───────────────────────────────────────────────────────────

function parseRememberArgs(args: string): {
  content: string;
  tags: string[];
  type?: "episodic" | "decision" | "procedural" | "preference";
  importance?: "low" | "medium" | "high";
} {
  const parts = args.trim().split(/\s+/);
  const contentParts: string[] = [];
  let tags: string[] = [];
  let type: "episodic" | "decision" | "procedural" | "preference" | undefined;
  let importance: "low" | "medium" | "high" | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--tags" && parts[i + 1]) {
      tags = parts[i + 1]!.split(",").map((t) => t.trim());
      i++;
    } else if (parts[i] === "--type" && parts[i + 1]) {
      type = parts[i + 1] as typeof type;
      i++;
    } else if (parts[i] === "--importance" && parts[i + 1]) {
      importance = parts[i + 1] as typeof importance;
      i++;
    } else {
      contentParts.push(parts[i]!);
    }
  }

  return { content: contentParts.join(" "), tags, type, importance };
}

function parseRecallArgs(args: string): {
  query: string;
  type?: "episodic" | "decision" | "procedural" | "preference";
  tags?: string[];
  limit?: number;
} {
  const parts = args.trim().split(/\s+/);
  const queryParts: string[] = [];
  let type: "episodic" | "decision" | "procedural" | "preference" | undefined;
  let tags: string[] | undefined;
  let limit: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--type" && parts[i + 1]) {
      type = parts[i + 1] as typeof type;
      i++;
    } else if (parts[i] === "--tags" && parts[i + 1]) {
      tags = parts[i + 1]!.split(",").map((t) => t.trim());
      i++;
    } else if (parts[i] === "--limit" && parts[i + 1]) {
      limit = parseInt(parts[i + 1]!, 10);
      i++;
    } else {
      queryParts.push(parts[i]!);
    }
  }

  return { query: queryParts.join(" "), type, tags, limit };
}
