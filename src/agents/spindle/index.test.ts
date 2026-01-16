import { describe, it, expect } from "bun:test"
import { createSpindleAgent } from "./index"

describe("createSpindleAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createSpindleAgent).toBe("function")
  })

  it("has mode subagent", () => {
    expect(createSpindleAgent.mode).toBe("subagent")
  })

  it("sets model from argument", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(config.model).toBe("gemini-3-flash")
  })

  it("has a non-empty prompt", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("denies write tool", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(config.tools?.["write"]).toBe(false)
  })

  it("denies edit tool", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(config.tools?.["edit"]).toBe(false)
  })

  it("denies task tool", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(config.tools?.["task"]).toBe(false)
  })

  it("denies call_weave_agent tool", () => {
    const config = createSpindleAgent("gemini-3-flash")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })
})
