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

  it("allows task tool for post-execution reviews", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["task"]).toBeUndefined()
  })

  it("denies call_weave_agent tool", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })

  it("completion step references PostExecutionReview", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const planExec = prompt.slice(prompt.indexOf("<PlanExecution>"), prompt.indexOf("</PlanExecution>"))
    expect(planExec).toContain("PostExecutionReview")
  })

  it("contains a PostExecutionReview section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<PostExecutionReview>")
    expect(prompt).toContain("</PostExecutionReview>")
  })

  it("PostExecutionReview invokes Weft and Warp directly", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const reviewSection = prompt.slice(prompt.indexOf("<PostExecutionReview>"), prompt.indexOf("</PostExecutionReview>"))
    expect(reviewSection).toContain("Weft")
    expect(reviewSection).toContain("Warp")
    expect(reviewSection).toContain("Task tool")
  })

  it("PostExecutionReview reports findings without fixing them", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const reviewSection = prompt.slice(prompt.indexOf("<PostExecutionReview>"), prompt.indexOf("</PostExecutionReview>"))
    expect(reviewSection).toContain("do NOT attempt to fix")
    expect(reviewSection).toContain("user approval")
  })

  it("contains a Verification section", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("<Verification>")
    expect(prompt).toContain("</Verification>")
  })

  it("verification protocol mentions tool call history instead of git diff", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const verificationSection = prompt.slice(prompt.indexOf("<Verification>"), prompt.indexOf("</Verification>"))
    expect(verificationSection).toContain("Edit/Write tool call history")
    expect(verificationSection).not.toContain("git diff")
  })

  it("verification protocol does NOT mention automated checks (removed)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("Run automated checks")
    expect(prompt).not.toContain("bun test")
  })

  it("verification protocol does NOT mention type-checking (LSP handles this)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("type/build check")
  })

  it("verification protocol mentions acceptance criteria", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).toContain("acceptance criteria")
  })

  it("verification protocol does NOT mention security-sensitive flagging (removed)", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    expect(prompt).not.toContain("Flag security-sensitive")
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
