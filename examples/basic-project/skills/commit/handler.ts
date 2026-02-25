import { defineSkill } from "@the-agent/skills";
import { execSync } from "node:child_process";

export default defineSkill({
  tool: {
    name: "commit",
    description: "Generate a conventional commit message from staged git diff",
    parameters: {
      dryRun: {
        type: "boolean",
        description: "If true, print the message without committing",
        required: false,
      },
    },
    source: "skill",
    handler: async ({ dryRun }) => {
      const diff = execSync("git diff --cached").toString();
      if (!diff.trim()) {
        return { error: "No staged changes found. Run git add first." };
      }
      return { diff, dryRun: Boolean(dryRun) };
    },
  },
});
