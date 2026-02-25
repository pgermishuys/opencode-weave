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

  it("prompt mentions git diff", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("git diff")
  })

  it("prompt mentions running tests", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("bun test")
  })

  it("prompt instructs scoped tests with skip fallback", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("scoped tests only")
    expect(result.verificationPrompt).toContain("git diff --name-only")
    expect(result.verificationPrompt).toContain("skip running the tests")
  })

  it("prompt does NOT mention type/build check (LSP handles this)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).not.toContain("type/build check")
  })

  it("prompt mentions acceptance criteria cross-check", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("acceptance criteria")
  })

  it("prompt notes security concerns for Loom/Warp review (not delegating)", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("Warp")
    expect(result.verificationPrompt).toContain("security")
    expect(result.verificationPrompt).not.toContain("MUST delegate")
    expect(result.verificationPrompt).not.toContain("NOT optional")
  })

  it("prompt contains all security trigger keywords", () => {
    const result = buildVerificationReminder({})
    const triggers = ["auth", "crypto", "certificates", "tokens", "signatures", "input validation", "secrets", "passwords", "sessions", "CORS", "CSP", ".env"]
    for (const trigger of triggers) {
      expect(result.verificationPrompt).toContain(trigger)
    }
  })

  it("prompt uses VerificationProtocol XML tags", () => {
    const result = buildVerificationReminder({})
    expect(result.verificationPrompt).toContain("<VerificationProtocol>")
    expect(result.verificationPrompt).toContain("</VerificationProtocol>")
  })
})
