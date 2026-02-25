import matter from "gray-matter";
import { AgentFrontmatterSchema } from "../interfaces/agent-frontmatter.js";
import type { AgentFrontmatter } from "../interfaces/agent-frontmatter.js";

export interface AgentParseResult {
  frontmatter: AgentFrontmatter;
  markdownBody: string;
}

export interface AgentParseError {
  file: string;
  message: string;
}

/**
 * Parses an agent markdown file's YAML frontmatter and validates it against
 * AgentFrontmatterSchema. Returns either a valid result or a descriptive error.
 */
export function parseAgentFrontmatter(
  content: string,
  filePath: string
): { ok: true; result: AgentParseResult } | { ok: false; error: AgentParseError } {
  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(content);
  } catch (err) {
    return {
      ok: false,
      error: {
        file: filePath,
        message: `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const validation = AgentFrontmatterSchema.safeParse(parsed.data);

  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      error: {
        file: filePath,
        message: `Agent frontmatter validation failed: ${issues}`,
      },
    };
  }

  return {
    ok: true,
    result: {
      frontmatter: validation.data,
      markdownBody: parsed.content.trim(),
    },
  };
}
