import type { AgentFrontmatter } from "../interfaces/agent-frontmatter.js";

/**
 * Builds the final system prompt for an agent by merging the inline
 * systemPrompt from frontmatter with the markdown body.
 *
 * Merge rules:
 *   - If frontmatter.systemPrompt and markdownBody both exist:
 *       systemPrompt + "\n\n" + markdownBody
 *   - If only markdownBody exists:
 *       markdownBody used as the full system prompt
 *   - If only frontmatter.systemPrompt exists:
 *       frontmatter.systemPrompt used as the full system prompt
 *   - If neither exists:
 *       empty string (agent has no system prompt — valid but unusual)
 */
export function buildSystemPrompt(
  frontmatter: AgentFrontmatter,
  markdownBody: string
): string {
  const inlinePrompt = frontmatter.systemPrompt?.trim() ?? "";
  const bodyPrompt = markdownBody.trim();

  if (inlinePrompt && bodyPrompt) {
    return `${inlinePrompt}\n\n${bodyPrompt}`;
  }

  if (inlinePrompt) {
    return inlinePrompt;
  }

  return bodyPrompt;
}
