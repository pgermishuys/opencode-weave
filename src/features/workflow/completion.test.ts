import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { checkStepCompletion } from "./completion"
import type { CompletionContext } from "./completion"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-completion-test-"))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on Windows
  }
})

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    directory: testDir,
    config: { method: "user_confirm" },
    artifacts: {},
    ...overrides,
  }
}

describe("user_confirm", () => {
  it("detects 'confirmed' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "Yes, confirmed" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("detects 'approved' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "Approved!" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("detects 'continue' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "continue" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("detects 'done' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "done" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("detects 'let's proceed' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "let's proceed" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("detects 'lgtm' keyword", () => {
    const ctx = makeContext({ lastUserMessage: "LGTM" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("is case-insensitive", () => {
    const ctx = makeContext({ lastUserMessage: "CONFIRMED" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("returns false for unrelated messages", () => {
    const ctx = makeContext({ lastUserMessage: "What about error handling?" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns false when no user message", () => {
    const ctx = makeContext()
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(false)
  })

  it("uses custom keywords when provided", () => {
    const ctx = makeContext({
      lastUserMessage: "ship it",
      config: { method: "user_confirm", keywords: ["ship it", "go ahead"] },
    })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.complete).toBe(true)
  })

  it("returns summary with user message", () => {
    const ctx = makeContext({ lastUserMessage: "confirmed" })
    const result = checkStepCompletion("user_confirm", ctx)
    expect(result.summary).toContain("confirmed")
  })
})

describe("plan_created", () => {
  it("detects plan file by direct path", () => {
    const planDir = join(testDir, ".weave", "plans")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, "my-plan.md"), "# Plan", "utf-8")
    const ctx = makeContext({ config: { method: "plan_created", plan_name: "my-plan" } })
    const result = checkStepCompletion("plan_created", ctx)
    expect(result.complete).toBe(true)
    expect(result.artifacts).toBeDefined()
    expect(result.artifacts!.plan_path).toContain("my-plan.md")
  })

  it("returns false when plan doesn't exist", () => {
    const ctx = makeContext({ config: { method: "plan_created", plan_name: "nonexistent" } })
    const result = checkStepCompletion("plan_created", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns false when plan_name is missing", () => {
    const ctx = makeContext({ config: { method: "plan_created" } })
    const result = checkStepCompletion("plan_created", ctx)
    expect(result.complete).toBe(false)
    expect(result.reason).toContain("plan_name")
  })
})

describe("plan_complete", () => {
  it("detects completed plan", () => {
    const planDir = join(testDir, ".weave", "plans")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, "my-plan.md"), "- [x] Done 1\n- [x] Done 2\n", "utf-8")
    const ctx = makeContext({ config: { method: "plan_complete", plan_name: "my-plan" } })
    const result = checkStepCompletion("plan_complete", ctx)
    expect(result.complete).toBe(true)
    expect(result.summary).toContain("2/2")
  })

  it("returns false for incomplete plan", () => {
    const planDir = join(testDir, ".weave", "plans")
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, "my-plan.md"), "- [x] Done\n- [ ] Todo\n", "utf-8")
    const ctx = makeContext({ config: { method: "plan_complete", plan_name: "my-plan" } })
    const result = checkStepCompletion("plan_complete", ctx)
    expect(result.complete).toBe(false)
    expect(result.reason).toContain("1/2")
  })

  it("returns false when plan file doesn't exist", () => {
    const ctx = makeContext({ config: { method: "plan_complete", plan_name: "nonexistent" } })
    const result = checkStepCompletion("plan_complete", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns false when plan_name is missing", () => {
    const ctx = makeContext({ config: { method: "plan_complete" } })
    const result = checkStepCompletion("plan_complete", ctx)
    expect(result.complete).toBe(false)
  })
})

describe("review_verdict", () => {
  it("detects [APPROVE]", () => {
    const ctx = makeContext({ lastAssistantMessage: "The code looks good. [APPROVE]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(true)
    expect(result.verdict).toBe("approve")
  })

  it("detects [REJECT]", () => {
    const ctx = makeContext({ lastAssistantMessage: "Found issues. [REJECT]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(true)
    expect(result.verdict).toBe("reject")
  })

  it("is case-insensitive", () => {
    const ctx = makeContext({ lastAssistantMessage: "[approve]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(true)
    expect(result.verdict).toBe("approve")
  })

  it("handles whitespace in brackets", () => {
    const ctx = makeContext({ lastAssistantMessage: "[ APPROVE ]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(true)
  })

  it("returns false when no verdict marker", () => {
    const ctx = makeContext({ lastAssistantMessage: "I reviewed it but no verdict" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns false when no assistant message", () => {
    const ctx = makeContext()
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns summary for approve", () => {
    const ctx = makeContext({ lastAssistantMessage: "[APPROVE]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.summary).toContain("APPROVED")
  })

  it("returns summary for reject", () => {
    const ctx = makeContext({ lastAssistantMessage: "[REJECT]" })
    const result = checkStepCompletion("review_verdict", ctx)
    expect(result.summary).toContain("REJECTED")
  })
})

describe("agent_signal", () => {
  it("detects completion marker", () => {
    const ctx = makeContext({
      lastAssistantMessage: "Done!\n<!-- workflow:step-complete -->",
    })
    const result = checkStepCompletion("agent_signal", ctx)
    expect(result.complete).toBe(true)
  })

  it("returns false without marker", () => {
    const ctx = makeContext({ lastAssistantMessage: "I'm done but forgot the marker" })
    const result = checkStepCompletion("agent_signal", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns false when no assistant message", () => {
    const ctx = makeContext()
    const result = checkStepCompletion("agent_signal", ctx)
    expect(result.complete).toBe(false)
  })

  it("returns summary on completion", () => {
    const ctx = makeContext({
      lastAssistantMessage: "<!-- workflow:step-complete -->",
    })
    const result = checkStepCompletion("agent_signal", ctx)
    expect(result.summary).toContain("signaled completion")
  })
})
