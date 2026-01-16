import { describe, it, expect } from "bun:test"
import { createShuttleAgent } from "./index"

describe("createShuttleAgent", () => {
  it("is a callable factory", () => {
    expect(typeof createShuttleAgent).toBe("function")
  })

  it("has mode all", () => {
    expect(createShuttleAgent.mode).toBe("all")
  })

  it("sets model from argument", () => {
    const config = createShuttleAgent("claude-sonnet-4")
    expect(config.model).toBe("claude-sonnet-4")
  })

  it("has a non-empty prompt", () => {
    const config = createShuttleAgent("claude-sonnet-4")
    expect(typeof config.prompt).toBe("string")
    expect(config.prompt!.length).toBeGreaterThan(0)
  })

  it("has no denied tools (full access)", () => {
    const config = createShuttleAgent("claude-sonnet-4")
    expect(config.tools).toBeUndefined()
  })
})
