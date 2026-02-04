import { describe, it, expect } from "bun:test"
import { BUILTIN_COMMANDS } from "./commands"

describe("BUILTIN_COMMANDS", () => {
  it("has start-work command", () => {
    expect(BUILTIN_COMMANDS["start-work"]).toBeDefined()
  })

  it("start-work targets tapestry agent", () => {
    expect(BUILTIN_COMMANDS["start-work"].agent).toBe("tapestry")
  })

  it("start-work has a description", () => {
    expect(BUILTIN_COMMANDS["start-work"].description).toBeTruthy()
  })

  it("start-work template contains required placeholders", () => {
    const template = BUILTIN_COMMANDS["start-work"].template
    expect(template).toContain("$SESSION_ID")
    expect(template).toContain("$ARGUMENTS")
    expect(template).toContain("$TIMESTAMP")
  })

  it("start-work template contains session-context tag", () => {
    const template = BUILTIN_COMMANDS["start-work"].template
    expect(template).toContain("<session-context>")
    expect(template).toContain("</session-context>")
  })

  it("start-work template contains command-instruction tag", () => {
    const template = BUILTIN_COMMANDS["start-work"].template
    expect(template).toContain("<command-instruction>")
    expect(template).toContain("</command-instruction>")
  })

  it("start-work has argument hint", () => {
    expect(BUILTIN_COMMANDS["start-work"].argumentHint).toBe("[plan-name]")
  })

  it("start-work has name matching its key", () => {
    expect(BUILTIN_COMMANDS["start-work"].name).toBe("start-work")
  })
})
