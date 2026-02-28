import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { checkContinuation } from "./work-continuation"
import { writeWorkState, createWorkState, readWorkState } from "../features/work-state/storage"
import { PLANS_DIR } from "../features/work-state/constants"

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `weave-cont-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function createPlanFile(name: string, content: string): string {
  const plansDir = join(testDir, PLANS_DIR)
  mkdirSync(plansDir, { recursive: true })
  const filePath = join(plansDir, `${name}.md`)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

describe("checkContinuation", () => {
  it("returns null when no work state exists", () => {
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns null when plan is complete", () => {
    const planPath = createPlanFile("done", "# Done\n- [x] Task 1\n- [x] Task 2\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns null when plan file is missing", () => {
    // State references a non-existent plan file
    writeWorkState(testDir, createWorkState("/nonexistent/plan.md", "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns continuation prompt for incomplete plan", () => {
    const planPath = createPlanFile("my-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n- [ ] Todo 3\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain("my-plan")
    expect(result.continuationPrompt).toContain("1/3 tasks completed")
    expect(result.continuationPrompt).toContain("2 remaining")
    expect(result.continuationPrompt).toContain("todowrite")
    expect(result.continuationPrompt).toContain("sidebar")
  })

  it("includes plan file path in continuation prompt", () => {
    const planPath = createPlanFile("feature", "# Feature\n- [ ] Task\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toContain(planPath)
  })

  it("returns null when work state has paused: true", () => {
    const planPath = createPlanFile("paused-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n")
    const state = createWorkState(planPath, "sess_1")
    writeWorkState(testDir, { ...state, paused: true })

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns continuation prompt when paused is false", () => {
    const planPath = createPlanFile("active-plan", "# Plan\n- [x] Done 1\n- [ ] Todo 2\n")
    const state = createWorkState(planPath, "sess_1")
    writeWorkState(testDir, { ...state, paused: false })

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })

  it("returns continuation prompt when paused is absent (backward compat)", () => {
    const planPath = createPlanFile("legacy-plan", "# Plan\n- [ ] Todo 1\n")
    // Simulate a state.json written before the paused field existed
    const state = createWorkState(planPath, "sess_1")
    const legacyState = { ...state }
    // Ensure paused is undefined (absent from JSON)
    writeWorkState(testDir, legacyState)
    // Verify paused is not in the raw JSON
    const written = readWorkState(testDir)
    expect(written!.paused).toBeUndefined()

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
  })
})
