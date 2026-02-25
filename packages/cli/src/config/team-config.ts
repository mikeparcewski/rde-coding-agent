import { z } from "zod";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";

export const TeamConfigSchema = z.object({
  capabilities: z.record(z.object({
    agent: z.string().optional(),
    provider: z.string().optional(),
    done_condition: z.string().optional(),
    max_turns: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional(),
  })).optional(),

  tools: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    command: z.string(),
    description: z.string(),
    timeout_ms: z.number().int().positive().default(30_000),
  })).optional(),

  providers: z.record(z.object({
    adapter: z.enum(["anthropic", "openai", "google", "ollama"]),
    model: z.string(),
    api_key_env: z.string().optional(),
    base_url: z.string().url().optional(),
  })).optional(),

  compat_mode: z.boolean().default(false),
}).strict();

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

/**
 * Loads and validates .agent/config.yaml from the project root.
 * Returns undefined if the file does not exist (team config is optional).
 * Throws on parse or validation failure.
 *
 * Uses gray-matter for YAML parsing (same parser used throughout the framework).
 */
export async function loadTeamConfig(
  projectRoot: string
): Promise<TeamConfig | undefined> {
  const configPath = resolve(projectRoot, ".agent", "config.yaml");

  try {
    await access(configPath);
  } catch {
    return undefined;
  }

  const content = await readFile(configPath, "utf-8");

  // gray-matter can parse standalone YAML files via matter.read
  // For a pure YAML file (no frontmatter), we wrap it in fake frontmatter
  // and extract the data, or use the underlying yaml engine directly.
  let raw: unknown;

  try {
    // gray-matter's underlying yaml engine via matter('')
    // A .yaml file with no markdown body is parsed via: matter('---\n' + content + '\n---')
    const parsed = matter(`---\n${content}\n---`);
    raw = parsed.data;
  } catch (err) {
    throw new Error(
      `Failed to parse .agent/config.yaml: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const result = TeamConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid .agent/config.yaml: ${issues}`);
  }

  return result.data;
}
