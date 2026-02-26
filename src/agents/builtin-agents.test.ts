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
})
