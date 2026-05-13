import { describe, expect, it } from "bun:test"
import { resolveBuiltinAgentTarget } from "./builtin-agent-target"

function getSection(prompt: string | undefined, sectionName: string): string | null {
  if (!prompt) {
    return null
  }

  const startTag = `<${sectionName}>`
  const endTag = `</${sectionName}>`
  const startIndex = prompt.indexOf(startTag)
  const endIndex = prompt.indexOf(endTag)

  if (startIndex === -1 || endIndex === -1) {
    return null
  }

  return prompt.slice(startIndex, endIndex + endTag.length)
}

describe("resolveBuiltinAgentTarget", () => {
  it("renders loom via composer", () => {
    const result = resolveBuiltinAgentTarget({ kind: "builtin-agent-prompt", agent: "loom" })
    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<PlanWorkflow>")
  })

  it("supports disabled-agent variants", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: { disabledAgents: ["warp"] },
    })
    expect(result.artifacts.renderedPrompt).not.toContain("MUST use Warp")
  })

  it("accepts agentOverrides variants for Loom prompt composition", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: {
        disabledAgents: ["warp"],
        agentOverrides: {
          loom: { model: "openrouter/openai/gpt-5" },
          weft: { review_models: ["anthropic/claude-sonnet-4"] },
        },
      },
    })

    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<PlanWorkflow>")
    expect(result.artifacts.renderedPrompt).not.toContain("MUST use Warp")
  })

  it("accepts agentOverrides variants for Loom", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "loom",
      variant: {
        disabledAgents: ["warp"],
        agentOverrides: {
          weft: { review_models: ["anthropic/claude-sonnet-4"] },
        },
      } as any,
    })

    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<PlanWorkflow>")
    expect(result.artifacts.renderedPrompt).not.toContain("MUST use Warp")
  })

  it("resolves default-agent prompts", () => {
    const result = resolveBuiltinAgentTarget({ kind: "builtin-agent-prompt", agent: "thread" })
    expect(result.artifacts.agentMetadata?.sourceKind).toBe("default")
    expect(result.artifacts.toolPolicy).toEqual({
      write: false,
      edit: false,
      task: false,
      call_weave_agent: false,
    })
  })

  it("resolves shuttle with default prompt and tool deny-list", () => {
    const result = resolveBuiltinAgentTarget({ kind: "builtin-agent-prompt", agent: "shuttle" })
    expect(result.artifacts.agentMetadata?.sourceKind).toBe("default")
    expect(result.artifacts.agentMetadata?.agent).toBe("shuttle")
    expect(result.artifacts.toolPolicy).toEqual({ call_weave_agent: false })
    expect(result.artifacts.renderedPrompt).toBeTruthy()
    expect(result.artifacts.renderedPrompt!.length).toBeGreaterThan(0)
    expect(result.artifacts.renderedPrompt).toContain("<Role>")
    expect(result.artifacts.renderedPrompt).toContain("Never spawn subagents")
  })

  it("passes categories variants into Tapestry prompt composition", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "tapestry",
      variant: {
        categories: {
          frontend: { patterns: ["src/**"] },
          backend: { patterns: ["src/**/*.ts"] },
          docs: {},
        },
      },
    })

    const categoryRoutingSection = getSection(result.artifacts.renderedPrompt, "CategoryRouting")
    const delegationSection = getSection(result.artifacts.renderedPrompt, "Delegation")

    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(categoryRoutingSection).not.toBeNull()
    expect(categoryRoutingSection).toContain("<CategoryRouting>")
    expect(categoryRoutingSection).toContain("shuttle-frontend: patterns [src/**]")
    expect(categoryRoutingSection).toContain("shuttle-backend: patterns [src/**/*.ts]")
    expect(categoryRoutingSection).toContain(
      "shuttle-docs: (no file patterns — explicit/manual-use only; never auto-select from file matches)",
    )
    expect(categoryRoutingSection).toContain(
      "Match task's **Files** against category patterns in config declaration order → use the first matching `shuttle-{category}`",
    )
    expect(categoryRoutingSection).toContain(
      "If multiple categories match the same task's files, the earliest declared matching category wins; later matches do not override earlier ones",
    )
    expect(categoryRoutingSection).toContain("No match → use generic `shuttle`")
    expect(categoryRoutingSection).toContain("Always fall back to generic `shuttle` if the named category agent is unavailable")

    expect(delegationSection).not.toBeNull()
    expect(delegationSection).toContain("shuttle-frontend")
    expect(delegationSection).toContain("shuttle-backend")
    expect(delegationSection).not.toContain("shuttle-docs")
    expect(delegationSection).not.toContain("shuttle-{category}")
  })

  it("accepts agentOverrides variants for Tapestry", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "tapestry",
      variant: {
        categories: {
          frontend: { patterns: ["src/**"] },
        },
        agentOverrides: {
          weft: { review_models: ["anthropic/claude-sonnet-4"] },
        },
      } as any,
    })

    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<CategoryRouting>")
    expect(result.artifacts.renderedPrompt).toContain("shuttle-frontend")
  })

  it("accepts combined categories and agentOverrides variants for Tapestry prompt composition", () => {
    const result = resolveBuiltinAgentTarget({
      kind: "builtin-agent-prompt",
      agent: "tapestry",
      variant: {
        categories: {
          frontend: { patterns: ["src/**"] },
        },
        agentOverrides: {
          tapestry: { model: "openrouter/openai/gpt-5" },
        },
      },
    })

    expect(result.artifacts.agentMetadata?.sourceKind).toBe("composer")
    expect(result.artifacts.renderedPrompt).toContain("<CategoryRouting>")
    expect(result.artifacts.renderedPrompt).toContain("shuttle-frontend: patterns [src/**]")
  })
})
