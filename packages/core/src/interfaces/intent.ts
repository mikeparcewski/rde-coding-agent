import { z } from "zod";

export const CapabilityTagSchema = z.enum([
  // Stage 1 (MVP)
  "code-review", "debug", "refactor", "architecture-analysis", "implementation",
  "test-strategy", "test-scenarios", "test-execution",
  "orchestrate", "phase-routing", "progress-report",
  "memory-store", "memory-recall",
  "context-assembly",
  // Stage 2
  "security-scan", "compliance-check", "cicd-pipeline",
  "requirements", "brainstorm", "ux-review", "acceptance-criteria",
  // Stage 3
  "data-analysis", "pipeline-design", "ml-guidance",
  "code-patch", "cross-language-propagation",
  // Meta
  "general",  // fallback when no specific capability matches
]);
export type CapabilityTag = z.infer<typeof CapabilityTagSchema>;

export const IntentSignalSchema = z.object({
  pattern: z.string(),                    // regex pattern for trie matching
  capability: CapabilityTagSchema,
  confidence: z.number().min(0).max(1),   // base confidence for this pattern
  keywords: z.array(z.string()),          // exact keyword triggers
});
export type IntentSignal = z.infer<typeof IntentSignalSchema>;

export const RoutingResultSchema = z.object({
  capability: CapabilityTagSchema,
  confidence: z.number().min(0).max(1),
  tier: z.enum(["fast", "llm"]),          // which tier resolved this
  agentId: z.string(),                     // resolved agent to handle this
  narration: z.string(),                   // human-readable routing explanation
});
export type RoutingResult = z.infer<typeof RoutingResultSchema>;
