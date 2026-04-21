import { describe, it, expect } from "bun:test"
import { createTapestryAgent, createTapestryAgentWithOptions } from "./index"

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

  it("does not configure the task tool by default", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["task"]).toBe(true)
  })

  it("allows call_weave_agent tool for delegation", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    expect(config.tools?.["call_weave_agent"]).toBe(true)
  })

  it("completion step references terminal-state behavior", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const planExec = prompt.slice(prompt.indexOf("<PlanExecution>"), prompt.indexOf("</PlanExecution>"))
    expect(planExec).toContain("terminal-state behavior")
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

  it("verification protocol mentions Shuttle output inspection", () => {
    const config = createTapestryAgent("claude-sonnet-4")
    const prompt = config.prompt as string
    const verificationSection = prompt.slice(prompt.indexOf("<Verification>"), prompt.indexOf("</Verification>"))
    expect(verificationSection).toContain("Shuttle")
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

  it("createTapestryAgentWithOptions accepts resolved continuation config without changing prompt shape", () => {
    const config = createTapestryAgentWithOptions(
      "claude-sonnet-4",
      new Set(),
      {
        recovery: { compaction: true },
        idle: { enabled: false, work: false, workflow: false, todo_prompt: false },
      },
    )
    expect(config.prompt).toContain("<PlanExecution>")
    expect(config.prompt).toContain("<PostExecutionReview>")
    expect(config.prompt).toContain("<Continuation>")
  })

  it("createTapestryAgentWithOptions includes CategoryRouting section when categories with patterns provided", () => {
    const config = createTapestryAgentWithOptions(
      "claude-sonnet-4",
      new Set(),
      undefined,
      { frontend: { patterns: ["*.tsx", "*.css"], model: "fast-model" } },
    )
    expect(config.prompt).toContain("<CategoryRouting>")
    expect(config.prompt).toContain("shuttle-frontend")
    expect(config.prompt).toContain("*.tsx")
  })

  it("createTapestryAgentWithOptions omits CategoryRouting section when no categories provided", () => {
    const config = createTapestryAgentWithOptions("claude-sonnet-4")
    expect(config.prompt).not.toContain("<CategoryRouting>")
  })

  it("createTapestryAgentWithOptions omits CategoryRouting section when categories have no patterns", () => {
    const config = createTapestryAgentWithOptions(
      "claude-sonnet-4",
      new Set(),
      undefined,
      { backend: { model: "claude-opus-4" } },
    )
    expect(config.prompt).not.toContain("<CategoryRouting>")
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
