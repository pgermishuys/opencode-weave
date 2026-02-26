import { describe, it, expect } from "bun:test"
import { createLoomAgent } from "./index"

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

  it("PlanWorkflow specifies review trigger conditions", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("3+ files")
    expect(planWorkflow).toContain("5+ tasks")
  })

  it("PlanWorkflow Step 2 has skip condition", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    // Step 2 still allows skip
    expect(planWorkflow).toContain("SKIP ONLY IF")
  })

  it("ReviewWorkflow contains mandatory Warp invocation language", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    expect(reviewWorkflow).toContain("MUST run Warp")
    expect(reviewWorkflow).toContain("NOT optional")
  })

  it("ReviewWorkflow contains all security trigger keywords", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    const triggers = ["crypto", "auth", "certificates", "tokens", "signatures", "input validation"]
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

  it("ReviewWorkflow contains ad-hoc review mode", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const reviewWorkflow = prompt.slice(
      prompt.indexOf("<ReviewWorkflow>"),
      prompt.indexOf("</ReviewWorkflow>"),
    )
    expect(reviewWorkflow).toContain("Ad-Hoc Review")
    expect(reviewWorkflow).not.toContain("Post-Plan-Execution Review")
  })
})
