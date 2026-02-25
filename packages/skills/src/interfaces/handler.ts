import type { Tool } from "@the-agent/core";

/**
 * Every co-located handler file must export this shape as the default export.
 *
 * @example
 * // skills/commit/handler.ts
 * import { defineSkill } from "@the-agent/skills";
 *
 * export default defineSkill({
 *   tool: {
 *     name: "commit",
 *     description: "Generate a conventional commit message",
 *     parameters: { ... },
 *     source: "skill",
 *     handler: async (args) => { ... },
 *   },
 * });
 */
export interface SkillHandler {
  tool: Tool;
}

/**
 * defineSkill() is a typed identity function.
 * It provides type safety and IDE autocomplete when authoring handlers.
 */
export function defineSkill(handler: SkillHandler): SkillHandler {
  return handler;
}
