import { z } from "zod";

/**
 * Schema for the YAML frontmatter block in agent markdown files.
 *
 * @example
 * ---
 * id: coder
 * name: Code Assistant
 * description: Expert TypeScript and systems programmer
 * model: claude-opus-4-6
 * allowedTools:
 *   - read_file
 *   - write_file
 * maxTurns: 50
 * ---
 */
export const AgentFrontmatterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, {
    message: 'Agent id must start with a lowercase letter and contain only lowercase letters, digits, and hyphens',
  }),
  name: z.string().min(1, { message: "Agent name must not be empty" }),
  description: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  allowedTools: z.array(z.string()).default(["*"]),
  maxTurns: z.number().int().positive().default(30),
  // Inline system prompt — markdown body is appended after this
  systemPrompt: z.string().optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
