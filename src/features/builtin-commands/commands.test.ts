import { describe, it, expect } from "bun:test"
import { BUILTIN_COMMANDS } from "./commands"
import { START_WORK_TEMPLATE } from "./templates/start-work"

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

  it("has token-report command", () => {
    expect(BUILTIN_COMMANDS["token-report"]).toBeDefined()
  })

  it("token-report has a description", () => {
    expect(BUILTIN_COMMANDS["token-report"].description).toBeTruthy()
  })

  it("token-report has name matching its key", () => {
    expect(BUILTIN_COMMANDS["token-report"].name).toBe("token-report")
  })

  it("has weave-health command", () => {
    expect(BUILTIN_COMMANDS["weave-health"]).toBeDefined()
  })

  it("weave-health targets loom agent", () => {
    expect(BUILTIN_COMMANDS["weave-health"].agent).toBe("loom")
  })

  it("weave-health has a description", () => {
    expect(BUILTIN_COMMANDS["weave-health"].description).toBeTruthy()
  })

  it("weave-health has name matching its key", () => {
    expect(BUILTIN_COMMANDS["weave-health"].name).toBe("weave-health")
  })
})

describe("START_WORK_TEMPLATE — delegation semantics", () => {
  it("instructs Tapestry to delegate tasks to Shuttle via Task tool", () => {
    expect(START_WORK_TEMPLATE).toContain("Task tool")
    expect(START_WORK_TEMPLATE).toContain("Shuttle")
  })

  it("explicitly forbids direct implementation", () => {
    expect(START_WORK_TEMPLATE).toContain("do NOT implement work directly")
  })

  it("contains delegation prompt template with required fields", () => {
    expect(START_WORK_TEMPLATE).toContain("**What**")
    expect(START_WORK_TEMPLATE).toContain("**Files**")
    expect(START_WORK_TEMPLATE).toContain("**Acceptance**")
  })

  it("preserves non-terminal execution semantics", () => {
    expect(START_WORK_TEMPLATE).toContain("non-terminal")
    expect(START_WORK_TEMPLATE).toContain("- [ ]")
  })

  it("preserves verification step before marking complete", () => {
    expect(START_WORK_TEMPLATE).toContain("Verify")
    expect(START_WORK_TEMPLATE).toContain("- [x]")
  })

  it("preserves progress reporting step", () => {
    expect(START_WORK_TEMPLATE).toContain("Report progress")
  })

  it("preserves blocked-task handling", () => {
    expect(START_WORK_TEMPLATE).toContain("blocked")
    expect(START_WORK_TEMPLATE).toContain("next unchecked task")
  })

  it("preserves stop conditions", () => {
    expect(START_WORK_TEMPLATE).toContain("all checkboxes are checked")
    expect(START_WORK_TEMPLATE).toContain("user explicitly tells you to stop")
    expect(START_WORK_TEMPLATE).toContain("every remaining unchecked task is truly blocked")
  })

  it("does not tell Tapestry to write code or run commands directly", () => {
    expect(START_WORK_TEMPLATE).not.toContain("write code, run commands, create files")
  })
})
