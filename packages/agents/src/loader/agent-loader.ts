import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { AgentConfig } from "@the-agent/core";
import { parseAgentFrontmatter } from "./frontmatter-parser.js";
import { buildSystemPrompt } from "./system-prompt-builder.js";
import { resolveHooks, loadHooks } from "./hooks-resolver.js";
import { AgentRegistry } from "../registry/agent-registry.js";

export interface AgentLoaderOptions {
  agentsDir: string;
}

/**
 * AgentLoader executes the 5-stage agent loading pipeline:
 *
 * 1. Discover — glob agentsDir for **\/*.md
 * 2. Parse    — gray-matter extracts YAML frontmatter + markdown body
 * 3. Build    — merge frontmatter.systemPrompt + markdownBody
 * 4. Resolve  — check for co-located .hooks.ts lifecycle file
 * 5. Register — add to AgentRegistry (always throws on duplicate id)
 */
export class AgentLoader {
  private readonly options: AgentLoaderOptions;

  constructor(options: AgentLoaderOptions) {
    this.options = options;
  }

  /**
   * Execute the full pipeline. Returns a populated AgentRegistry.
   * All files are processed in parallel via Promise.all().
   */
  async load(): Promise<AgentRegistry> {
    const registry = new AgentRegistry();

    // Stage 1: Discover
    const files = await this.discover();

    // Stages 2-5 run in parallel per file
    const results = await Promise.allSettled(
      files.map((file) => this.processFile(file))
    );

    // Collect all successfully loaded agents, then register in sorted order
    // to ensure deterministic behavior when multiple agents are loaded
    const agents: AgentConfig[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        agents.push(result.value);
      } else {
        const error = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        console.warn(`[agents] Failed to load agent: ${error}`);
      }
    }

    // Sort by id for deterministic registration order
    agents.sort((a, b) => a.id.localeCompare(b.id));

    for (const agent of agents) {
      registry.register(agent);
    }

    return registry;
  }

  // Stage 1: Discover
  private async discover(): Promise<string[]> {
    try {
      const entries = await readdir(this.options.agentsDir, {
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
  private async processFile(filePath: string): Promise<AgentConfig> {
    // Stage 2: Parse
    const content = await readFile(filePath, "utf-8");
    const parseResult = parseAgentFrontmatter(content, filePath);

    if (!parseResult.ok) {
      throw new Error(parseResult.error.message);
    }

    const { frontmatter, markdownBody } = parseResult.result;

    // Stage 3: Build system prompt
    const systemPrompt = buildSystemPrompt(frontmatter, markdownBody);

    // Stage 4: Resolve hooks
    const hooksPath = await resolveHooks(filePath);
    let hooks: AgentConfig["hooks"];

    if (hooksPath) {
      hooks = await loadHooks(hooksPath, frontmatter.id);
    }

    // Compose AgentConfig
    const agentConfig: AgentConfig = {
      id: frontmatter.id,
      name: frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      personaFile: filePath,
      systemPrompt: systemPrompt || undefined,
      allowedTools: frontmatter.allowedTools,
      ...(frontmatter.model ? { model: frontmatter.model } : {}),
      ...(frontmatter.temperature !== undefined
        ? { temperature: frontmatter.temperature }
        : {}),
      maxTurns: frontmatter.maxTurns,
      ...(hooks ? { hooks } : {}),
    };

    return agentConfig;
  }
}

/**
 * defineAgent() is a typed identity function for authoring agent configs programmatically.
 */
export function defineAgent(config: AgentConfig): AgentConfig {
  return config;
}

/**
 * Top-level function — the primary export consumed by the CLI framework loader.
 */
export async function loadAgents(options: AgentLoaderOptions): Promise<AgentRegistry> {
  const loader = new AgentLoader(options);
  return loader.load();
}
