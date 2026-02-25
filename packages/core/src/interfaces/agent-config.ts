import { z } from "zod";

export const AgentConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  // resolved file path to the markdown persona document
  personaFile: z.string().optional(),
  systemPrompt: z.string().optional(),
  // tools this agent is allowed to call (name pattern or *)
  allowedTools: z.array(z.string()).default(["*"]),
  model: z.string().optional(),  // overrides framework default
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().default(30),
  hooks: z.object({
    beforeTurn: z.function().optional(),
    afterTurn: z.function().optional(),
    onError: z.function().optional(),
  }).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
