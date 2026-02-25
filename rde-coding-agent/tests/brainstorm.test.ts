/**
 * Tests for the Brainstorm domain.
 *
 * Verifies tool registration, parallel persona calls, failure handling,
 * synthesis behaviour, model resolution (AC-2), and persona timeout isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerBrainstormTools } from "../src/domains/brainstorm/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: vi.fn(),
  };
  return { pi, tools };
}

function makeMockAi() {
  return {
    streamSimple: vi.fn().mockResolvedValue("mock persona response"),
  };
}

function makeMockGetModel() {
  return vi.fn().mockResolvedValue({ id: "claude-3", provider: "anthropic" });
}

function makeSignal() {
  return new AbortController().signal;
}

// ── Tool registration ──────────────────────────────────────────────────────────

describe("registerBrainstormTools — registration", () => {
  it("registers brainstorm tool", () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, makeMockAi());
    expect(tools.has("brainstorm")).toBe(true);
  });

  it("registers quick_jam tool", () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, makeMockAi());
    expect(tools.has("quick_jam")).toBe(true);
  });

  it("brainstorm tool has correct schema with topic, personas, context, format", () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, makeMockAi());

    const tool = tools.get("brainstorm")!;
    expect(tool.parameters.properties).toHaveProperty("topic");
    expect(tool.parameters.properties).toHaveProperty("personas");
    expect(tool.parameters.properties).toHaveProperty("context");
    expect(tool.parameters.properties).toHaveProperty("format");
  });

  it("quick_jam tool has correct schema with proposal and context", () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, makeMockAi());

    const tool = tools.get("quick_jam")!;
    expect(tool.parameters.properties).toHaveProperty("proposal");
    expect(tool.parameters.properties).toHaveProperty("context");
  });

  it("tools have name, label, description, and execute function", () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, makeMockAi());

    for (const toolName of ["brainstorm", "quick_jam"]) {
      const tool = tools.get(toolName)!;
      expect(tool.name).toBe(toolName);
      expect(typeof tool.label).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("when ai is undefined, tools are still registered (with error response on execute)", async () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, undefined);
    expect(tools.has("brainstorm")).toBe(true);

    const tool = tools.get("brainstorm")!;
    const result = await tool.execute("id", { topic: "test" }, makeSignal());
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).toBeTruthy();
  });
});

// ── AC-2: Model resolution ──────────────────────────────────────────────────

describe("AC-2: brainstorm model resolution", () => {
  it("uses getModel() to resolve the session's active model", async () => {
    const ai = makeMockAi();
    const getModel = makeMockGetModel();
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, ai, getModel);

    const tool = tools.get("brainstorm")!;
    await tool.execute(
      "call-1",
      { topic: "test", personas: ["architect"] },
      makeSignal(),
    );

    // getModel should have been called to resolve the model
    expect(getModel).toHaveBeenCalledTimes(1);

    // The resolved model should be passed to streamSimple
    const firstCall = ai.streamSimple.mock.calls[0]![0] as { model: any };
    expect(firstCall.model).toEqual({ id: "claude-3", provider: "anthropic" });
  });

  it("throws when getModel is not provided", async () => {
    const ai = makeMockAi();
    const { pi, tools } = makeMockPi();
    // No getModel passed
    registerBrainstormTools(pi as any, ai);

    const tool = tools.get("brainstorm")!;
    await expect(
      tool.execute(
        "call-1",
        { topic: "test", personas: ["architect"] },
        makeSignal(),
      ),
    ).rejects.toThrow("model resolver");
  });

  it("quick_jam also uses getModel() for model resolution", async () => {
    const ai = makeMockAi();
    const getModel = makeMockGetModel();
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, ai, getModel);

    const tool = tools.get("quick_jam")!;
    await tool.execute(
      "call-1",
      { proposal: "test proposal" },
      makeSignal(),
    );

    expect(getModel).toHaveBeenCalled();
  });

  it("passes the resolved model to synthesis call as well", async () => {
    const ai = makeMockAi();
    const getModel = makeMockGetModel();
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, ai, getModel);

    const tool = tools.get("brainstorm")!;
    await tool.execute(
      "call-1",
      { topic: "test", personas: ["architect"] },
      makeSignal(),
    );

    // 1 persona + 1 synthesis = 2 calls, both should use resolved model
    expect(ai.streamSimple).toHaveBeenCalledTimes(2);
    for (const call of ai.streamSimple.mock.calls) {
      const opts = call[0] as { model: any };
      expect(opts.model).toEqual({ id: "claude-3", provider: "anthropic" });
    }
  });
});

// ── Brainstorm execute behaviour ───────────────────────────────────────────────

describe("brainstorm tool — execute", () => {
  let ai: ReturnType<typeof makeMockAi>;
  let getModel: ReturnType<typeof makeMockGetModel>;
  let tools: Map<string, any>;

  beforeEach(() => {
    ai = makeMockAi();
    getModel = makeMockGetModel();
    const mock = makeMockPi();
    registerBrainstormTools(mock.pi as any, ai, getModel);
    tools = mock.tools;
  });

  it("calls streamSimple for each persona plus once for synthesis", async () => {
    const tool = tools.get("brainstorm")!;
    const result = await tool.execute(
      "call-1",
      {
        topic: "should we adopt microservices?",
        personas: ["architect", "skeptic"],
      },
      makeSignal(),
    );

    // 2 personas + 1 synthesis = 3 calls
    expect(ai.streamSimple).toHaveBeenCalledTimes(3);

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.topic).toBe("should we adopt microservices?");
    expect(parsed.synthesis).toBeDefined();
    expect(parsed.successCount).toBe(2);
    expect(parsed.failureCount).toBe(0);
  });

  it("format='summary' does not include personaResponses in result", async () => {
    const tool = tools.get("brainstorm")!;
    const result = await tool.execute(
      "call-1",
      {
        topic: "test topic",
        personas: ["architect"],
        format: "summary",
      },
      makeSignal(),
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.personaResponses).toBeUndefined();
  });

  it("format='full' includes personaResponses in result", async () => {
    const tool = tools.get("brainstorm")!;
    const result = await tool.execute(
      "call-1",
      {
        topic: "test topic",
        personas: ["architect", "skeptic"],
        format: "full",
      },
      makeSignal(),
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(parsed.personaResponses)).toBe(true);
    expect(parsed.personaResponses).toHaveLength(2);
  });

  it("one persona failing still allows synthesis to run with remaining", async () => {
    // First call (persona 0) fails, second (persona 1) succeeds, third is synthesis
    ai.streamSimple
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValue("success response");

    const tool = tools.get("brainstorm")!;
    const result = await tool.execute(
      "call-1",
      {
        topic: "some topic",
        personas: ["architect", "skeptic"],
      },
      makeSignal(),
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.failureCount).toBe(1);
    expect(parsed.successCount).toBe(1);
    expect(parsed.synthesis).toBeDefined();
  });

  it("throws when all persona calls fail", async () => {
    ai.streamSimple.mockRejectedValue(new Error("All failed"));

    const tool = tools.get("brainstorm")!;
    await expect(
      tool.execute(
        "call-1",
        {
          topic: "test",
          personas: ["architect", "skeptic"],
        },
        makeSignal(),
      ),
    ).rejects.toThrow("All persona calls failed");
  });

  it("unknown persona name uses custom persona (name appears in system prompt)", async () => {
    const tool = tools.get("brainstorm")!;
    await tool.execute(
      "call-1",
      {
        topic: "test topic",
        personas: ["my-custom-wizard"],
      },
      makeSignal(),
    );

    // The custom persona's system prompt contains the persona name
    const firstCall = ai.streamSimple.mock.calls[0]![0] as { systemPrompt: string };
    expect(firstCall.systemPrompt).toContain("my-custom-wizard");
  });

  it("uses default personas when personas param is omitted", async () => {
    const tool = tools.get("brainstorm")!;
    await tool.execute(
      "call-1",
      { topic: "test" },
      makeSignal(),
    );

    // Default is 5 personas + 1 synthesis = 6 calls
    expect(ai.streamSimple).toHaveBeenCalledTimes(6);
  });
});

// ── Persona timeout isolation ──────────────────────────────────────────────────

describe("brainstorm tool — persona timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persona that times out is counted as failure, not an unhandled rejection", async () => {
    const ai = {
      streamSimple: vi.fn(),
    };
    const getModel = makeMockGetModel();

    // First persona call never resolves (simulates hang)
    // Second persona call succeeds immediately
    // Synthesis call succeeds
    ai.streamSimple
      .mockReturnValueOnce(new Promise<string>(() => {})) // hangs forever
      .mockResolvedValue("ok response");                   // synthesis + other personas

    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, ai, getModel);

    const tool = tools.get("brainstorm")!;

    // Start the execute — it won't settle until the timeout fires
    const executePromise = tool.execute(
      "call-1",
      { topic: "timeout test", personas: ["architect", "skeptic"] },
      makeSignal(),
    );

    // Advance timers past PERSONA_TIMEOUT_MS (45 seconds)
    await vi.advanceTimersByTimeAsync(46_000);

    const result = await executePromise;
    const parsed = JSON.parse(result.content[0]!.text);

    // Timed-out persona counted as failure
    expect(parsed.failureCount).toBe(1);
    // Remaining persona succeeded
    expect(parsed.successCount).toBe(1);
    // Synthesis still ran
    expect(parsed.synthesis).toBeDefined();
  });
});

// ── quick_jam tool ─────────────────────────────────────────────────────────────

describe("quick_jam tool — execute", () => {
  it("calls streamSimple exactly 3 times (critic, advocate, verdict)", async () => {
    const ai = makeMockAi();
    const getModel = makeMockGetModel();
    ai.streamSimple
      .mockResolvedValueOnce("critique text")
      .mockResolvedValueOnce("advocacy text")
      .mockResolvedValueOnce("verdict text");

    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, ai, getModel);

    const tool = tools.get("quick_jam")!;
    const result = await tool.execute(
      "call-1",
      { proposal: "adopt GraphQL" },
      makeSignal(),
    );

    expect(ai.streamSimple).toHaveBeenCalledTimes(3);

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.critique).toBe("critique text");
    expect(parsed.advocacy).toBe("advocacy text");
    expect(parsed.verdict).toBe("verdict text");
  });

  it("returns error object when ai is undefined", async () => {
    const { pi, tools } = makeMockPi();
    registerBrainstormTools(pi as any, undefined);

    const tool = tools.get("quick_jam")!;
    const result = await tool.execute(
      "call-1",
      { proposal: "test" },
      makeSignal(),
    );

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.error).toBeTruthy();
  });
});
