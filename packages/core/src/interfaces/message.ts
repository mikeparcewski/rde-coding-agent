import { z } from "zod";

export const RoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type Role = z.infer<typeof RoleSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: RoleSchema,
  content: z.string(),
  timestamp: z.number().int().positive(),
  toolCallId: z.string().optional(),  // for role=tool responses
  metadata: z.record(z.unknown()).optional(),
});
export type Message = z.infer<typeof MessageSchema>;
