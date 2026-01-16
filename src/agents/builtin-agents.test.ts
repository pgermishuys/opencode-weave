import { describe, it, expect } from "bun:test"
import { createBuiltinAgents, AGENT_METADATA } from "./builtin-agents"

const ALL_AGENT_NAMES = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle"]

describe("createBuiltinAgents", () => {
  it("returns all 6 agents when none disabled", () => {
    const agents = createBuiltinAgents()
    for (const name of ALL_AGENT_NAMES) {
      expect(agents[name]).toBeDefined()
    }
    expect(Object.keys(agents)).toHaveLength(6)
  })

  it("excludes disabled agents", () => {
    const agents = createBuiltinAgents({ disabledAgents: ["spindle", "thread"] })
    expect(agents["spindle"]).toBeUndefined()
    expect(agents["thread"]).toBeUndefined()
    expect(agents["loom"]).toBeDefined()
    expect(Object.keys(agents)).toHaveLength(4)
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
})

describe("AGENT_METADATA", () => {
  it("has entries for all 6 agents", () => {
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
})
