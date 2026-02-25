import type { SkillConfig, SkillMode } from "@the-agent/core";

/**
 * SkillRegistry holds all loaded and compiled skills.
 * It is populated during startup by the SkillLoader and then injected into
 * the runtime. The registry is read-only after the loading phase.
 */
export class SkillRegistry {
  private readonly skills: Map<string, SkillConfig> = new Map();
  private readonly mode: SkillMode;

  constructor(mode: SkillMode = "permissive") {
    this.mode = mode;
  }

  /**
   * Register a skill. The skill name is taken from frontmatter.name (e.g., "/summarize").
   *
   * Conflict handling:
   *   - strict mode: throws on duplicate name
   *   - permissive mode: logs warning, last-writer wins
   */
  register(skill: SkillConfig): void {
    const name = skill.frontmatter.name;

    if (this.skills.has(name)) {
      if (this.mode === "strict") {
        throw new Error(
          `Duplicate skill name "${name}": already registered from ${
            this.skills.get(name)?.sourceFile ?? "unknown"
          }. New file: ${skill.sourceFile}`
        );
      } else {
        console.warn(
          `[skills] Duplicate skill "${name}" — overwriting ${
            this.skills.get(name)?.sourceFile ?? "unknown"
          } with ${skill.sourceFile}`
        );
      }
    }

    this.skills.set(name, skill);
  }

  /**
   * Get a skill by its slash-command name (e.g., "/summarize").
   */
  get(name: string): SkillConfig | undefined {
    return this.skills.get(name);
  }

  /**
   * List all registered skills, sorted by name.
   */
  list(): SkillConfig[] {
    return Array.from(this.skills.values()).sort((a, b) =>
      a.frontmatter.name.localeCompare(b.frontmatter.name)
    );
  }

  /**
   * Returns the total count of registered skills.
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Returns true if a skill with the given name is registered.
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }
}
