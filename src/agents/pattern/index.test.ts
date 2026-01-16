import { describe, it, expect } from "bun:test"
import { createPatternAgent } from "./index"

describe("createPatternAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createPatternAgent).toBe("function")
  })

  it("has mode subagent", () => {
    expect(createPatternAgent.mode).toBe("subagent")
  })

  it("sets model from argument", () => {
    const config = createPatternAgent("claude-opus-4")
    expect(config.model).toBe("claude-opus-4")
  })

  it("has a non-empty prompt", () => {
    const config = createPatternAgent("claude-opus-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("has no denied tools (full access for research)", () => {
    const config = createPatternAgent("claude-opus-4")
    expect(config.tools).toBeUndefined()
  })
})
