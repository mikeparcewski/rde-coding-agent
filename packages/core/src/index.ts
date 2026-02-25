// ── Interfaces ────────────────────────────────────────────────────────────────

// message
export { RoleSchema, MessageSchema } from "./interfaces/message.js";
export type { Role, Message } from "./interfaces/message.js";

// tool
export {
  ToolParameterSchema,
  ToolSchema,
  ToolCallSchema,
  ToolResultSchema,
} from "./interfaces/tool.js";
export type { ToolParameter, Tool, ToolCall, ToolResult } from "./interfaces/tool.js";

// llm-adapter
export {
  CompletionOptionsSchema,
  CompletionSignalSchema,
} from "./interfaces/llm-adapter.js";
export type {
  CompletionOptions,
  CompletionSignal,
  LLMAdapter,
} from "./interfaces/llm-adapter.js";

// agent-config
export { AgentConfigSchema } from "./interfaces/agent-config.js";
export type { AgentConfig } from "./interfaces/agent-config.js";

// skill-config
export {
  SkillFrontmatterSchema,
  SkillConfigSchema,
  SkillModeSchema,
} from "./interfaces/skill-config.js";
export type {
  SkillFrontmatter,
  SkillConfig,
  SkillMode,
} from "./interfaces/skill-config.js";

// intent
export {
  CapabilityTagSchema,
  IntentSignalSchema,
  RoutingResultSchema,
} from "./interfaces/intent.js";
export type {
  CapabilityTag,
  IntentSignal,
  RoutingResult,
} from "./interfaces/intent.js";

// completion
export {
  CompletionConditionSchema,
  CompletionContractSchema,
  CompletionResultSchema,
  ProgressEventSchema,
} from "./interfaces/completion.js";
export type {
  CompletionCondition,
  CompletionContract,
  CompletionResult,
  ProgressEvent,
} from "./interfaces/completion.js";

// ── Runtime ───────────────────────────────────────────────────────────────────

export { RuntimeState } from "./runtime/runtime-state.js";
export type { RuntimeSnapshot, RuntimePhase } from "./runtime/runtime-state.js";

export { RuntimeLoop } from "./runtime/runtime-loop.js";
export type { RuntimeLoopOptions } from "./runtime/runtime-loop.js";

export { ContextAssembler } from "./runtime/context-assembler.js";
export type { ContextAssemblerOptions } from "./runtime/context-assembler.js";

// ── Dispatch ──────────────────────────────────────────────────────────────────

export { ToolDispatcher } from "./dispatch/tool-dispatcher.js";

// ── Intent ────────────────────────────────────────────────────────────────────

export { TwoTierIntentRouter, CONFIDENCE_THRESHOLD } from "./intent/router.js";
export type { IntentRouter } from "./intent/router.js";

export { DEFAULT_CAPABILITY_MAP } from "./intent/capability-map.js";
