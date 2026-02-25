import { z } from "zod";
import type { Tool } from "./tool.js";

export const SkillFrontmatterSchema = z.object({
  name: z.string().regex(/^\/[a-z][a-z0-9-]*$/),  // must start with /
  description: z.string().min(1),
  version: z.string().optional(),
  author: z.string().optional(),
  // parameters defined inline in frontmatter for purely markdown skills
  parameters: z.record(z.object({
    type: z.enum(["string", "number", "boolean"]),
    description: z.string(),
    required: z.boolean().default(false),
  })).optional(),
  // if true, a co-located .ts handler MUST exist
  requiresHandler: z.boolean().default(false),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export const SkillConfigSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  markdownBody: z.string(),
  handlerPath: z.string().optional(),  // resolved path to .ts/.js handler
  // compiled tool derived from this skill
  tool: z.custom<Tool>().optional(),
  sourceFile: z.string(),
});
export type SkillConfig = z.infer<typeof SkillConfigSchema>;

export const SkillModeSchema = z.enum(["strict", "permissive"]);
export type SkillMode = z.infer<typeof SkillModeSchema>;
