import { describe, it, expect } from "bun:test"
import { createLoomAgent, createLoomAgentWithOptions } from "./index"

describe("createLoomAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createLoomAgent).toBe("function")
  })

  it("has mode primary", () => {
    expect(createLoomAgent.mode).toBe("primary")
  })

  it("sets model from argument", () => {
    const config = createLoomAgent("claude-opus-4")
    expect(config.model).toBe("claude-opus-4")
  })

  it("has a non-empty prompt", () => {
    const config = createLoomAgent("claude-opus-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("has no denied tools (full access)", () => {
    const config = createLoomAgent("claude-opus-4")
    expect(config.tools).toBeUndefined()
  })

  it("PlanWorkflow review step is not marked optional", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).not.toContain("(optional)")
  })

  it("PlanWorkflow specifies when to use plan workflow", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("5+ step tasks")
    expect(planWorkflow).toContain("multi-file refactors")
  })

  it("PlanWorkflow includes review step with Weft and Warp", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("REVIEW")
    expect(planWorkflow).toContain("Weft")
    expect(planWorkflow).toContain("Warp")
  })

  it("ReviewWorkflow contains Warp mandatory language", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    expect(reviewWorkflow).toContain("Warp is mandatory")
  })

  it("ReviewWorkflow contains key security trigger keywords", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    const triggers = ["crypto", "auth", "tokens", "secrets", "input validation"]
    for (const trigger of triggers) {
      expect(reviewWorkflow).toContain(trigger)
    }
  })

  it("PlanWorkflow references Warp for security-relevant plans", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow.toLowerCase()).toContain("warp")
    expect(planWorkflow.toLowerCase()).toContain("security")
  })

  it("Delegation section uses mandatory language for Warp", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const delegation = prompt.slice(
      prompt.indexOf("<Delegation>"),
      prompt.indexOf("</Delegation>"),
    )
    expect(delegation).toContain("MUST use Warp")
  })

  it("PlanWorkflow notes Tapestry handles execution", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("Tapestry handles execution")
  })

  it("PlanWorkflow does not contain Step 5 POST-EXECUTION REVIEW", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).not.toContain("5. POST-EXECUTION REVIEW")
  })

  it("ReviewWorkflow is ad-hoc only (no post-plan section)", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    expect(reviewWorkflow).toContain("Ad-hoc review")
    expect(reviewWorkflow).toContain("Weft")
    expect(reviewWorkflow).not.toContain("Post-Plan")
  })
})

describe("createLoomAgentWithOptions", () => {
  it("includes custom agent triggers in prompt when provided", () => {
    const config = createLoomAgentWithOptions("claude-opus-4", undefined, null, [{
      name: "code-reviewer",
      description: "Reviews code",
      metadata: {
        category: "advisor",
        cost: "CHEAP",
        triggers: [{ domain: "Code Review", trigger: "Code quality review" }],
      },
    }])
    expect(config.prompt).toContain("<CustomDelegation>")
    expect(config.prompt).toContain("code-reviewer")
    expect(config.prompt).toContain("Code Review")
  })

  it("returns default prompt when no custom agents, disabled, or fingerprint", () => {
    const config = createLoomAgentWithOptions("claude-opus-4")
    expect(config.prompt).not.toContain("<CustomDelegation>")
  })

  it("returns default prompt with empty custom agents array", () => {
    const config = createLoomAgentWithOptions("claude-opus-4", undefined, null, [])
    expect(config.prompt).not.toContain("<CustomDelegation>")
  })

  it("includes multiple custom agents in delegation table", () => {
    const config = createLoomAgentWithOptions("claude-opus-4", undefined, null, [
      {
        name: "code-reviewer",
        description: "Reviews code",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [{ domain: "Code Review", trigger: "Quality review" }],
        },
      },
      {
        name: "compliance",
        description: "Checks compliance",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [{ domain: "Compliance", trigger: "License checks" }],
        },
      },
    ])
    expect(config.prompt).toContain("code-reviewer")
    expect(config.prompt).toContain("compliance")
    expect(config.prompt).toContain("Code Review")
    expect(config.prompt).toContain("Compliance")
  })

  it("combines custom agents with fingerprint and disabled agents", () => {
    const config = createLoomAgentWithOptions(
      "claude-opus-4",
      new Set(["spindle"]),
      {
        generatedAt: new Date().toISOString(),
        stack: [{ name: "bun", confidence: "high", evidence: "bun.lockb" }],
        isMonorepo: false,
        primaryLanguage: "typescript",
        packageManager: "bun",
      },
      [{
        name: "test-agent",
        description: "Test agent",
        metadata: {
          category: "specialist",
          cost: "CHEAP",
          triggers: [{ domain: "Testing", trigger: "Run tests" }],
        },
      }],
    )
    expect(config.prompt).toContain("<CustomDelegation>")
    expect(config.prompt).toContain("<ProjectContext>")
    expect(config.prompt).not.toContain("Use spindle")
  })

  it("sets mode to primary", () => {
    const config = createLoomAgentWithOptions("claude-opus-4", undefined, null, [{
      name: "test",
      description: "Test",
      metadata: { category: "utility", cost: "CHEAP", triggers: [{ domain: "Test", trigger: "test" }] },
    }])
    expect(config.mode).toBe("primary")
  })
})
