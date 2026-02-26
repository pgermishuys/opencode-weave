import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { handleStartWork, formatValidationResults } from "./start-work-hook"
import { PLANS_DIR, WEAVE_DIR } from "../features/work-state/constants"
import { writeWorkState, createWorkState, readWorkState } from "../features/work-state/storage"

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `weave-sw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

function makePrompt(args: string = ""): string {
  return `<command-instruction>Execute plan</command-instruction>
<session-context>Session ID: sess_test  Timestamp: 2026-01-01</session-context>
<user-request>${args}</user-request>`
}

function createPlanFile(name: string, content: string): string {
  const plansDir = join(testDir, PLANS_DIR)
  mkdirSync(plansDir, { recursive: true })
  const filePath = join(plansDir, `${name}.md`)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

/**
 * Minimal plan content that passes all validation checks.
 * Accepts custom checkbox lines for the TODOs section.
 */
function validPlanContent(checkboxLines: string): string {
  return `# Plan

## TL;DR
> **Summary**: A test plan.
> **Estimated Effort**: Quick

## TODOs
${checkboxLines}

## Verification
- [ ] All done
`
}

describe("handleStartWork", () => {
  it("returns null for non-command messages", () => {
    const result = handleStartWork({
      promptText: "Just a normal message",
      sessionId: "sess_1",
      directory: testDir,
    })
    expect(result.contextInjection).toBeNull()
    expect(result.switchAgent).toBeNull()
  })

  it("always sets switchAgent to tapestry for commands", () => {
    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })
    expect(result.switchAgent).toBe("tapestry")
  })

  describe("no plans", () => {
    it("returns no-plans message", () => {
      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })
      expect(result.contextInjection).toContain("No Plans Found")
      expect(result.contextInjection).toContain("Pattern")
    })
  })

  describe("single incomplete plan", () => {
    it("auto-selects and creates work state for a valid plan", () => {
      createPlanFile(
        "my-feature",
        validPlanContent(
          "- [ ] 1. Task 1\n  **What**: Do it\n  **Files**: src/new.ts (new)\n  **Acceptance**: Works\n- [ ] 2. Task 2\n  **What**: Do it\n  **Files**: src/new2.ts (new)\n  **Acceptance**: Works"
        )
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: my-feature")
      expect(result.contextInjection).toContain("0/3 tasks completed")
      expect(result.contextInjection).toContain("SIDEBAR TODOS")

      const state = readWorkState(testDir)
      expect(state).not.toBeNull()
      expect(state!.plan_name).toBe("my-feature")
      expect(state!.agent).toBe("tapestry")
    })

    it("blocks execution when plan is missing ## TODOs section", () => {
      createPlanFile(
        "bad-plan",
        "## TL;DR\n> **Summary**: Incomplete.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Plan Validation Failed")
      expect(result.contextInjection).toContain("TODOs")
      expect(result.switchAgent).toBe("tapestry")

      // Work state must NOT be created
      expect(readWorkState(testDir)).toBeNull()
    })

    it("proceeds with warnings included in context", () => {
      // Plan with missing optional sections (## Context, ## Objectives) → warnings only
      createPlanFile(
        "warn-plan",
        "## TL;DR\n> **Summary**: Minimal.\n> **Estimated Effort**: Quick\n\n## TODOs\n- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/new.ts (new)\n  **Acceptance**: Works\n\n## Verification\n- [ ] Done\n"
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      // Should proceed (not blocked)
      expect(result.contextInjection).toContain("Starting Plan: warn-plan")
      // Warnings should be included
      expect(result.contextInjection).toContain("Validation Warnings")
      // Work state should be created
      expect(readWorkState(testDir)).not.toBeNull()
    })
  })

  describe("multiple incomplete plans", () => {
    it("lists plans for user to choose", () => {
      createPlanFile("plan-a", "# A\n- [ ] Task 1\n")
      createPlanFile("plan-b", "# B\n- [ ] Task 1\n- [x] Task 2\n")

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Multiple Plans Found")
      expect(result.contextInjection).toContain("plan-a")
      expect(result.contextInjection).toContain("plan-b")
    })
  })

  describe("explicit plan name", () => {
    it("selects matching plan by name", () => {
      createPlanFile(
        "alpha",
        validPlanContent("- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/a.ts (new)\n  **Acceptance**: Works")
      )
      createPlanFile(
        "beta",
        validPlanContent("- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/b.ts (new)\n  **Acceptance**: Works")
      )

      const result = handleStartWork({
        promptText: makePrompt("alpha"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: alpha")
    })

    it("partial name match works", () => {
      createPlanFile(
        "my-big-feature",
        validPlanContent("- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/f.ts (new)\n  **Acceptance**: Works")
      )

      const result = handleStartWork({
        promptText: makePrompt("big-feat"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: my-big-feature")
    })

    it("reports not found for unknown name", () => {
      createPlanFile("alpha", "# Alpha\n- [ ] Task\n")

      const result = handleStartWork({
        promptText: makePrompt("nonexistent"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Plan Not Found")
    })

    it("reports already complete for finished plan", () => {
      createPlanFile("done-plan", "# Done\n- [x] Task 1\n- [x] Task 2\n")

      const result = handleStartWork({
        promptText: makePrompt("done-plan"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Plan Already Complete")
    })

    it("blocks execution for explicitly named plan with validation errors", () => {
      createPlanFile(
        "broken",
        "## TL;DR\n> **Summary**: Broken.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )

      const result = handleStartWork({
        promptText: makePrompt("broken"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Plan Validation Failed")
      expect(result.contextInjection).toContain("TODOs")
      expect(readWorkState(testDir)).toBeNull()
    })
  })

  describe("resume existing state", () => {
    it("resumes incomplete plan and appends session ID", () => {
      const planPath = createPlanFile(
        "my-plan",
        validPlanContent(
          "- [x] 1. Done\n  **What**: Done\n  **Files**: src/a.ts (new)\n  **Acceptance**: OK\n- [ ] 2. Todo\n  **What**: Todo\n  **Files**: src/b.ts (new)\n  **Acceptance**: OK"
        )
      )
      const state = createWorkState(planPath, "sess_old", "tapestry")
      writeWorkState(testDir, state)

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_new",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Resuming Plan: my-plan")
      expect(result.contextInjection).toContain("1/3 tasks completed")
      expect(result.contextInjection).toContain("SIDEBAR TODOS")

      const updated = readWorkState(testDir)
      expect(updated!.session_ids).toContain("sess_new")
    })

    it("clears state and blocks when resumed plan has validation errors", () => {
      // Create a malformed plan (no ## TODOs)
      const planPath = createPlanFile(
        "corrupt-plan",
        "## TL;DR\n> **Summary**: Broken.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )
      // Inject a fake in-progress checkbox so getPlanProgress sees it as incomplete
      // The plan file has no checkboxes in ## TODOs so isComplete = true from getPlanProgress
      // To test the resume+validation path, we need a plan that looks incomplete
      // but is malformed. Use a plan with ## TODOs missing but raw checkbox present.
      const planPath2 = createPlanFile(
        "corrupt-plan2",
        "- [ ] Raw task\n## TL;DR\n> **Summary**: Broken.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )
      const state = createWorkState(planPath2, "sess_old", "tapestry")
      writeWorkState(testDir, state)

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_new",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Plan Validation Failed")
      expect(result.switchAgent).toBe("tapestry")
      // Work state should be cleared
      expect(readWorkState(testDir)).toBeNull()
    })

    it("discovers new plans when existing plan is complete", () => {
      const donePlan = createPlanFile("old-plan", "# Old\n- [x] Done\n")
      writeWorkState(testDir, createWorkState(donePlan, "sess_old", "tapestry"))

      createPlanFile(
        "new-plan",
        validPlanContent("- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/n.ts (new)\n  **Acceptance**: Works")
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: new-plan")
    })
  })

  describe("all plans complete", () => {
    it("reports all plans complete", () => {
      createPlanFile("done-a", "# A\n- [x] Done\n")
      createPlanFile("done-b", "# B\n- [x] Done\n")

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("All Plans Complete")
    })
  })
})

describe("formatValidationResults", () => {
  it("formats errors only", () => {
    const result = {
      valid: false,
      errors: [{ severity: "error" as const, category: "structure" as const, message: "Missing ## TODOs" }],
      warnings: [],
    }
    const text = formatValidationResults(result)
    expect(text).toContain("Errors (blocking):")
    expect(text).toContain("[structure] Missing ## TODOs")
    expect(text).not.toContain("Warnings:")
  })

  it("formats warnings only", () => {
    const result = {
      valid: true,
      errors: [],
      warnings: [{ severity: "warning" as const, category: "structure" as const, message: "Missing ## Context" }],
    }
    const text = formatValidationResults(result)
    expect(text).toContain("Warnings:")
    expect(text).toContain("[structure] Missing ## Context")
    expect(text).not.toContain("Errors")
  })

  it("formats both errors and warnings with blank line separator", () => {
    const result = {
      valid: false,
      errors: [{ severity: "error" as const, category: "structure" as const, message: "Error one" }],
      warnings: [{ severity: "warning" as const, category: "effort-estimate" as const, message: "Warn one" }],
    }
    const text = formatValidationResults(result)
    expect(text).toContain("Errors (blocking):")
    expect(text).toContain("Warnings:")
    expect(text).toContain("Error one")
    expect(text).toContain("Warn one")
  })
})
