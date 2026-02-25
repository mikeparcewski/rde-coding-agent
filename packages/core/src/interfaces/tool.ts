import { z } from "zod";

export const ToolParameterSchema = z.object({
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  description: z.string(),
  required: z.boolean().default(false),
  enum: z.array(z.string()).optional(),
  items: z.lazy((): z.ZodTypeAny => ToolParameterSchema).optional(),
});
export type ToolParameter = z.infer<typeof ToolParameterSchema>;

export const ToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().min(1),
  parameters: z.record(ToolParameterSchema),
  handler: z.function(
    z.tuple([z.record(z.unknown())]),
    z.promise(z.unknown())
  ),
  // which skill or agent registered this tool
  source: z.enum(["skill", "agent", "builtin"]),
  sourceId: z.string().optional(),
});
export type Tool = z.infer<typeof ToolSchema>;

export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string().uuid(),
  name: z.string(),
  output: z.unknown(),
  error: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
