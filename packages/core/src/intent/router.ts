import type { CapabilityTag, IntentSignal, RoutingResult } from "../interfaces/intent.js";
import type { LLMAdapter } from "../interfaces/llm-adapter.js";
import type { RuntimeSnapshot } from "../runtime/runtime-state.js";
import { DEFAULT_CAPABILITY_MAP } from "./capability-map.js";

export interface IntentRouter {
  /**
   * Route user input to a capability tag and agent.
   * Tier 1 (fast): keyword trie + regex patterns, < 50ms
   * Tier 2 (llm): LLM classifier, invoked only when Tier 1 confidence < threshold
   */
  route(input: string, snapshot: RuntimeSnapshot): Promise<RoutingResult>;

  /**
   * Register custom signals from .agent/signals/ directory.
   * Called at startup after built-in signals are loaded.
   */
  registerSignals(signals: IntentSignal[]): void;

  /**
   * Returns the full routing table for validation/debugging.
   */
  getRoutingTable(): Map<CapabilityTag, string>;  // tag -> agentId
}

export const CONFIDENCE_THRESHOLD = 0.75;

// Built-in signal definitions for Tier 1 fast routing
const BUILTIN_SIGNALS: IntentSignal[] = [
  {
    pattern: "review|code.review|look.at.*code|check.*code",
    capability: "code-review",
    confidence: 0.85,
    keywords: ["review", "code review", "look at my code", "check my code"],
  },
  {
    pattern: "debug|fix.*bug|why.*broken|error.*trace|stack.?trace",
    capability: "debug",
    confidence: 0.85,
    keywords: ["debug", "fix bug", "broken", "error", "traceback"],
  },
  {
    pattern: "refactor|clean.?up|restructure|reorganize.*code",
    capability: "refactor",
    confidence: 0.80,
    keywords: ["refactor", "clean up", "restructure", "reorganize"],
  },
  {
    pattern: "architect|design.*system|system.*design|high.*level.*design",
    capability: "architecture-analysis",
    confidence: 0.82,
    keywords: ["architecture", "system design", "high level design"],
  },
  {
    pattern: "implement|build|create|write.*code|add.*feature",
    capability: "implementation",
    confidence: 0.75,
    keywords: ["implement", "build", "create feature", "write code"],
  },
  {
    pattern: "test.*strateg|testing.*plan|qa.*plan|test.*approach",
    capability: "test-strategy",
    confidence: 0.85,
    keywords: ["test strategy", "testing plan", "qa plan", "test approach"],
  },
  {
    pattern: "test.*scenario|scenario.*generate|acceptance.*test|test.*case",
    capability: "test-scenarios",
    confidence: 0.85,
    keywords: ["test scenarios", "acceptance tests", "test cases"],
  },
  {
    pattern: "run.*test|execute.*test|test.*run",
    capability: "test-execution",
    confidence: 0.85,
    keywords: ["run tests", "execute tests", "run test suite"],
  },
  {
    pattern: "orchestrat|coordinate.*agent|multi.*agent|crew",
    capability: "orchestrate",
    confidence: 0.80,
    keywords: ["orchestrate", "coordinate agents", "multi-agent", "crew"],
  },
  {
    pattern: "phase.*rout|next.*phase|which.*phase|advance.*phase",
    capability: "phase-routing",
    confidence: 0.80,
    keywords: ["phase routing", "next phase", "advance phase"],
  },
  {
    pattern: "progress|status.*report|delivery.*status|how.*far",
    capability: "progress-report",
    confidence: 0.78,
    keywords: ["progress", "status report", "delivery status"],
  },
  {
    pattern: "remember|store.*memory|save.*context|memorize",
    capability: "memory-store",
    confidence: 0.85,
    keywords: ["remember", "store memory", "save context", "memorize"],
  },
  {
    pattern: "recall|what.*remember|retrieve.*memory|look.*up.*memory",
    capability: "memory-recall",
    confidence: 0.85,
    keywords: ["recall", "what do you remember", "retrieve memory"],
  },
  {
    pattern: "security|vulnerability|pentest|audit.*security",
    capability: "security-scan",
    confidence: 0.82,
    keywords: ["security", "vulnerability", "pentest", "security audit"],
  },
  {
    pattern: "compliance|regulation|gdpr|sox|hipaa|pci",
    capability: "compliance-check",
    confidence: 0.85,
    keywords: ["compliance", "regulation", "gdpr", "sox", "hipaa"],
  },
  {
    pattern: "cicd|pipeline|ci.*cd|github.*action|jenkins|deploy",
    capability: "cicd-pipeline",
    confidence: 0.82,
    keywords: ["cicd", "pipeline", "github actions", "jenkins", "deployment"],
  },
  {
    pattern: "require|specification|user.*stor|elicit|gather.*requirement",
    capability: "requirements",
    confidence: 0.80,
    keywords: ["requirements", "specification", "user story", "elicit"],
  },
  {
    pattern: "brainstorm|ideate|ideas|jam.*session|creative",
    capability: "brainstorm",
    confidence: 0.80,
    keywords: ["brainstorm", "ideate", "ideas", "jam session"],
  },
  {
    pattern: "ux|user.*experience|design.*review|ui.*review|usability",
    capability: "ux-review",
    confidence: 0.80,
    keywords: ["ux", "user experience", "ui review", "usability"],
  },
  {
    pattern: "acceptance.*criteria|done.*condition|definition.*of.*done",
    capability: "acceptance-criteria",
    confidence: 0.85,
    keywords: ["acceptance criteria", "done condition", "definition of done"],
  },
  {
    pattern: "data.*analysis|analyze.*data|insights|dashboard|metrics",
    capability: "data-analysis",
    confidence: 0.80,
    keywords: ["data analysis", "analyze data", "insights", "metrics"],
  },
  {
    pattern: "data.*pipeline|etl|data.*engineering|data.*flow",
    capability: "pipeline-design",
    confidence: 0.82,
    keywords: ["data pipeline", "etl", "data engineering"],
  },
  {
    pattern: "machine.*learning|ml|model.*train|neural|ai.*model",
    capability: "ml-guidance",
    confidence: 0.82,
    keywords: ["machine learning", "ml model", "training", "neural network"],
  },
  {
    pattern: "patch|hotfix|quick.*fix|apply.*fix",
    capability: "code-patch",
    confidence: 0.78,
    keywords: ["patch", "hotfix", "quick fix"],
  },
  {
    pattern: "propagate|cross.*language|port.*code|translate.*code",
    capability: "cross-language-propagation",
    confidence: 0.80,
    keywords: ["propagate", "cross language", "port code", "translate code"],
  },
];

interface TierOneMatch {
  capability: CapabilityTag;
  confidence: number;
}

/**
 * TwoTierIntentRouter implements the IntentRouter interface.
 *
 * Tier 1 (fast path):
 *   - Matches user input against built-in and custom IntentSignals
 *   - Uses regex patterns and exact keyword matching
 *   - Returns immediately if best match confidence >= CONFIDENCE_THRESHOLD (0.75)
 *
 * Tier 2 (LLM classifier):
 *   - Invoked only when Tier 1 confidence < CONFIDENCE_THRESHOLD
 *   - Sends a constrained classification prompt to the LLM
 *   - Result is cached (LRU, 5 min TTL) to avoid repeated LLM calls for identical inputs
 *   - Falls back to "general" if classification fails
 */
export class TwoTierIntentRouter implements IntentRouter {
  private signals: IntentSignal[] = [...BUILTIN_SIGNALS];
  private routingTable: Map<CapabilityTag, string>;
  private llmCache: Map<string, { result: RoutingResult; expiresAt: number }> = new Map();
  private readonly cacheTtlMs = 5 * 60 * 1_000; // 5 minutes

  constructor(
    private readonly adapter?: LLMAdapter,
    private readonly classifierModel?: string,
    capabilityOverrides?: Partial<Record<CapabilityTag, string>>
  ) {
    this.routingTable = new Map(
      Object.entries({ ...DEFAULT_CAPABILITY_MAP, ...capabilityOverrides }) as [CapabilityTag, string][]
    );
  }

  async route(input: string, _snapshot: RuntimeSnapshot): Promise<RoutingResult> {
    // Tier 1: fast keyword/regex match
    const tierOneMatch = this.runTierOne(input);

    if (tierOneMatch && tierOneMatch.confidence >= CONFIDENCE_THRESHOLD) {
      const agentId = this.routingTable.get(tierOneMatch.capability) ?? "default";
      return {
        capability: tierOneMatch.capability,
        confidence: tierOneMatch.confidence,
        tier: "fast",
        agentId,
        narration: `Treating this as ${tierOneMatch.capability} using ${agentId}. Starting.`,
      };
    }

    // Tier 2: LLM classifier
    const cacheKey = input.toLowerCase().trim();
    const cached = this.llmCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    const llmResult = await this.runTierTwo(input, tierOneMatch);
    this.llmCache.set(cacheKey, {
      result: llmResult,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    // Evict expired entries lazily
    this.evictExpiredCache();

    return llmResult;
  }

  registerSignals(signals: IntentSignal[]): void {
    // Custom signals are prepended so they take precedence over built-ins
    this.signals = [...signals, ...this.signals];
  }

  getRoutingTable(): Map<CapabilityTag, string> {
    return new Map(this.routingTable);
  }

  private runTierOne(input: string): TierOneMatch | null {
    const normalised = input.toLowerCase();
    let bestMatch: TierOneMatch | null = null;

    for (const signal of this.signals) {
      let matched = false;
      let confidence = signal.confidence;

      // Exact keyword match — boost confidence slightly
      for (const keyword of signal.keywords) {
        if (normalised.includes(keyword.toLowerCase())) {
          matched = true;
          confidence = Math.min(1, signal.confidence + 0.05);
          break;
        }
      }

      // Regex pattern match
      if (!matched) {
        try {
          const regex = new RegExp(signal.pattern, "i");
          if (regex.test(normalised)) {
            matched = true;
          }
        } catch {
          // Malformed regex — skip this signal gracefully
        }
      }

      if (matched) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { capability: signal.capability, confidence };
        }
      }
    }

    return bestMatch;
  }

  private async runTierTwo(
    input: string,
    tierOneHint: TierOneMatch | null
  ): Promise<RoutingResult> {
    if (!this.adapter) {
      // No adapter available — fall back to tier one hint or "general"
      const capability = tierOneHint?.capability ?? "general";
      const agentId = this.routingTable.get(capability) ?? "default";
      return {
        capability,
        confidence: tierOneHint?.confidence ?? 0.5,
        tier: "llm",
        agentId,
        narration: `Treating this as ${capability} using ${agentId}. Starting.`,
      };
    }

    const capabilityList = [...this.routingTable.keys()].join(", ");
    const classificationPrompt = `Classify the following user input into EXACTLY ONE capability tag from this list: ${capabilityList}.

User input: "${input}"

Respond with valid JSON in this exact format:
{"capability": "<tag>", "confidence": <0.0-1.0>}

Rules:
- capability must be one of the listed tags
- confidence must be a number between 0 and 1
- If unclear, use "general" with confidence 0.5`;

    try {
      const signal = await this.adapter.complete(
        [
          {
            id: crypto.randomUUID(),
            role: "user",
            content: classificationPrompt,
            timestamp: Date.now(),
          },
        ],
        {
          model: this.classifierModel ?? "default",
          maxTokens: 100,
          temperature: 0,
          stream: false,
        }
      );

      if (signal.type === "text") {
        const parsed = this.parseClassificationResponse(signal.content);
        if (parsed) {
          const agentId = this.routingTable.get(parsed.capability) ?? "default";
          return {
            capability: parsed.capability,
            confidence: parsed.confidence,
            tier: "llm",
            agentId,
            narration: `Treating this as ${parsed.capability} using ${agentId}. Starting.`,
          };
        }
      }
    } catch {
      // LLM classification failed — fall back gracefully
    }

    // Fallback: use tier one hint or general
    const capability = tierOneHint?.capability ?? "general";
    const agentId = this.routingTable.get(capability) ?? "default";
    return {
      capability,
      confidence: tierOneHint?.confidence ?? 0.5,
      tier: "llm",
      agentId,
      narration: `Treating this as ${capability} using ${agentId}. Starting.`,
    };
  }

  private parseClassificationResponse(
    text: string
  ): { capability: CapabilityTag; confidence: number } | null {
    try {
      // Extract JSON from the response — model may include surrounding text
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("capability" in parsed) ||
        !("confidence" in parsed)
      ) {
        return null;
      }

      const { capability, confidence } = parsed as Record<string, unknown>;
      if (typeof capability !== "string" || typeof confidence !== "number") {
        return null;
      }

      // Validate it's a known capability tag
      if (!this.routingTable.has(capability as CapabilityTag)) {
        return null;
      }

      return {
        capability: capability as CapabilityTag,
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    } catch {
      return null;
    }
  }

  private evictExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.llmCache) {
      if (now >= entry.expiresAt) {
        this.llmCache.delete(key);
      }
    }
  }
}
