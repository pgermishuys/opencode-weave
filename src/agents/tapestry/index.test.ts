import { describe, it, expect } from "bun:test"
import { createTapestryAgent } from "./index"

describe("createTapestryAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createTapestryAgent).toBe("function")
  })

  it("has mode primary", () => {
    expect(createTapestryAgent.mode).toBe("primary")
  })

  it("sets model from argument", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.model).toBe("claude-sonnet-4")
  })

  it("has a non-empty prompt", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("denies task tool", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["task"]).toBe(false)
  })

  it("denies call_weave_agent tool", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })

  it("completion step mentions post-execution review", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("Post-execution review required")
  })

  it("contains a Verification section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<Verification>")
    expect(prompt).toContain("</Verification>")
  })

  it("verification protocol mentions git diff", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("git diff")
  })

  it("verification protocol mentions running tests", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("bun test")
  })

  it("verification protocol mentions type-checking", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("type/build check")
  })

  it("verification protocol mentions acceptance criteria", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("acceptance criteria")
  })

  it("verification protocol mentions security-sensitive flagging for Warp", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("Warp")
    expect(prompt).toContain("security")
  })

  it("PlanExecution step 3c references the Verification section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<Verification>")
    // Step 3c should reference the Verification protocol
    const planExec = prompt.slice(prompt.indexOf("<PlanExecution>"), prompt.indexOf("</PlanExecution>"))
    expect(planExec).toContain("Verification")
  })
})
