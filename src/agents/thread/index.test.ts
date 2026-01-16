import { describe, it, expect } from "bun:test"
import { createThreadAgent } from "./index"

describe("createThreadAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createThreadAgent).toBe("function")
  })

  it("has mode subagent", () => {
    expect(createThreadAgent.mode).toBe("subagent")
  })

  it("sets model from argument", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(config.model).toBe("grok-code-fast")
  })

  it("has a non-empty prompt", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("denies write tool", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(config.tools?.["write"]).toBe(false)
  })

  it("denies edit tool", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(config.tools?.["edit"]).toBe(false)
  })

  it("denies task tool", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(config.tools?.["task"]).toBe(false)
  })

  it("denies call_weave_agent tool", () => {
    const config = createThreadAgent("grok-code-fast")
    expect(config.tools?.["call_weave_agent"]).toBe(false)
  })
})
