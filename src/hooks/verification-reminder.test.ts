import { describe, it, expect } from "bun:test"
import { buildVerificationReminder } from "./verification-reminder"

describe("buildVerificationReminder", () => {
  it("returns non-null verificationPrompt", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toBeNull()
    expect(typeof result.verificationPrompt).toBe("string")
  })

  it("includes plan context when planName and progress provided", () => {
    const result = buildVerificationReminder({
      planName: "my-feature",
      progress: { total: 10, completed: 5 },
    })
    expect(result.verificationPrompt).toContain("my-feature")
    expect(result.verificationPrompt).toContain("5/10")
  })

  it("omits plan context when no planName provided", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("**Plan**")
  })

  it("omits plan context when planName provided but no progress", () => {
    const result = buildVerificationReminder({ planName: "orphan-plan" })
    expect(result.verificationPrompt).not.toContain("**Plan**")
  })

  it("prompt does NOT contain call_weave_agent (Tapestry cannot spawn subagents)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("call_weave_agent")
  })

  it("prompt mentions reviewing tool call history instead of git diff", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("Edit/Write tool call history")
    expect(result.verificationPrompt).not.toContain("git diff")
  })

  it("prompt does NOT mention automated checks (removed)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("Run Automated Checks")
    expect(result.verificationPrompt).not.toContain("bun test")
    expect(result.verificationPrompt).not.toContain("scoped tests only")
  })

  it("prompt does NOT mention type/build check (LSP handles this)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("type/build check")
  })

  it("prompt mentions acceptance criteria cross-check", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("acceptance criteria")
  })

  it("prompt does NOT contain security-sensitive flagging (removed from Tapestry verification)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("Security-Sensitive")
    expect(result.verificationPrompt).not.toContain("Warp")
  })

  it("prompt uses VerificationProtocol XML tags", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("<VerificationProtocol>")
    expect(result.verificationPrompt).toContain("</VerificationProtocol>")
  })
})
