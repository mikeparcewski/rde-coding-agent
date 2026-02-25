import type { AgentConfig } from "@the-agent/core";

/**
 * AgentRegistry holds all loaded agents.
 * Agent IDs must be unique — duplicate registration always throws,
 * regardless of mode (agent identity is non-negotiable).
 */
export class AgentRegistry {
  private readonly agents: Map<string, AgentConfig> = new Map();

  /**
   * Register an agent. Throws if an agent with the same id is already registered.
   */
  register(agent: AgentConfig): void {
    if (this.agents.has(agent.id)) {
      throw new Error(
        `Duplicate agent id "${agent.id}": already registered. ` +
          `Agent IDs must be globally unique.`
      );
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * Get an agent by its id.
   */
  get(id: string): AgentConfig | undefined {
    return this.agents.get(id);
  }

  /**
   * List all registered agents, sorted by id.
   */
  list(): AgentConfig[] {
    return Array.from(this.agents.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  /**
   * Returns the total count of registered agents.
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * Returns true if an agent with the given id is registered.
   */
  has(id: string): boolean {
    return this.agents.has(id);
  }
}
