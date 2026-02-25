import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { SkillConfig, SkillMode, Tool } from "@the-agent/core";
import type { SkillHandler } from "../interfaces/handler.js";
import { parseFrontmatter } from "./frontmatter-parser.js";
import { resolveHandler } from "./handler-resolver.js";
import { interpolate, validateParams } from "./template-interpolator.js";
import { SkillRegistry } from "../registry/skill-registry.js";

export interface SkillLoaderOptions {
  skillsDir: string;
  mode: SkillMode;
}

/**
 * SkillLoader executes the 5-stage skill loading pipeline:
 *
 * 1. Discover — glob skillsDir for **\/*.md
 * 2. Parse    — gray-matter extracts YAML frontmatter + markdown body
 * 3. Resolve  — check for co-located .ts/.js handler
 * 4. Compile  — dynamic import handler or synthesize prompt-based tool
 * 5. Register — add to SkillRegistry with conflict handling
 */
export class SkillLoader {
  private readonly options: SkillLoaderOptions;

  constructor(options: SkillLoaderOptions) {
    this.options = options;
  }

  /**
   * Execute the full pipeline. Returns a populated SkillRegistry.
   * All files are processed in parallel via Promise.all().
   */
  async load(): Promise<SkillRegistry> {
    const registry = new SkillRegistry(this.options.mode);

    // Stage 1: Discover
    const files = await this.discover();

    // Stages 2-5 run in parallel per file
    const results = await Promise.allSettled(
      files.map((file) => this.processFile(file, registry))
    );

    // Report failures
    for (const result of results) {
      if (result.status === "rejected") {
        const error = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        if (this.options.mode === "strict") {
          throw new Error(`Skill loading failed: ${error}`);
        } else {
          console.warn(`[skills] Skipped skill due to error: ${error}`);
        }
      }
    }

    return registry;
  }

  // Stage 1: Discover
  private async discover(): Promise<string[]> {
    try {
      const entries = await readdir(this.options.skillsDir, {
        recursive: true,
        withFileTypes: true,
      });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => resolve(join(e.parentPath ?? e.path, e.name)));
    } catch {
      // Directory may not exist — return empty list
      return [];
    }
  }

  // Stages 2-5 for a single file
  private async processFile(
    filePath: string,
    registry: SkillRegistry
  ): Promise<void> {
    // Stage 2: Parse
    const content = await readFile(filePath, "utf-8");
    const parseResult = parseFrontmatter(content, filePath);

    if (!parseResult.ok) {
      if (this.options.mode === "strict") {
        throw new Error(parseResult.error.message);
      } else {
        console.warn(`[skills] ${parseResult.error.message}`);
        return;
      }
    }

    const { frontmatter, markdownBody } = parseResult.result;

    // Stage 3: Resolve handler
    const handlerPath = await resolveHandler(filePath);

    if (frontmatter.requiresHandler && !handlerPath) {
      const msg = `Skill "${frontmatter.name}" requires a handler but none was found alongside ${filePath}`;
      if (this.options.mode === "strict") {
        throw new Error(msg);
      } else {
        console.warn(`[skills] ${msg}`);
        return;
      }
    }

    // Stage 4: Compile
    let tool: Tool | undefined;

    if (handlerPath) {
      tool = await this.compileHandler(handlerPath, frontmatter.name);
    } else {
      tool = this.synthesizeTool(frontmatter, markdownBody);
    }

    const skill: SkillConfig = {
      frontmatter,
      markdownBody,
      ...(handlerPath ? { handlerPath } : {}),
      ...(tool ? { tool } : {}),
      sourceFile: filePath,
    };

    // Stage 5: Register
    registry.register(skill);
  }

  // Compile a handler module via dynamic import
  private async compileHandler(
    handlerPath: string,
    skillName: string
  ): Promise<Tool> {
    try {
      // Node.js caches dynamic imports — subsequent calls hit module cache
      const mod = await import(handlerPath) as {
        default?: SkillHandler;
        tool?: Tool;
      };

      const handler: SkillHandler | undefined = mod.default ?? (mod as unknown as SkillHandler);

      if (!handler?.tool) {
        throw new Error(
          `Handler at ${handlerPath} does not export a { tool } shape`
        );
      }

      return handler.tool;
    } catch (err) {
      throw new Error(
        `Failed to load handler for skill "${skillName}" at ${handlerPath}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Synthesize a Tool from a markdown-only skill (prompt interpolation)
  private synthesizeTool(
    frontmatter: SkillConfig["frontmatter"],
    markdownBody: string
  ): Tool {
    const skillName = frontmatter.name.replace(/^\//, ""); // strip leading /
    const parameters = frontmatter.parameters ?? {};

    const requiredParams = new Set(
      Object.entries(parameters)
        .filter(([, p]) => p.required)
        .map(([k]) => k)
    );

    return {
      name: skillName,
      description: frontmatter.description,
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([key, param]) => [
          key,
          {
            type: param.type,
            description: param.description,
            required: param.required,
          },
        ])
      ),
      source: "skill",
      sourceId: frontmatter.name,
      handler: async (args: Record<string, unknown>): Promise<unknown> => {
        const missing = validateParams(markdownBody, args, requiredParams);
        if (missing.length > 0) {
          return {
            error: `Missing required parameters: ${missing.join(", ")}`,
          };
        }

        const prompt = interpolate(markdownBody, args);

        // Return the interpolated prompt as a string.
        // The RuntimeLoop is responsible for sending this back to the LLM.
        return { prompt };
      },
    };
  }
}

/**
 * Top-level function — the primary export consumed by the CLI framework loader.
 */
export async function loadSkills(options: SkillLoaderOptions): Promise<SkillRegistry> {
  const loader = new SkillLoader(options);
  return loader.load();
}
