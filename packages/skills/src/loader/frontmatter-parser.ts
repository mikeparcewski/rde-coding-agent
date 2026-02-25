import matter from "gray-matter";
import { SkillFrontmatterSchema } from "@the-agent/core";
import type { SkillFrontmatter } from "@the-agent/core";

export interface ParseResult {
  frontmatter: SkillFrontmatter;
  markdownBody: string;
}

export interface ParseError {
  file: string;
  message: string;
}

/**
 * Parses a skill markdown file's YAML frontmatter and validates it against
 * SkillFrontmatterSchema. Returns either a valid ParseResult or a ParseError.
 */
export function parseFrontmatter(
  content: string,
  filePath: string
): { ok: true; result: ParseResult } | { ok: false; error: ParseError } {
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

  const validation = SkillFrontmatterSchema.safeParse(parsed.data);

  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      error: {
        file: filePath,
        message: `Frontmatter validation failed: ${issues}`,
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
