// Public API
export { defineFramework } from "./define-framework.js";
export type {
  FrameworkConfig,
  ProviderConfig,
  MemoryConfig,
  CacheConfig,
  TelemetryConfig,
} from "./define-framework.js";

export { createCLI } from "./create-cli.js";
export type { CLIInstance } from "./create-cli.js";

// Team config
export { TeamConfigSchema, loadTeamConfig } from "./config/team-config.js";
export type { TeamConfig } from "./config/team-config.js";

// Compat aliases
export {
  DEFAULT_ALIASES,
  resolveAlias,
  emitDeprecationNotice,
  resetDeprecationNotice,
} from "./compat/aliases.js";

// Validate command
export { runValidate, printValidationReport } from "./commands/validate.js";
export type { ValidateOptions, ValidationReport, ValidationIssue } from "./commands/validate.js";

// Framework loader
export { FrameworkLoader, startREPL } from "./loader/framework-loader.js";
export type { LoadedFramework } from "./loader/framework-loader.js";
