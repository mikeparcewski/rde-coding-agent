import { defineFramework } from "@the-agent/cli";

export default defineFramework({
  llm: {
    provider: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultModel: "claude-opus-4-6",
  },
  skillsDir: "./skills",
  agentsDir: "./agents",
  skillMode: "permissive",
  defaultAgent: "default",
  memory: {
    enabled: true,
    backend: "sqlite",
  },
});
