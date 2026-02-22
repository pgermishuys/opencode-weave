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

  it("PlanWorkflow specifies the only skip condition", () => {
    const config = createLoomAgent("claude-opus-4")
    const prompt = config.prompt as string
    const planWorkflow = prompt.slice(
      prompt.indexOf("<PlanWorkflow>"),
      prompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).toContain("skip review")
  })
})
