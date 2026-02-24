import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { checkContinuation } from "./work-continuation"
import { getAgentDisplayName } from "../shared/agent-display-names"
import { writeWorkState, createWorkState } from "../features/work-state/storage"
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

  it("returns review handoff when plan is complete", () => {
    const planPath = createPlanFile("done", "# Done\n- [x] Task 1\n- [x] Task 2\n")
    writeWorkState(testDir, createWorkState(planPath, "sess_1"))

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.targetAgent).toBe(getAgentDisplayName("loom"))
    expect(result.continuationPrompt).toContain("post-execution review")
    expect(result.continuationPrompt).toContain("Weft")
    expect(result.continuationPrompt).toContain("Warp")
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
    expect(result.targetAgent).toBeUndefined()
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
})
