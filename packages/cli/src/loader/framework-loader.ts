import { resolve } from "node:path";
import type { LLMAdapter } from "@the-agent/core";
import { loadSkills, type SkillRegistry } from "@the-agent/skills";
import { loadAgents, type AgentRegistry } from "@the-agent/agents";
import { createAdapter } from "@the-agent/providers";
import type { FrameworkConfig } from "../define-framework.js";
import { loadTeamConfig, type TeamConfig } from "../config/team-config.js";
import { REPL } from "../repl/repl.js";

export interface LoadedFramework {
  adapter: LLMAdapter;
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
  teamConfig: TeamConfig | undefined;
  config: FrameworkConfig;
}

/**
 * FrameworkLoader orchestrates all startup steps:
 *
 * 1. Load team config (.agent/config.yaml) — optional, non-fatal
 * 2. Create LLM adapter from provider config
 * 3. Load skills and agents in parallel
 * 4. Build the loaded framework object
 *
 * The loader resolves all paths relative to `projectRoot`.
 */
export class FrameworkLoader {
  private readonly config: FrameworkConfig;
  private readonly projectRoot: string;

  constructor(config: FrameworkConfig, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  async load(): Promise<LoadedFramework> {
    // Step 1: Load team config (optional)
    let teamConfig: TeamConfig | undefined;
    try {
      teamConfig = await loadTeamConfig(this.projectRoot);
    } catch (err) {
      console.warn(
        `[the-agent] Failed to load .agent/config.yaml: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Step 2: Create adapter
    const adapter = this.config.customAdapter ?? this.createLLMAdapter();

    // Step 3: Load skills and agents in parallel
    const skillsDir = resolve(this.projectRoot, this.config.skillsDir);
    const agentsDir = resolve(this.projectRoot, this.config.agentsDir);

    const [skillRegistry, agentRegistry] = await Promise.all([
      loadSkills({ skillsDir, mode: this.config.skillMode }),
      loadAgents({ agentsDir }),
    ]);

    console.info(
      `[the-agent] Loaded ${skillRegistry.size} skill(s), ${agentRegistry.size} agent(s).`
    );

    return {
      adapter,
      skillRegistry,
      agentRegistry,
      teamConfig,
      config: this.config,
    };
  }

  private createLLMAdapter(): LLMAdapter {
    const llm = this.config.llm;
    return createAdapter(llm);
  }
}

/**
 * Creates and starts the CLI REPL from a loaded framework.
 */
export async function startREPL(framework: LoadedFramework): Promise<void> {
  const repl = new REPL({
    adapter: framework.adapter,
    agentRegistry: framework.agentRegistry,
    skillRegistry: framework.skillRegistry,
    ...(framework.config.defaultAgent !== undefined
      ? { defaultAgentId: framework.config.defaultAgent }
      : {}),
    compatMode: framework.teamConfig?.compat_mode ?? false,
  });

  await repl.start();
}
