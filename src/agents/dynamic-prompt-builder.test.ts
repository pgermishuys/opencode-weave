import { describe, it, expect } from "bun:test"
import {
  categorizeTools,
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildThreadSection,
  buildSpindleSection,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
} from "./dynamic-prompt-builder"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "./dynamic-prompt-builder"

function makeAgent(name: string, overrides: Partial<AvailableAgent["metadata"]> = {}): AvailableAgent {
  return {
    name,
    description: `${name} agent description.`,
    metadata: {
      category: "specialist",
      cost: "CHEAP",
      triggers: [{ domain: `${name} domain`, trigger: `Use for ${name} tasks` }],
      ...overrides,
    },
  }
}

describe("categorizeTools", () => {
  it("categorizes tool names by prefix/exact match", () => {
    const tools = categorizeTools(["lsp_hover", "ast_grep_find", "grep", "glob", "session_list", "skill", "write"])
    expect(tools.find((t) => t.name === "lsp_hover")?.category).toBe("lsp")
    expect(tools.find((t) => t.name === "ast_grep_find")?.category).toBe("ast")
    expect(tools.find((t) => t.name === "grep")?.category).toBe("search")
    expect(tools.find((t) => t.name === "glob")?.category).toBe("search")
    expect(tools.find((t) => t.name === "session_list")?.category).toBe("session")
    expect(tools.find((t) => t.name === "skill")?.category).toBe("command")
    expect(tools.find((t) => t.name === "write")?.category).toBe("other")
  })

  it("returns empty array for empty input", () => {
    expect(categorizeTools([])).toEqual([])
  })
})

describe("buildKeyTriggersSection", () => {
  it("returns empty string when no agents have keyTrigger", () => {
    const agents = [makeAgent("loom"), makeAgent("tapestry")]
    expect(buildKeyTriggersSection(agents)).toBe("")
  })

  it("includes keyTrigger lines for agents that have them", () => {
    const agents = [makeAgent("loom", { keyTrigger: "**'ultrawork'** → Deep execution mode" })]
    const result = buildKeyTriggersSection(agents)
    expect(result).toContain("**'ultrawork'**")
    expect(result).toContain("Key Triggers")
  })
})

describe("buildToolSelectionTable", () => {
  it("orders agents by cost FREE → CHEAP → EXPENSIVE", () => {
    const agents = [
      makeAgent("expensive-agent", { cost: "EXPENSIVE" }),
      makeAgent("free-agent", { cost: "FREE" }),
      makeAgent("cheap-agent", { cost: "CHEAP" }),
    ]
    const result = buildToolSelectionTable(agents)
    const freePos = result.indexOf("free-agent")
    const cheapPos = result.indexOf("cheap-agent")
    const expensivePos = result.indexOf("expensive-agent")
    expect(freePos).toBeLessThan(cheapPos)
    expect(cheapPos).toBeLessThan(expensivePos)
  })

  it("excludes utility category agents", () => {
    const agents = [
      makeAgent("shuttle", { category: "utility" }),
      makeAgent("pattern", { cost: "EXPENSIVE", category: "specialist" }),
    ]
    const result = buildToolSelectionTable(agents)
    expect(result).not.toContain("shuttle")
    expect(result).toContain("pattern")
  })

  it("includes tool names in FREE section when tools provided", () => {
    const agents = [makeAgent("loom")]
    const tools = categorizeTools(["grep", "glob"])
    const result = buildToolSelectionTable(agents, tools)
    expect(result).toContain("`grep`")
    expect(result).toContain("FREE")
  })

  it("always ends with default flow line", () => {
    const result = buildToolSelectionTable([makeAgent("loom")])
    expect(result).toContain("Default flow")
  })
})

describe("buildThreadSection", () => {
  it("returns empty string when no thread agent", () => {
    const agents = [makeAgent("loom")]
    expect(buildThreadSection(agents)).toBe("")
  })

  it("returns thread section when thread agent present", () => {
    const agents = [makeAgent("thread", {
      useWhen: ["Pattern unknown", "Multi-file search needed"],
      avoidWhen: ["File path known", "Single file only"],
    })]
    const result = buildThreadSection(agents)
    expect(result).toContain("Thread Agent")
    expect(result).toContain("Pattern unknown")
    expect(result).toContain("File path known")
  })
})

describe("buildSpindleSection", () => {
  it("returns empty string when no spindle agent", () => {
    const agents = [makeAgent("loom")]
    expect(buildSpindleSection(agents)).toBe("")
  })

  it("returns spindle section when spindle agent present", () => {
    const agents = [makeAgent("spindle", {
      useWhen: ["official docs", "external library"],
    })]
    const result = buildSpindleSection(agents)
    expect(result).toContain("Spindle Agent")
    expect(result).toContain('"official docs"')
  })
})

describe("buildDelegationTable", () => {
  it("includes all agents with their triggers", () => {
    const agents = [
      makeAgent("loom", { triggers: [{ domain: "Orchestration", trigger: "Main tasks" }] }),
      makeAgent("pattern", { triggers: [{ domain: "Planning", trigger: "Complex plans" }] }),
    ]
    const result = buildDelegationTable(agents)
    expect(result).toContain("**Orchestration**")
    expect(result).toContain("`loom`")
    expect(result).toContain("**Planning**")
    expect(result).toContain("`pattern`")
  })

  it("handles agents with no triggers", () => {
    const agents = [makeAgent("loom", { triggers: [] })]
    const result = buildDelegationTable(agents)
    expect(result).toContain("### Delegation Table:")
  })
})

describe("buildCategorySkillsDelegationGuide", () => {
  it("returns empty string when no categories or skills", () => {
    expect(buildCategorySkillsDelegationGuide([], [])).toBe("")
  })

  it("lists categories with descriptions", () => {
    const categories: AvailableCategory[] = [
      { name: "quick", description: "Fast tasks" },
      { name: "deep", description: "Complex reasoning" },
    ]
    const result = buildCategorySkillsDelegationGuide(categories, [])
    expect(result).toContain("`quick`")
    expect(result).toContain("Fast tasks")
    expect(result).toContain("`deep`")
  })

  it("separates builtin and custom skills correctly", () => {
    const categories: AvailableCategory[] = [{ name: "quick", description: "Fast" }]
    const skills: AvailableSkill[] = [
      { name: "playwright", description: "Browser automation", location: "builtin" },
      { name: "my-skill", description: "Custom skill", location: "user" },
    ]
    const result = buildCategorySkillsDelegationGuide(categories, skills)
    expect(result).toContain("**Built-in**: playwright")
    expect(result).toContain("**⚡ YOUR SKILLS (PRIORITY)**")
    expect(result).toContain("my-skill (user)")
  })
})
