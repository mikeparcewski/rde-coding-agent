// Loader pipeline
export { SkillLoader, loadSkills } from "./loader/skill-loader.js";
export type { SkillLoaderOptions } from "./loader/skill-loader.js";

// Registry
export { SkillRegistry } from "./registry/skill-registry.js";

// Handler interface
export { defineSkill } from "./interfaces/handler.js";
export type { SkillHandler } from "./interfaces/handler.js";

// Utilities (useful for testing and custom integrations)
export { parseFrontmatter } from "./loader/frontmatter-parser.js";
export type { ParseResult, ParseError } from "./loader/frontmatter-parser.js";

export { resolveHandler } from "./loader/handler-resolver.js";
export { interpolate, validateParams } from "./loader/template-interpolator.js";
