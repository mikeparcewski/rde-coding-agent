/**
 * Brainstorm domain tools: brainstorm, quick_jam.
 *
 * The brainstorm tool fires persona sub-calls in parallel using pi.ai.streamSimple(),
 * collects results with Promise.allSettled (one failure does not cancel others),
 * then synthesises a final decision record.
 */

import { Type } from "@sinclair/typebox";
import type { PiExtensionAPI, PiCommandContext, PiAI, PiModel } from "../../types.js";
import {
  BUILT_IN_PERSONAS,
  DEFAULT_PERSONAS,
  resolvePersona,
  type PersonaDef,
} from "./personas.js";

const PERSONA_TIMEOUT_MS = 45_000;

// ── Persona call with timeout ──────────────────────────────────────────────────

async function callPersonaWithTimeout(
  ai: PiAI,
  persona: PersonaDef,
  topic: string,
  context: string | undefined,
  model: unknown,
): Promise<string> {
  const prompt = buildPersonaPrompt(topic, context);

  const piModel =
    typeof model === "object" && model !== null && "id" in model && "provider" in model
      ? (model as import("../../types.js").PiModel)
      : null;

  if (!piModel) {
    throw new Error(
      `Brainstorm requires a valid model. Received: ${JSON.stringify(model)}. ` +
      `Ensure the calling context passes ctx.getModel() result.`
    );
  }

  const personaPromise = ai.streamSimple({
    model: piModel,
    systemPrompt: persona.systemPrompt,
    prompt,
    maxTokens: 1024,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `Persona "${persona.name}" timed out after ${PERSONA_TIMEOUT_MS}ms`,
          ),
        ),
      PERSONA_TIMEOUT_MS,
    ),
  );

  return Promise.race([personaPromise, timeoutPromise]);
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildPersonaPrompt(topic: string, context: string | undefined): string {
  const parts: string[] = [];
  if (context) parts.push(`Background context:\n${context}`);
  parts.push(`Topic to analyse:\n${topic}`);
  parts.push(
    "Provide your perspective in 3-5 concise paragraphs. Be specific, opinionated, and concrete. " +
      "Avoid vague generalities.",
  );
  return parts.join("\n\n");
}

function buildSynthesisPrompt(
  topic: string,
  responses: PersonaResponse[],
): string {
  const personaBlock = responses
    .map((r) =>
      r.content
        ? `## ${r.persona} (${r.label})\n${r.content}`
        : `## ${r.persona}\n[FAILED: ${r.error}]`,
    )
    .join("\n\n---\n\n");

  return (
    `Topic: "${topic}"\n\n` +
    `The following perspectives were collected from ${responses.length} personas:\n\n` +
    `${personaBlock}\n\n` +
    `Synthesise the above into:\n` +
    `1. **Key themes** — what patterns appear across perspectives\n` +
    `2. **Points of consensus** — where personas agree\n` +
    `3. **Points of tension** — where perspectives conflict\n` +
    `4. **Recommended direction** — concrete next steps with rationale\n\n` +
    `Be specific and actionable. Do not repeat each perspective verbatim.`
  );
}

const SYNTHESIS_SYSTEM_PROMPT =
  "You are a synthesis facilitator with deep expertise in decision-making and engineering. " +
  "Your role is to distil multiple expert perspectives into a coherent, actionable decision record. " +
  "Focus on patterns, tensions, and a clear recommendation. Be direct and specific.";

// ── Result types ───────────────────────────────────────────────────────────────

interface PersonaResponse {
  persona: string;
  label: string;
  content: string | null;
  error: string | null;
}

// ── Tool registrar ─────────────────────────────────────────────────────────────

export function registerBrainstormTools(
  pi: PiExtensionAPI,
  ai: PiAI | undefined,
  getModel?: () => Promise<PiModel>,
): void {
  // ── brainstorm ───────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "brainstorm",
    label: "Brainstorm",
    description:
      "Run a multi-perspective brainstorm session. Fires parallel persona sub-calls " +
      "then synthesises their outputs into a structured decision record with key themes, " +
      "consensus, tensions, and a recommended direction.",
    parameters: Type.Object({
      topic: Type.String({
        description: "The question, decision, or problem to brainstorm",
      }),
      personas: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Persona names to engage. Defaults to: architect, skeptic, user-advocate, " +
            "pragmatist, devils-advocate. Built-in: architect, skeptic, user-advocate, " +
            "product-manager, devils-advocate, pragmatist, innovator.",
        }),
      ),
      context: Type.Optional(
        Type.String({
          description:
            "Background context, constraints, or requirements for the personas",
        }),
      ),
      format: Type.Optional(
        Type.Union(
          [Type.Literal("summary"), Type.Literal("full")],
          {
            description:
              "Output format: 'summary' (default, synthesis only) or 'full' (all persona responses + synthesis)",
          },
        ),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      onUpdate,
    ) {
      if (!ai) {
        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "Brainstorm requires pi.ai to be available. Ensure the brainstorm domain is loaded with AI access.",
              }),
            },
          ],
        };
      }

      const topic = input["topic"] as string;
      const personaNames = (input["personas"] as string[] | undefined) ??
        DEFAULT_PERSONAS;
      const context = input["context"] as string | undefined;
      const format = (input["format"] as string | undefined) ?? "summary";

      const personas = personaNames.map(resolvePersona);

      onUpdate?.({ type: "text", text: `Brainstorming with ${personas.length} personas...` });

      // Resolve the active model from pi-mono context
      if (!getModel) {
        throw new Error(
          "Brainstorm requires a model resolver. Ensure the extension is loaded " +
          "with getModel access from pi-mono (pi.getModel).",
        );
      }
      const model = await getModel();

      // Fire all persona calls in parallel
      const settled = await Promise.allSettled(
        personas.map((persona) =>
          callPersonaWithTimeout(ai, persona, topic, context, model),
        ),
      );

      const responses: PersonaResponse[] = settled.map((result, i) => {
        const persona = personas[i]!;
        if (result.status === "fulfilled") {
          return {
            persona: persona.name,
            label: persona.label,
            content: result.value,
            error: null,
          };
        }
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        return {
          persona: persona.name,
          label: persona.label,
          content: null,
          error: message,
        };
      });

      const successful = responses.filter((r) => r.content !== null);

      if (successful.length === 0) {
        throw new Error(
          "All persona calls failed. Check AI connectivity and try again.",
        );
      }

      onUpdate?.({ type: "text", text: `Synthesising ${successful.length} perspectives...` });

      const synthesis = await ai.streamSimple({
        model,
        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
        prompt: buildSynthesisPrompt(topic, responses),
        maxTokens: 2048,
      });

      const result = {
        topic,
        synthesis,
        personaResponses: format === "full" ? responses : undefined,
        successCount: successful.length,
        failureCount: responses.length - successful.length,
      };

      return {
        type: "text" as const,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  });

  // ── quick_jam ────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "quick_jam",
    label: "Quick Jam",
    description:
      "Fast two-perspective jam: runs a skeptic and a user-advocate in parallel on a specific " +
      "proposal, then produces a verdict. Useful for rapid sanity checks.",
    parameters: Type.Object({
      proposal: Type.String({
        description: "The proposal or idea to evaluate",
      }),
      context: Type.Optional(
        Type.String({ description: "Additional background context" }),
      ),
    }),
    async execute(
      _id: string,
      input: Record<string, unknown>,
      _signal: AbortSignal,
      onUpdate,
    ) {
      if (!ai) {
        return {
          type: "text" as const,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "quick_jam requires pi.ai to be available.",
              }),
            },
          ],
        };
      }

      const proposal = input["proposal"] as string;
      const context = input["context"] as string | undefined;

      if (!getModel) {
        throw new Error(
          "quick_jam requires a model resolver. Ensure the extension is loaded " +
          "with getModel access from pi-mono (pi.getModel).",
        );
      }
      const model = await getModel();

      const skepticPersona = BUILT_IN_PERSONAS["skeptic"]!;
      const advocatePersona = BUILT_IN_PERSONAS["user-advocate"]!;

      onUpdate?.({ type: "text", text: "Running critic and advocate in parallel..." });

      const [criticResult, advocateResult] = await Promise.allSettled([
        ai.streamSimple({
          model,
          systemPrompt: skepticPersona.systemPrompt,
          prompt: buildPersonaPrompt(proposal, context),
          maxTokens: 512,
        }),
        ai.streamSimple({
          model,
          systemPrompt: advocatePersona.systemPrompt,
          prompt: buildPersonaPrompt(proposal, context),
          maxTokens: 512,
        }),
      ]);

      const critique =
        criticResult.status === "fulfilled"
          ? criticResult.value
          : `Failed: ${String(criticResult.reason)}`;

      const advocacy =
        advocateResult.status === "fulfilled"
          ? advocateResult.value
          : `Failed: ${String(advocateResult.reason)}`;

      onUpdate?.({ type: "text", text: "Generating verdict..." });

      const verdict = await ai.streamSimple({
        model,
        systemPrompt:
          "You are a pragmatic decision maker. Given a critique and advocacy of a proposal, " +
          "produce a one-paragraph verdict with a clear recommendation and rationale.",
        prompt: `Proposal: ${proposal}\n\nCritique:\n${critique}\n\nAdvocacy:\n${advocacy}`,
        maxTokens: 256,
      });

      return {
        type: "text" as const,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ critique, advocacy, verdict }),
          },
        ],
      };
    },
  });
}
