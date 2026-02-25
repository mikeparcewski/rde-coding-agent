// Loader pipeline
export { AgentLoader, loadAgents, defineAgent } from "./loader/agent-loader.js";
export type { AgentLoaderOptions } from "./loader/agent-loader.js";

// Registry
export { AgentRegistry } from "./registry/agent-registry.js";

// Frontmatter interface
export { AgentFrontmatterSchema } from "./interfaces/agent-frontmatter.js";
export type { AgentFrontmatter } from "./interfaces/agent-frontmatter.js";

// Utilities (useful for testing and custom integrations)
export { parseAgentFrontmatter } from "./loader/frontmatter-parser.js";
export type { AgentParseResult, AgentParseError } from "./loader/frontmatter-parser.js";

export { buildSystemPrompt } from "./loader/system-prompt-builder.js";
export { resolveHooks, loadHooks } from "./loader/hooks-resolver.js";
