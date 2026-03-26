import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { handleStartWork, formatValidationResults } from "./start-work-hook"
import { PLANS_DIR } from "../features/work-state/constants"
import { writeWorkState, createWorkState, readWorkState } from "../features/work-state/storage"
import {
  createWorkflowInstance,
  writeWorkflowInstance,
  setActiveInstance,
} from "../features/workflow/storage"
import { WORKFLOWS_STATE_DIR, WORKFLOWS_DIR_PROJECT } from "../features/workflow/constants"
import type { WorkflowDefinition } from "../features/workflow/types"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-sw-test-"))
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

    it("does not include Start SHA for non-git directory", () => {
      createPlanFile(
        "no-git-plan",
        validPlanContent(
          "- [ ] 1. Task 1\n  **What**: Do it\n  **Files**: src/new.ts (new)\n  **Acceptance**: Works"
        )
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      expect(result.contextInjection).toContain("Starting Plan: no-git-plan")
      expect(result.contextInjection).not.toContain("Start SHA")

      const state = readWorkState(testDir)
      expect(state!.start_sha).toBeUndefined()
    })

    it("proceeds with warnings when plan is missing ## TODOs section but has checkboxes elsewhere", () => {
      createPlanFile(
        "bad-plan",
        "## TL;DR\n> **Summary**: Incomplete.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )

      const result = handleStartWork({
        promptText: makePrompt(),
        sessionId: "sess_1",
        directory: testDir,
      })

      // Missing ## TODOs is a warning, not an error — plan proceeds
      expect(result.contextInjection).toContain("Starting Plan: bad-plan")
      expect(result.contextInjection).toContain("Validation Warnings")
      expect(result.contextInjection).toContain("TODOs")
      expect(result.switchAgent).toBe("tapestry")

      // Work state IS created since validation passes
      expect(readWorkState(testDir)).not.toBeNull()
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

    it("proceeds with warnings for explicitly named plan missing ## TODOs", () => {
      createPlanFile(
        "broken",
        "## TL;DR\n> **Summary**: Broken.\n> **Estimated Effort**: Quick\n\n## Verification\n- [ ] Done\n"
      )

      const result = handleStartWork({
        promptText: makePrompt("broken"),
        sessionId: "sess_1",
        directory: testDir,
      })

      // Missing ## TODOs is a warning, not an error — plan proceeds
      expect(result.contextInjection).toContain("Starting Plan: broken")
      expect(result.contextInjection).toContain("Validation Warnings")
      expect(result.contextInjection).toContain("TODOs")
      // Work state IS created
      expect(readWorkState(testDir)).not.toBeNull()
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

    it("resumes plan with warnings when plan is missing ## TODOs but has checkboxes", () => {
      // Create a plan missing ## TODOs but with raw checkboxes
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

      // Missing ## TODOs is a warning, not an error — plan resumes
      expect(result.contextInjection).toContain("Resuming Plan: corrupt-plan2")
      expect(result.contextInjection).toContain("Validation Warnings")
      expect(result.switchAgent).toBe("tapestry")
      // Work state should still exist
      expect(readWorkState(testDir)).not.toBeNull()
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

const THREE_STEP_DEF: WorkflowDefinition = {
  name: "test-workflow",
  description: "A test workflow",
  version: 1,
  steps: [
    {
      id: "step-1",
      name: "Step One",
      type: "interactive",
      agent: "loom",
      prompt: "Do step 1: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
    {
      id: "step-2",
      name: "Step Two",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Do step 2: {{instance.goal}}",
      completion: { method: "agent_signal" },
    },
    {
      id: "step-3",
      name: "Step Three",
      type: "interactive",
      agent: "loom",
      prompt: "Do step 3: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
  ],
}

function writeWorkflowDefFile(dir: string, def: WorkflowDefinition = THREE_STEP_DEF): string {
  const defDir = join(dir, WORKFLOWS_DIR_PROJECT)
  mkdirSync(defDir, { recursive: true })
  const defPath = join(defDir, `${def.name}.json`)
  writeFileSync(defPath, JSON.stringify(def))
  return defPath
}

function setupRunningWorkflow(dir: string, opts?: { paused?: boolean; completedSteps?: number }) {
  const defPath = writeWorkflowDefFile(dir)
  mkdirSync(join(dir, WORKFLOWS_STATE_DIR), { recursive: true })
  const instance = createWorkflowInstance(THREE_STEP_DEF, defPath, "Build OAuth2 login", "sess-1")

  const completedCount = opts?.completedSteps ?? 0
  const stepIds = THREE_STEP_DEF.steps.map((s) => s.id)
  for (let i = 0; i < completedCount && i < stepIds.length; i++) {
    instance.steps[stepIds[i]].status = "completed"
    instance.steps[stepIds[i]].started_at = new Date().toISOString()
  }
  if (completedCount < stepIds.length) {
    instance.current_step_id = stepIds[completedCount]
    instance.steps[stepIds[completedCount]].status = "active"
    instance.steps[stepIds[completedCount]].started_at = new Date().toISOString()
  }

  if (opts?.paused) {
    instance.status = "paused"
  }

  writeWorkflowInstance(dir, instance)
  setActiveInstance(dir, instance.instance_id)
  return instance
}

describe("handleStartWork with active workflow", () => {
  it("shows warning when workflow is running", () => {
    const instance = setupRunningWorkflow(testDir)

    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Active Workflow Detected")
    expect(result.contextInjection).toContain("test-workflow")
    expect(result.contextInjection).toContain(instance.instance_id)
    expect(result.contextInjection).toContain("Build OAuth2 login")
    expect(result.contextInjection).toContain("Proceed anyway")
    expect(result.contextInjection).toContain("Abort the workflow first")
    expect(result.contextInjection).toContain("Cancel")
  })

  it("shows warning when workflow is paused", () => {
    setupRunningWorkflow(testDir, { paused: true })

    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Active Workflow Detected")
    expect(result.contextInjection).toContain("paused")
  })

  it("no warning when no workflow is active", () => {
    // Just create a plan, no workflow
    createPlanFile(
      "my-plan",
      validPlanContent("- [ ] 1. Task\n  **What**: Do it\n  **Files**: src/a.ts (new)\n  **Acceptance**: Works")
    )

    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).not.toContain("Active Workflow Detected")
  })

  it("warning includes progress", () => {
    setupRunningWorkflow(testDir, { completedSteps: 1 })

    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("1/3")
  })

  it("switchAgent is null for the warning", () => {
    setupRunningWorkflow(testDir)

    const result = handleStartWork({
      promptText: makePrompt(),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.switchAgent).toBeNull()
  })
})
