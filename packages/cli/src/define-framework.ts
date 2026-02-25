import { z } from "zod";
import type { LLMAdapter } from "@the-agent/core";

const ProviderConfigSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("anthropic"),
    apiKey: z.string(),
    defaultModel: z.string().default("claude-opus-4-6"),
  }),
  z.object({
    provider: z.literal("openai"),
    apiKey: z.string(),
    defaultModel: z.string().default("gpt-4o"),
  }),
  z.object({
    provider: z.literal("google"),
    apiKey: z.string(),
    defaultModel: z.string().default("gemini-2.0-flash"),
  }),
  z.object({
    provider: z.literal("ollama"),
    baseUrl: z.string().url().default("http://localhost:11434"),
    defaultModel: z.string(),
  }),
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  backend: z.enum(["sqlite", "json-file"]).default("json-file"),
  path: z.string().optional(),
  maxEntries: z.number().int().positive().default(1000),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttlSeconds: z.number().int().positive().default(300),
  maxSizeMb: z.number().positive().default(50),
});

export type CacheConfig = z.infer<typeof CacheConfigSchema>;

const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().url().optional(),
  serviceName: z.string().default("the-agent"),
});

export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

export const FrameworkConfigSchema = z.object({
  // Which LLM provider to use
  llm: ProviderConfigSchema,

  // Directories to scan for skills and agents (relative to project root)
  skillsDir: z.string().default("./skills"),
  agentsDir: z.string().default("./agents"),

  // How to handle malformed or handler-less skills
  skillMode: z.enum(["strict", "permissive"]).default("permissive"),

  // Default agent if none is specified
  defaultAgent: z.string().optional(),

  // Optional overrides
  memory: MemoryConfigSchema.optional(),
  cache: CacheConfigSchema.optional(),

  // Custom adapters — for teams that bring their own LLM client
  customAdapter: z.custom<LLMAdapter>().optional(),

  // Telemetry / observability
  telemetry: TelemetryConfigSchema.optional(),
});

export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;

/**
 * defineFramework() is the single configuration entry point.
 * Place it in agent.config.ts at the project root.
 * Validates the config at definition time — fail fast before any runtime work.
 *
 * @example
 * // agent.config.ts
 * import { defineFramework } from "@the-agent/cli";
 *
 * export default defineFramework({
 *   llm: {
 *     provider: "anthropic",
 *     apiKey: process.env.ANTHROPIC_API_KEY!,
 *     defaultModel: "claude-opus-4-6",
 *   },
 *   skillsDir: "./skills",
 *   agentsDir: "./agents",
 *   skillMode: "permissive",
 *   defaultAgent: "default",
 *   memory: { enabled: true, backend: "sqlite" },
 * });
 */
export function defineFramework(config: FrameworkConfig): FrameworkConfig {
  return FrameworkConfigSchema.parse(config);
}
