import { describe, it, expect } from "bun:test"
import { createBuiltinAgents, AGENT_METADATA } from "./builtin-agents"

const ALL_AGENT_NAMES = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft", "warp"]

describe("createBuiltinAgents", () => {
  it("returns all 8 agents when none disabled", () => {
    const agents = createBuiltinAgents()
    for (const name of ALL_AGENT_NAMES) {
      expect(agents[name]).toBeDefined()
    }
    expect(Object.keys(agents)).toHaveLength(8)
  })

  it("excludes disabled agents", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["spindle", "thread"] })
    expect(agents["spindle"]).toBeUndefined()
    expect(agents["thread"]).toBeUndefined()
    expect(agents["loom"]).toBeDefined()
    expect(Object.keys(agents)).toHaveLength(6)
  })

  it("each agent has a model string", () => {
    const agents = createBuiltinAgents({ systemDefaultModel: "claude-3-5-sonnet" })
    for (const name of ALL_AGENT_NAMES) {
      const agent = agents[name]
      expect(agent).toBeDefined()
      expect(typeof agent.model).toBe("string")
      expect(agent.model!.length).toBeGreaterThan(0)
    }
  })

  it("applies agent model override from agentOverrides", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { loom: { model: "gpt-4o-custom" } },
      availableModels: new Set(["gpt-4o-custom"]),
    })
    expect(agents["loom"]?.model).toBe("gpt-4o-custom")
  })

  it("applies prompt_append from agentOverrides", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { pattern: { prompt_append: "EXTRA INSTRUCTIONS" } },
    })
    expect(agents["pattern"]?.prompt).toContain("EXTRA INSTRUCTIONS")
  })

  it("applies temperature override from agentOverrides", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { loom: { temperature: 0.3 } },
    })
    expect(agents["loom"]?.temperature).toBe(0.3)
  })

  it("applies modelOptions override to builtin subagents", () => {
    const agents = createBuiltinAgents({
      agentOverrides: {
        pattern: {
          modelOptions: {
            reasoningEffort: "high",
            reasoning: { effort: "medium" },
          },
        },
      },
    })
    const pattern = agents["pattern"] as { options?: Record<string, unknown> } | undefined
    expect(pattern?.options).toEqual({
      reasoningEffort: "high",
      reasoning: { effort: "medium" },
    })
  })

  it("resolves override skills and prepends them to the agent prompt", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["test-skill"] } },
      resolveSkills: () => "SKILL_CONTENT",
    })
    expect(agents["pattern"]?.prompt).toMatch(/^SKILL_CONTENT/)
  })

  it("override skills appear before the base prompt content", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["test-skill"] } },
      resolveSkills: () => "SKILL_CONTENT",
    })
    const prompt = agents["pattern"]?.prompt ?? ""
    const skillIndex = prompt.indexOf("SKILL_CONTENT")
    const baseIndex = prompt.indexOf("Pattern — strategic planner for Weave.")
    expect(skillIndex).toBeGreaterThanOrEqual(0)
    expect(baseIndex).toBeGreaterThan(skillIndex)
  })

  it("override skills work alongside prompt_append", () => {
    const agents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["test-skill"], prompt_append: "APPENDED" } },
      resolveSkills: () => "SKILL_CONTENT",
    })
    const prompt = agents["pattern"]?.prompt ?? ""
    expect(prompt.startsWith("SKILL_CONTENT")).toBe(true)
    expect(prompt.endsWith("APPENDED")).toBe(true)
    expect(prompt.indexOf("Pattern — strategic planner for Weave.")).toBeGreaterThan(0)
  })

  it("empty skills array does not affect the prompt", () => {
    const defaultAgents = createBuiltinAgents()
    const overrideAgents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: [] } },
      resolveSkills: () => "SKILL_CONTENT",
    })
    expect(overrideAgents["pattern"]?.prompt).toBe(defaultAgents["pattern"]?.prompt)
  })

  it("resolveSkills returning empty string does not affect the prompt", () => {
    const defaultAgents = createBuiltinAgents()
    const overrideAgents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["disabled-skill"] } },
      resolveSkills: () => "",
    })
    expect(overrideAgents["pattern"]?.prompt).toBe(defaultAgents["pattern"]?.prompt)
  })

  it("disabledSkills set is forwarded to resolveSkills", () => {
    let capturedDisabledSkills: Set<string> | undefined
    createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["test-skill"] } },
      disabledSkills: new Set(["blocked-skill"]),
      resolveSkills: (_names, disabled) => { capturedDisabledSkills = disabled; return "SKILL_CONTENT" },
    })
    expect(capturedDisabledSkills).toBeDefined()
    expect(capturedDisabledSkills?.has("blocked-skill")).toBe(true)
  })

  it("skills are no-op when resolveSkills is not provided", () => {
    const defaultAgents = createBuiltinAgents()
    const overrideAgents = createBuiltinAgents({
      agentOverrides: { pattern: { skills: ["test-skill"] } },
      // resolveSkills intentionally omitted
    })
    expect(overrideAgents["pattern"]?.prompt).toBe(defaultAgents["pattern"]?.prompt)
  })

  it("thread agent has denied write tools", () => {
    const agents = createBuiltinAgents()
    const thread = agents["thread"]
    expect(thread).toBeDefined()
    // thread factory sets tools: { write: false, edit: false }
    const tools = (thread as Record<string, unknown>)["tools"] as Record<string, boolean> | undefined
    if (tools) {
      expect(tools["write"]).toBe(false)
    }
  })

  it("each agent has a description", () => {
    const agents = createBuiltinAgents()
    for (const name of ALL_AGENT_NAMES) {
      const agent = agents[name]
      expect(agent).toBeDefined()
      expect(typeof agent.description).toBe("string")
      expect(agent.description!.length).toBeGreaterThan(0)
    }
  })

  it("each agent has a mode", () => {
    const agents = createBuiltinAgents()
    const expectedModes: Record<string, string> = {
      loom: "primary",
      tapestry: "primary",
      shuttle: "all",
      pattern: "subagent",
      thread: "subagent",
      spindle: "subagent",
      weft: "subagent",
      warp: "subagent",
    }
    for (const name of ALL_AGENT_NAMES) {
      const agent = agents[name]
      expect(agent).toBeDefined()
      expect(agent.mode).toBe(expectedModes[name])
    }
  })
})

describe("AGENT_METADATA", () => {
  it("has entries for all 8 agents", () => {
    for (const name of ALL_AGENT_NAMES) {
      expect(AGENT_METADATA[name as keyof typeof AGENT_METADATA]).toBeDefined()
    }
  })

  it("each metadata has triggers array", () => {
    for (const name of ALL_AGENT_NAMES) {
      const meta = AGENT_METADATA[name as keyof typeof AGENT_METADATA]
      expect(Array.isArray(meta.triggers)).toBe(true)
      expect(meta.triggers.length).toBeGreaterThan(0)
    }
  })

  it("loom has keyTrigger for ultrawork", () => {
    expect(AGENT_METADATA.loom.keyTrigger).toContain("ultrawork")
  })

  it("warp can be disabled like any other agent", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["warp"] })
    expect(agents["warp"]).toBeUndefined()
    expect(Object.keys(agents)).toHaveLength(7)
  })

  it("any agent can be disabled via disabledAgents", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["spindle"] })
    expect(agents["spindle"]).toBeUndefined()
  })

  it("loom prompt strips references to disabled agents", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["spindle", "thread"] })
    const prompt = agents["loom"]?.prompt ?? ""
    expect(prompt).not.toContain("Use spindle")
    expect(prompt).not.toContain("Use thread")
    // Warp references should still be present (not disabled in this test)
    expect(prompt).toContain("MUST use Warp")
  })

  it("tapestry prompt adapts PostExecutionReview when weft disabled", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["weft"] })
    const prompt = agents["tapestry"]?.prompt ?? ""
    const reviewSection = prompt.slice(
      prompt.indexOf("<PostExecutionReview>"),
      prompt.indexOf("</PostExecutionReview>"),
    )
    // Should have Warp (not disabled in this test) but not Weft
    expect(reviewSection).toContain("Warp")
    expect(reviewSection).not.toContain("Weft")
  })

  it("tapestry PlanExecution section omits Weft reference when weft disabled", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["weft"] })
    const prompt = agents["tapestry"]?.prompt ?? ""
    const planSection = prompt.slice(
      prompt.indexOf("<PlanExecution>"),
      prompt.indexOf("</PlanExecution>"),
    )
    expect(planSection).not.toContain("Weft")
    expect(planSection).toContain("Verification")
  })

  it("tapestry PlanExecution section mentions Weft by default", () => {
    const agents = createBuiltinAgents()
    const prompt = agents["tapestry"]?.prompt ?? ""
    const planSection = prompt.slice(
      prompt.indexOf("<PlanExecution>"),
      prompt.indexOf("</PlanExecution>"),
    )
    expect(planSection).toContain("Weft")
  })

  it("threads continuation config into the tapestry factory", () => {
    const agents = createBuiltinAgents({
      continuation: {
        recovery: { compaction: true },
        idle: { enabled: false, work: false, workflow: false, todo_prompt: false },
      },
    })
    const prompt = agents["tapestry"]?.prompt ?? ""
    expect(prompt).toContain("<PlanExecution>")
    expect(prompt).toContain("<Style>")
    expect(prompt).toContain("<Continuation>")
  })

  it("pattern prompt strips thread reference when thread disabled", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["thread"] })
    const prompt = agents["pattern"]?.prompt ?? ""
    expect(prompt).not.toContain("thread")
    expect(prompt).not.toContain("Thread")
    // spindle should still be present
    expect(prompt).toContain("spindle")
  })

  it("pattern prompt strips spindle reference when spindle disabled", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["spindle"] })
    const prompt = agents["pattern"]?.prompt ?? ""
    expect(prompt).not.toContain("spindle")
    expect(prompt).not.toContain("Spindle")
    // thread should still be present
    expect(prompt).toContain("thread")
  })

  it("weft prompt strips pattern reference when pattern disabled", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["pattern"] })
    const prompt = agents["weft"]?.prompt ?? ""
    expect(prompt).not.toContain("Pattern")
    expect(prompt).not.toContain("pattern")
  })

  it("all agent prompts are unmodified when no agents disabled", () => {
    const withDisabled = createBuiltinAgents({ disabledAgents: [] })
    const withoutDisabled = createBuiltinAgents()
    for (const name of ALL_AGENT_NAMES) {
      expect(withDisabled[name]?.prompt).toBe(withoutDisabled[name]?.prompt)
    }
  })

  it("registers shuttle-{category} agents for categories with patterns", () => {
    const agents = createBuiltinAgents({
      categories: {
        frontend: {
          model: "fast-model",
          prompt_append: "React expert",
          patterns: ["*.tsx", "*.css"],
        },
      },
      availableModels: new Set(["fast-model"]),
    })
    expect(agents["shuttle"]).toBeDefined()
    expect(agents["shuttle-frontend"]).toBeDefined()
    expect(agents["shuttle-frontend"]?.model).toBe("fast-model")
    expect(agents["shuttle-frontend"]?.prompt).toContain("React expert")
  })

  it("does not register shuttle-{category} agents for categories without patterns", () => {
    const agents = createBuiltinAgents({
      categories: {
        backend: { model: "claude-opus-4", temperature: 0.3 },
      },
    })
    expect(agents["shuttle"]).toBeDefined()
    expect(agents["shuttle-backend"]).toBeUndefined()
  })

  it("base shuttle agent always registered even when categories have patterns", () => {
    const agents = createBuiltinAgents({
      categories: {
        frontend: { patterns: ["*.tsx"], model: "fast-model" },
      },
      availableModels: new Set(["fast-model"]),
    })
    expect(agents["shuttle"]).toBeDefined()
  })

  it("skips registering only disabled category shuttle agents", () => {
    const agents = createBuiltinAgents({
      disabledAgents: ["shuttle-frontend"],
      categories: {
        frontend: { patterns: ["*.tsx"], model: "fast-model" },
        backend: { patterns: ["*.go"], model: "fast-model" },
      },
      availableModels: new Set(["fast-model"]),
    })

    expect(agents["shuttle"]).toBeDefined()
    expect(agents["shuttle-frontend"]).toBeUndefined()
    expect(agents["shuttle-backend"]).toBeDefined()
  })

  it("category shuttle inherits base shuttle tools", () => {
    const agents = createBuiltinAgents({
      categories: {
        frontend: { patterns: ["*.tsx"] },
      },
    })
    expect(agents["shuttle-frontend"]?.tools).toEqual(agents["shuttle"]?.tools)
  })

  it("category shuttle merges tool overrides with base shuttle tools", () => {
    const agents = createBuiltinAgents({
      categories: {
        frontend: {
          patterns: ["*.tsx"],
          tools: { web_search: true },
        },
      },
    })
    expect(agents["shuttle-frontend"]?.tools?.["call_weave_agent"]).toBe(false)
    expect(agents["shuttle-frontend"]?.tools?.["web_search"]).toBe(true)
  })
})
