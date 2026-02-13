import { describe, it, expect } from "bun:test"
import { createWeftAgent } from "./index"

describe("createWeftAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createWeftAgent).toBe("function")
  })

  it("has mode subagent", () => {
    expect(createWeftAgent.mode).toBe("subagent")
  })

  it("sets model from argument", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(config.model).toBe("claude-opus-4")
  })

  it("has a non-empty prompt", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("denies write tool", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(config.tools?.["write"]).toBe(false)
  })

  it("denies edit tool", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(config.tools?.["edit"]).toBe(false)
  })

  it("denies task tool", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(config.tools?.["task"]).toBe(false)
  })

  it("denies call_weave_agent tool", () => {
    const config = createWeftAgent("claude-opus-4")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })

  it("description contains Reviewer or Auditor", () => {
    const config = createWeftAgent("claude-opus-4")
    const desc = config.description ?? ""
    expect(desc.toLowerCase()).toMatch(/reviewer|auditor/)
  })
})
