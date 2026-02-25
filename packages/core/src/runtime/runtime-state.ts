import type { Message } from "../interfaces/message.js";
import type { ToolResult } from "../interfaces/tool.js";

// Immutable snapshot passed to hooks and context assembler
export interface RuntimeSnapshot {
  readonly sessionId: string;
  readonly agentId: string;
  readonly turnNumber: number;
  readonly messages: readonly Message[];
  readonly pendingToolCalls: readonly string[];    // ids awaiting results
  readonly completedToolResults: readonly ToolResult[];
  readonly phase: RuntimePhase;
}

export type RuntimePhase =
  | "idle"
  | "assembling_context"
  | "awaiting_completion"
  | "dispatching_tools"
  | "awaiting_tool_results"
  | "evaluating_completion"
  | "summarizing"
  | "error";

// Mutable state — only the RuntimeLoop mutates this
export class RuntimeState {
  private _snapshot: RuntimeSnapshot;

  constructor(sessionId: string, agentId: string) {
    this._snapshot = {
      sessionId,
      agentId,
      turnNumber: 0,
      messages: [],
      pendingToolCalls: [],
      completedToolResults: [],
      phase: "idle",
    };
  }

  get snapshot(): RuntimeSnapshot {
    return Object.freeze({ ...this._snapshot });
  }

  appendMessage(msg: Message): void {
    this._snapshot = {
      ...this._snapshot,
      messages: [...this._snapshot.messages, msg],
    };
  }

  advanceTurn(): void {
    this._snapshot = {
      ...this._snapshot,
      turnNumber: this._snapshot.turnNumber + 1,
      pendingToolCalls: [],
      completedToolResults: [],
    };
  }

  setPhase(phase: RuntimePhase): void {
    this._snapshot = { ...this._snapshot, phase };
  }

  recordToolCall(callId: string): void {
    this._snapshot = {
      ...this._snapshot,
      pendingToolCalls: [...this._snapshot.pendingToolCalls, callId],
    };
  }

  recordToolResult(result: ToolResult): void {
    this._snapshot = {
      ...this._snapshot,
      pendingToolCalls: this._snapshot.pendingToolCalls.filter(
        (id) => id !== result.toolCallId
      ),
      completedToolResults: [...this._snapshot.completedToolResults, result],
    };
  }
}
