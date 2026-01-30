import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { handleStartWork } from "./start-work-hook"
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
    it("auto-selects and creates work state", () => {
      createPlanFile("my-feature", "# Plan\n- [ ] Task 1\n- [ ] Task 2\n")

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: my-feature")
      expect(result.contextInjection).toContain("0/2 tasks completed")

      const state = readWorkState(testDir)
      expect(state).not.toBeNull()
      expect(state!.plan_name).toBe("my-feature")
      expect(state!.agent).toBe("tapestry")
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
      createPlanFile("alpha", "# Alpha\n- [ ] Task\n")
      createPlanFile("beta", "# Beta\n- [ ] Task\n")

      const result = handleStartWork({
        promptText: makePrompt("alpha"),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: alpha")
    })

    it("partial name match works", () => {
      createPlanFile("my-big-feature", "# Feature\n- [ ] Task\n")

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
  })

  describe("resume existing state", () => {
    it("resumes incomplete plan and appends session ID", () => {
      const planPath = createPlanFile("my-plan", "# Plan\n- [x] Done\n- [ ] Todo\n")
      const state = createWorkState(planPath, "sess_old", "tapestry")
      writeWorkState(testDir, state)

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_new",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Resuming Plan: my-plan")
      expect(result.contextInjection).toContain("1/2 tasks completed")

      const updated = readWorkState(testDir)
      expect(updated!.session_ids).toContain("sess_new")
    })

    it("discovers new plans when existing plan is complete", () => {
      const donePlan = createPlanFile("old-plan", "# Old\n- [x] Done\n")
      writeWorkState(testDir, createWorkState(donePlan, "sess_old", "tapestry"))

      createPlanFile("new-plan", "# New\n- [ ] Task\n")

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
