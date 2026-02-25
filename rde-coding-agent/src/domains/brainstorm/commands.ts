/**
 * Brainstorm domain slash commands: /brainstorm, /jam
 */

import type { PiExtensionAPI, PiCommandContext } from "../../types.js";
import { DEFAULT_PERSONAS } from "./personas.js";

export function registerBrainstormCommands(pi: PiExtensionAPI): void {
  // /brainstorm <topic> [--personas architect,skeptic,...] [--context "..."] [--full]
  pi.registerCommand(
    "/brainstorm",
    async (args: string, ctx: PiCommandContext) => {
      const { topic, personas, context, full } = parseBrainstormArgs(args);

      if (!topic) {
        ctx.ui.showMessage(
          "warn",
          "Usage: /brainstorm <topic> [--personas p1,p2,...] [--context \"...\"] [--full]\n" +
            `Default personas: ${DEFAULT_PERSONAS.join(", ")}`,
        );
        return;
      }

      const personaList = personas.join(", ") || DEFAULT_PERSONAS.join(", ");
      ctx.ui.showMessage(
        "info",
        `Starting brainstorm on: "${topic}"\nPersonas: ${personaList}\nThis may take 30-60 seconds...`,
      );
    },
  );

  // /jam <proposal> [--context "..."]
  pi.registerCommand("/jam", async (args: string, ctx: PiCommandContext) => {
    const { proposal, context } = parseJamArgs(args);

    if (!proposal) {
      ctx.ui.showMessage(
        "warn",
        'Usage: /jam <proposal> [--context "additional context"]',
      );
      return;
    }

    ctx.ui.showMessage(
      "info",
      `Running quick jam on: "${proposal}"\nRunning skeptic + advocate in parallel...`,
    );
  });
}

// ── Argument parsers ───────────────────────────────────────────────────────────

function parseBrainstormArgs(args: string): {
  topic: string;
  personas: string[];
  context?: string;
  full: boolean;
} {
  const parts = args.trim().split(/\s+/);
  const topicParts: string[] = [];
  let personas: string[] = [];
  let context: string | undefined;
  let full = false;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--personas" && parts[i + 1]) {
      personas = parts[i + 1]!.split(",").map((p) => p.trim());
      i++;
    } else if (parts[i] === "--context" && parts[i + 1]) {
      // Collect quoted or unquoted context value
      context = parts[i + 1]!.replace(/^["']|["']$/g, "");
      i++;
    } else if (parts[i] === "--full") {
      full = true;
    } else {
      topicParts.push(parts[i]!);
    }
  }

  return { topic: topicParts.join(" "), personas, context, full };
}

function parseJamArgs(args: string): {
  proposal: string;
  context?: string;
} {
  const parts = args.trim().split(/\s+/);
  const proposalParts: string[] = [];
  let context: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--context" && parts[i + 1]) {
      context = parts[i + 1]!.replace(/^["']|["']$/g, "");
      i++;
    } else {
      proposalParts.push(parts[i]!);
    }
  }

  return { proposal: proposalParts.join(" "), context };
}
