/**
 * Shared types for the wicked-agent pi-mono extension.
 *
 * We define the pi-mono extension API surface as interfaces here
 * so the package compiles independently. At runtime, pi-mono
 * provides the real implementations.
 */

// ── Domain names ──

export const DOMAIN_NAMES = [
  "engineering",
  "qe",
  "platform",
  "product",
  "data",
  "search",
  "delivery",
  "agentic",
  "memory",
  "brainstorm",
  "project",
  "kanban",
  "scenarios",
  "patch",
] as const;

export type DomainName = (typeof DOMAIN_NAMES)[number];

// ── Configuration ──

export interface WickedConfig {
  /** Which capability domains to enable. Defaults to "all". */
  capabilities?: "all" | DomainName[];
  /** Base path for persistent stores. Defaults to ~/.pi/agent/wicked */
  storePath?: string;
  /** Enable security gate hooks (platform domain). Defaults to true. */
  guardrails?: boolean;
}

// ── pi-mono Extension API (minimal surface we depend on) ──

export interface PiExtensionAPI {
  registerTool(tool: PiTool): void;
  registerCommand(name: string, handler: PiCommandHandler): void;
  on(event: string, handler: PiEventHandler): void;
  /** Optional: pi-mono may provide the session's active model. */
  getModel?(): Promise<PiModel>;
  /** Optional: pi-mono may provide AI access for sub-calls. */
  ai?: PiAI;
}

export interface PiTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown; // TypeBox TSchema at runtime
  execute(
    id: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate?: (update: PiToolUpdate) => void,
  ): Promise<PiToolResult>;
}

export type PiCommandHandler = (
  args: string,
  ctx: PiCommandContext,
) => Promise<void>;

export interface PiCommandContext {
  ui: PiUI;
  session: PiSession;
  getModel(): Promise<PiModel>;
}

export interface PiUI {
  confirm(title: string, message: string): Promise<boolean>;
  showMessage(level: "info" | "warn" | "error", message: string): void;
}

export interface PiSession {
  id: string;
  cwd: string;
}

export interface PiModel {
  id: string;
  provider: string;
}

export interface PiToolUpdate {
  type: "text";
  text: string;
}

export interface PiToolResult {
  type: "text";
  content: Array<{ type: "text"; text: string }>;
}

export type PiEventHandler = (
  event: Record<string, unknown>,
  ctx: PiCommandContext,
) => Promise<void | { block?: boolean; reason?: string }>;

// ── pi-ai streamSimple interface (for brainstorm sub-calls) ──

export interface PiAI {
  streamSimple(options: {
    model: PiModel;
    systemPrompt: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string>;
}

// ── Domain registrar signature ──

export type DomainRegistrar = (
  pi: PiExtensionAPI,
  config: ResolvedConfig,
) => void;

export interface ResolvedConfig {
  storePath: string;
  guardrails: boolean;
  capabilities: Set<DomainName>;
  ai?: PiAI;
  getModel?: () => Promise<PiModel>;
  /** Cross-domain store registry: domains register stores by name at init. */
  storeRegistry: Map<string, unknown>;
}
