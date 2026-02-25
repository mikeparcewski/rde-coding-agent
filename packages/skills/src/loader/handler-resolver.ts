import { access } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";

/**
 * Resolves the co-located TypeScript/JavaScript handler for a skill markdown file.
 *
 * Convention:
 *   skills/commit/index.md  ->  skills/commit/handler.ts  (or handler.js)
 *   skills/summarize.md     ->  skills/summarize.ts       (or summarize.js)
 *
 * Returns the resolved path if found, or undefined if no handler exists.
 */
export async function resolveHandler(
  skillFilePath: string
): Promise<string | undefined> {
  const dir = dirname(skillFilePath);
  const base = basename(skillFilePath, extname(skillFilePath));

  // Case 1: index.md in a subdirectory — look for handler.ts/handler.js
  if (base === "index") {
    const candidates = [
      join(dir, "handler.ts"),
      join(dir, "handler.js"),
      join(dir, "handler.mjs"),
    ];
    return findFirstExisting(candidates);
  }

  // Case 2: named file like summarize.md — look for summarize.ts/summarize.js
  const candidates = [
    join(dir, `${base}.ts`),
    join(dir, `${base}.js`),
    join(dir, `${base}.mjs`),
  ];
  return findFirstExisting(candidates);
}

async function findFirstExisting(
  paths: string[]
): Promise<string | undefined> {
  for (const p of paths) {
    try {
      await access(p);
      return p;
    } catch {
      // File doesn't exist — continue
    }
  }
  return undefined;
}
