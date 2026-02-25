import { z } from "zod";

export const CompletionConditionSchema = z.object({
  id: z.string(),
  description: z.string(),               // human-readable done condition
  check: z.enum(["artifact", "assertion", "manual"]),
  artifactPattern: z.string().optional(), // glob for artifact check (e.g., "*.md")
  assertionFn: z.function().optional(),   // runtime assertion function
});
export type CompletionCondition = z.infer<typeof CompletionConditionSchema>;

export const CompletionContractSchema = z.object({
  capability: z.string(),
  conditions: z.array(CompletionConditionSchema).min(1),
  maxTurns: z.number().int().positive().default(30),
  timeoutMs: z.number().int().positive().default(300_000),  // 5 min default
});
export type CompletionContract = z.infer<typeof CompletionContractSchema>;

export const CompletionResultSchema = z.object({
  done: z.boolean(),
  satisfiedConditions: z.array(z.string()),   // condition ids met
  unsatisfiedConditions: z.array(z.string()),  // condition ids not yet met
  summary: z.string(),
  artifacts: z.array(z.string()),              // file paths created/modified
  turnsUsed: z.number().int(),
  durationMs: z.number().int(),
});
export type CompletionResult = z.infer<typeof CompletionResultSchema>;

export const ProgressEventSchema = z.object({
  capability: z.string(),
  turnNumber: z.number(),
  maxTurns: z.number(),
  satisfiedConditions: z.array(z.string()),
  totalConditions: z.number(),
  currentActivity: z.string(),  // human-readable, e.g. "Reviewing auth/login.ts (3/12 files)"
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
