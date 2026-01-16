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
})
