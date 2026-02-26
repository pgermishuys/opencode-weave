/**
 * End-to-end workflow tests for the full Weave orchestration lifecycle.
 *
 * Exercises the complete pipeline:
 *   Pattern (plan) → /start-work → Tapestry (execute) → Idle/Resume → Weft (review)
 *
 * Uses real hook functions and real file I/O in isolated temp directories.
 * No mocking of internals.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { handleStartWork } from "./hooks/start-work-hook"
import { checkContinuation } from "./hooks/work-continuation"
import { checkPatternWrite } from "./hooks/pattern-md-only"
import { buildVerificationReminder } from "./hooks/verification-reminder"
import { createHooks } from "./hooks/create-hooks"

import {
  readWorkState,
  writeWorkState,
  createWorkState,
  appendSessionId,
  getPlanProgress,
} from "./features/work-state/storage"
import { PLANS_DIR } from "./features/work-state/constants"

import { createWeftAgent } from "./agents/weft"
import { createWarpAgent } from "./agents/warp"
import { createLoomAgent } from "./agents/loom"
import { createTapestryAgent } from "./agents/tapestry"
import { createToolPermissions } from "./tools/permissions"

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `weave-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a plan file in the test directory's .weave/plans/ folder. */
function createPlanFile(name: string, content: string): string {
  const plansDir = join(testDir, PLANS_DIR)
  mkdirSync(plansDir, { recursive: true })
  const filePath = join(plansDir, `${name}.md`)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

/** Build a /start-work prompt that contains the required <session-context> tag. */
function makeStartWorkPrompt(planName: string = ""): string {
  return `<command-instruction>Execute plan</command-instruction>
<session-context>Session ID: sess_test  Timestamp: 2026-01-01</session-context>
<user-request>${planName}</user-request>`
}

/** Build a structurally valid plan file content with the given checkbox lines in ## TODOs. */
function makeValidPlanContent(checkboxLines: string): string {
  return `## TL;DR\n> **Summary**: A test plan.\n> **Estimated Effort**: Quick\n\n## TODOs\n${checkboxLines}\n\n## Verification\n- [ ] All done\n`
}

/**
 * Mark the nth unchecked `- [ ]` task as complete in a plan file.
 * taskIndex is 0-based.
 */
function markTaskComplete(planPath: string, taskIndex: number): void {
  let content = readFileSync(planPath, "utf-8")
  let count = 0
  content = content.replace(/^([-*])\s*\[\s*\]/gm, (match, bullet) => {
    if (count === taskIndex) {
      count++
      return `${bullet} [x]`
    }
    count++
    return match
  })
  writeFileSync(planPath, content, "utf-8")
}

// ---------------------------------------------------------------------------
// Phase 1: Plan Creation → /start-work → Agent Switch
// ---------------------------------------------------------------------------

describe("Phase 1: Plan to Execution", () => {
  it("full flow: create plan → /start-work → switches to tapestry and creates state", () => {
    createPlanFile(
      "auth-feature",
      makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3"),
    )

    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })

    expect(result.switchAgent).toBe("tapestry")
    expect(result.contextInjection).toContain("Starting Plan: auth-feature")
    expect(result.contextInjection).toContain("0/4 tasks completed")

    const state = readWorkState(testDir)
    expect(state).not.toBeNull()
    expect(state!.plan_name).toBe("auth-feature")
    expect(state!.session_ids).toEqual(["sess_1"])
    expect(state!.agent).toBe("tapestry")
    expect(state!.active_plan).toContain("auth-feature.md")
  })

  it("explicit plan selection with multiple plans", () => {
    createPlanFile("plan-alpha", makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2"))
    createPlanFile("plan-beta", makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3"))

    const result = handleStartWork({
      promptText: makeStartWorkPrompt("plan-beta"),
      sessionId: "sess_1",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("Starting Plan: plan-beta")

    const state = readWorkState(testDir)
    expect(state!.plan_name).toBe("plan-beta")
    expect(state!.active_plan).not.toContain("alpha")
  })

  it("no plans → instructs to use Pattern agent", () => {
    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("No Plans Found")
    expect(result.contextInjection).toContain("Pattern")
    expect(result.switchAgent).toBe("tapestry")
    expect(readWorkState(testDir)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Phase 2: Work Progress Tracking
// ---------------------------------------------------------------------------

describe("Phase 2: Work Progress Tracking", () => {
  it("progress updates as checkboxes are marked complete", () => {
    const planPath = createPlanFile(
      "progress-plan",
      "# Plan\n- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4\n",
    )

    // Start: 0/4
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_1", directory: testDir })
    expect(getPlanProgress(planPath)).toMatchObject({ total: 4, completed: 0, isComplete: false })

    // Mark task 0
    markTaskComplete(planPath, 0)
    expect(getPlanProgress(planPath)).toMatchObject({ total: 4, completed: 1, isComplete: false })

    // Mark tasks 1 and 2
    markTaskComplete(planPath, 0) // now index 0 among remaining unchecked
    markTaskComplete(planPath, 0)
    expect(getPlanProgress(planPath)).toMatchObject({ total: 4, completed: 3, isComplete: false })

    // Mark final task
    markTaskComplete(planPath, 0)
    expect(getPlanProgress(planPath)).toMatchObject({ total: 4, completed: 4, isComplete: true })
  })

  it("verification reminder includes progress context and self-verification protocol", () => {
    const result = buildVerificationReminder({
      planName: "my-plan",
      progress: { total: 5, completed: 2 },
    })

    expect(result.verificationPrompt).not.toBeNull()
    expect(result.verificationPrompt).toContain("my-plan")
    expect(result.verificationPrompt).toContain("2/5")
    expect(result.verificationPrompt).toContain("VerificationProtocol")
    expect(result.verificationPrompt).toContain("Inspect Changes")
  })
})

// ---------------------------------------------------------------------------
// Phase 3: Session Idle → Work Continuation
// ---------------------------------------------------------------------------

describe("Phase 3: Session Idle and Continuation", () => {
  it("idle session with active incomplete plan gets continuation prompt", () => {
    const planPath = createPlanFile(
      "idle-plan",
      makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3"),
    )
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_1", directory: testDir })

    // Mark 1 complete
    markTaskComplete(planPath, 0)

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain("idle-plan")
    expect(result.continuationPrompt).toContain("1/4")
    expect(result.continuationPrompt).toContain("3 remaining")
  })

  it("idle session with complete plan gets no continuation", () => {
    const planPath = createPlanFile("done-plan", "# Done\n- [ ] Task 1\n- [ ] Task 2\n")
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_1", directory: testDir })

    markTaskComplete(planPath, 0)
    markTaskComplete(planPath, 0)

    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })

  it("idle session with no work state gets no continuation", () => {
    const result = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(result.continuationPrompt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Phase 4: Session Resume
// ---------------------------------------------------------------------------

describe("Phase 4: Session Resume", () => {
  it("new session resumes incomplete plan and appends session ID", () => {
    const planPath = createPlanFile(
      "resume-plan",
      makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3"),
    )
    // Start with original session
    handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_original",
      directory: testDir,
    })
    markTaskComplete(planPath, 0)

    // New session resumes
    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_new",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("Resuming Plan: resume-plan")
    expect(result.contextInjection).toContain("1/4 tasks completed")

    const state = readWorkState(testDir)
    expect(state!.session_ids).toContain("sess_original")
    expect(state!.session_ids).toContain("sess_new")
  })

  it("resume detects completed plan and discovers new incomplete plan", () => {
    const donePlan = createPlanFile("old-plan", "# Old\n- [x] Task 1\n- [x] Task 2\n")
    writeWorkState(testDir, createWorkState(donePlan, "sess_old", "tapestry"))

    // Ensure new plan has a different mtime
    createPlanFile("new-plan", makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3"))

    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_new",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("Starting Plan: new-plan")
    expect(result.contextInjection).not.toContain("old-plan")

    const state = readWorkState(testDir)
    expect(state!.plan_name).toBe("new-plan")
    expect(state!.session_ids).toContain("sess_new")
  })

  it("multiple sessions accumulate in session_ids via sequential resumes", () => {
    createPlanFile("multi-session", makeValidPlanContent("- [ ] T1\n- [ ] T2\n- [ ] T3\n- [ ] T4\n- [ ] T5"))

    // Start
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_1", directory: testDir })
    expect(readWorkState(testDir)!.session_ids).toEqual(["sess_1"])

    // Resume with sess_2
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_2", directory: testDir })
    expect(readWorkState(testDir)!.session_ids).toEqual(["sess_1", "sess_2"])

    // Resume with sess_3
    handleStartWork({ promptText: makeStartWorkPrompt(), sessionId: "sess_3", directory: testDir })
    expect(readWorkState(testDir)!.session_ids).toEqual(["sess_1", "sess_2", "sess_3"])

    // Resume with sess_2 again — no duplicate
    appendSessionId(testDir, "sess_2")
    expect(readWorkState(testDir)!.session_ids).toEqual(["sess_1", "sess_2", "sess_3"])
  })
})

// ---------------------------------------------------------------------------
// Phase 5: Plan Completion Detection
// ---------------------------------------------------------------------------

describe("Phase 5: Plan Completion", () => {
  it("all plans complete → reports all complete", () => {
    createPlanFile("feature-a", "# A\n- [x] Task 1\n- [x] Task 2\n")
    createPlanFile("feature-b", "# B\n- [x] Task 1\n")

    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("All Plans Complete")
    expect(readWorkState(testDir)).toBeNull()
  })

  it("completed active plan with new incomplete plan → auto-selects new plan", () => {
    const donePlan = createPlanFile("done", "# Done\n- [x] Task 1\n")
    writeWorkState(testDir, createWorkState(donePlan, "sess_old", "tapestry"))

    createPlanFile("todo", makeValidPlanContent("- [ ] Task 1"))

    const result = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })

    expect(result.contextInjection).toContain("Starting Plan: todo")

    const state = readWorkState(testDir)
    expect(state!.plan_name).toBe("todo")
  })
})

// ---------------------------------------------------------------------------
// Guard: Pattern MD-Only Write Restriction
// ---------------------------------------------------------------------------

describe("Guard: Pattern MD-Only Write Restriction", () => {
  it("pattern agent blocked from writing .ts source files", () => {
    const result = checkPatternWrite("pattern", "write", join(testDir, "src", "component.ts"))
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain(".weave/")
  })

  it("pattern agent allowed to write .md inside .weave/plans/", () => {
    const result = checkPatternWrite(
      "pattern",
      "write",
      join(testDir, ".weave", "plans", "my-plan.md"),
    )
    expect(result.allowed).toBe(true)
  })

  it("tapestry agent not restricted by pattern guard", () => {
    const result = checkPatternWrite("tapestry", "write", join(testDir, "src", "component.ts"))
    expect(result.allowed).toBe(true)
  })

  it("pattern blocked from writing .json inside .weave/", () => {
    const result = checkPatternWrite("pattern", "write", join(testDir, ".weave", "state.json"))
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain(".md")
  })
})

// ---------------------------------------------------------------------------
// Phase 6: Weft Review Gate
// ---------------------------------------------------------------------------

describe("Phase 6: Weft Review Gate", () => {
  it("Weft agent config enforces read-only access", () => {
    const config = createWeftAgent("test-model")

    expect(config.tools?.write).toBe(false)
    expect(config.tools?.edit).toBe(false)
    expect(config.tools?.task).toBe(false)
    expect(config.tools?.call_weave_agent).toBe(false)
    expect(config.temperature).toBe(0.1)
  })

  it("Weft agent prompt contains review guidelines", () => {
    const config = createWeftAgent("test-model")
    const prompt = config.prompt as string

    expect(prompt).toContain("blocking issues")
    expect(prompt).toContain("APPROVE")
    expect(prompt).toContain("REJECT")
    expect(prompt).toContain("Plan Review")
    expect(prompt).toContain("Work Review")
    // Approval bias
    expect(prompt).toContain("APPROVE by default")
  })

  it("tool permission system blocks Weft from writing", () => {
    const permissions = createToolPermissions({
      weft: { write: false, edit: false, task: false, call_weave_agent: false },
    })

    expect(permissions.isToolAllowed("weft", "write")).toBe(false)
    expect(permissions.isToolAllowed("weft", "edit")).toBe(false)
    expect(permissions.isToolAllowed("weft", "task")).toBe(false)
    expect(permissions.isToolAllowed("weft", "call_weave_agent")).toBe(false)
    // Read tools are not restricted → allowed
    expect(permissions.isToolAllowed("weft", "read")).toBe(true)
    expect(permissions.isToolAllowed("weft", "glob")).toBe(true)
    // Other agents unaffected
    expect(permissions.isToolAllowed("tapestry", "write")).toBe(true)
  })

  it("verification reminder generates correct self-verification prompt after plan completion", () => {
    const result = buildVerificationReminder({
      planName: "my-feature",
      progress: { total: 3, completed: 3 },
    })

    expect(result.verificationPrompt).not.toBeNull()
    expect(result.verificationPrompt).toContain("VerificationProtocol")
    expect(result.verificationPrompt).toContain("Edit/Write tool call history")
    expect(result.verificationPrompt).toContain("my-feature")
    expect(result.verificationPrompt).toContain("3/3")
  })

  it("verification reminder mid-progress includes self-verification steps", () => {
    const result = buildVerificationReminder({
      planName: "partial",
      progress: { total: 5, completed: 2 },
    })

    expect(result.verificationPrompt).toContain("VerificationProtocol")
    expect(result.verificationPrompt).toContain("Acceptance Criteria")
    expect(result.verificationPrompt).toContain("2/5")
  })
})

// ---------------------------------------------------------------------------
// Phase 7: Warp Security Gate
// ---------------------------------------------------------------------------

describe("Phase 7: Warp Security Gate", () => {
  it("Warp agent config enforces read-only access", () => {
    const config = createWarpAgent("test-model")

    expect(config.tools?.write).toBe(false)
    expect(config.tools?.edit).toBe(false)
    expect(config.tools?.task).toBe(false)
    expect(config.tools?.call_weave_agent).toBe(false)
    expect(config.temperature).toBe(0.1)
  })

  it("Warp agent prompt contains security audit guidelines", () => {
    const config = createWarpAgent("test-model")
    const prompt = config.prompt as string

    expect(prompt).toContain("blocking issues")
    expect(prompt).toContain("APPROVE")
    expect(prompt).toContain("REJECT")
    expect(prompt).toContain("SecurityReview")
    expect(prompt).toContain("SpecificationCompliance")
    // Skeptical bias (opposite of Weft)
    expect(prompt).toContain("REJECT by default")
  })

  it("Warp agent prompt contains spec reference table", () => {
    const config = createWarpAgent("test-model")
    const prompt = config.prompt as string

    expect(prompt).toContain("RFC 6749")
    expect(prompt).toContain("RFC 7636")
    expect(prompt).toContain("JWT")
    expect(prompt).toContain("OIDC")
    expect(prompt).toContain("WebAuthn")
  })

  it("tool permission system blocks Warp from writing", () => {
    const permissions = createToolPermissions({
      warp: { write: false, edit: false, task: false, call_weave_agent: false },
    })

    expect(permissions.isToolAllowed("warp", "write")).toBe(false)
    expect(permissions.isToolAllowed("warp", "edit")).toBe(false)
    expect(permissions.isToolAllowed("warp", "task")).toBe(false)
    expect(permissions.isToolAllowed("warp", "call_weave_agent")).toBe(false)
    // Read tools are not restricted
    expect(permissions.isToolAllowed("warp", "read")).toBe(true)
    expect(permissions.isToolAllowed("warp", "glob")).toBe(true)
  })

  it("verification reminder does not reference security flagging (removed from Tapestry)", () => {
    const result = buildVerificationReminder({
      planName: "auth-feature",
      progress: { total: 3, completed: 3 },
    })

    expect(result.verificationPrompt).not.toBeNull()
    expect(result.verificationPrompt).not.toContain("Security-Sensitive")
    expect(result.verificationPrompt).not.toContain("Warp")
  })

  it("verification reminder does not contain security trigger keywords (removed)", () => {
    const result = buildVerificationReminder({
      planName: "security-feature",
      progress: { total: 3, completed: 3 },
    })

    expect(result.verificationPrompt).not.toContain("Warp")
    expect(result.verificationPrompt).not.toContain("Security-Sensitive")
  })
})

// ---------------------------------------------------------------------------
// Integration: createHooks() wired workflow
// ---------------------------------------------------------------------------

describe("Integration: createHooks wired workflow", () => {
  it("startWork → workContinuation → full cycle through hooks object", () => {
    const hooks = createHooks({
      pluginConfig: {} as any,
      isHookEnabled: () => true,
      directory: testDir,
    })

    const planPath = createPlanFile("hooks-plan", makeValidPlanContent("- [ ] Task 1\n- [ ] Task 2"))

    // Start work
    const startResult = hooks.startWork!(makeStartWorkPrompt(), "sess_1")
    expect(startResult.switchAgent).toBe("tapestry")
    expect(startResult.contextInjection).toContain("Starting Plan")

    // Mark task 0 complete, check continuation
    markTaskComplete(planPath, 0)
    const cont1 = hooks.workContinuation!("sess_1")
    expect(cont1.continuationPrompt).not.toBeNull()
    expect(cont1.continuationPrompt).toContain("1/3")

    // Mark task 1 complete, then verification checkbox → done
    markTaskComplete(planPath, 0)
    markTaskComplete(planPath, 0)
    const cont2 = hooks.workContinuation!("sess_1")
    expect(cont2.continuationPrompt).toBeNull()
  })

  it("verificationReminder is wired and uses self-verification protocol", () => {
    const hooks = createHooks({
      pluginConfig: {} as any,
      isHookEnabled: () => true,
      directory: testDir,
    })

    const result = hooks.verificationReminder!({
      planName: "test-plan",
      progress: { total: 3, completed: 3 },
    })

    expect(result.verificationPrompt).not.toBeNull()
    expect(result.verificationPrompt).toContain("Edit/Write tool call history")
    expect(result.verificationPrompt).not.toContain("type/build check")
    expect(result.verificationPrompt).toContain("acceptance criteria")
    expect(result.verificationPrompt).toContain("test-plan")
    expect(result.verificationPrompt).not.toContain("call_weave_agent")
  })

  it("createHooks patternMdOnly guard is wired correctly", () => {
    const hooks = createHooks({
      pluginConfig: {} as any,
      isHookEnabled: () => true,
      directory: testDir,
    })

    const blocked = hooks.patternMdOnly!("pattern", "write", join(testDir, "src", "foo.ts"))
    expect(blocked.allowed).toBe(false)

    const allowed = hooks.patternMdOnly!("pattern", "write", join(testDir, ".weave", "plans", "plan.md"))
    expect(allowed.allowed).toBe(true)
  })

  it("disabled hooks return null via createHooks", () => {
    const disabledNames = new Set(["start-work", "work-continuation", "verification-reminder"])
    const hooks = createHooks({
      pluginConfig: {} as any,
      isHookEnabled: (name) => !disabledNames.has(name),
      directory: testDir,
    })

    expect(hooks.startWork).toBeNull()
    expect(hooks.workContinuation).toBeNull()
    expect(hooks.verificationReminder).toBeNull()
    // Others should still be active
    expect(hooks.patternMdOnly).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Full Lifecycle: Pattern → /start-work → Execute → Idle → Resume → Complete → Weft Review
// ---------------------------------------------------------------------------

describe("Full Lifecycle: Pattern → /start-work → Execute → Idle → Resume → Complete → Weft Review", () => {
  it("complete workflow lifecycle from plan creation through Weft review", () => {
    // 1. Pattern creates a plan
    const planPath = createPlanFile(
      "e2e-feature",
      makeValidPlanContent(
        "- [ ] Task 1: Create component\n- [ ] Task 2: Add tests\n- [ ] Task 3: Wire integration",
      ),
    )

    // 2. Pattern guard: allowed to write .md in .weave/
    const guardAllowed = checkPatternWrite("pattern", "write", planPath)
    expect(guardAllowed.allowed).toBe(true)

    // 3. Pattern guard: blocked from writing source code
    const guardBlocked = checkPatternWrite("pattern", "write", join(testDir, "src", "app.ts"))
    expect(guardBlocked.allowed).toBe(false)

    // 4. Session 1 starts work
    const startResult = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_1",
      directory: testDir,
    })
    expect(startResult.switchAgent).toBe("tapestry")
    expect(startResult.contextInjection).toContain("Starting Plan: e2e-feature")
    expect(startResult.contextInjection).toContain("0/4 tasks completed")

    // 5. Execute task 1
    markTaskComplete(planPath, 0)

    // 6. Progress check
    const progress1 = getPlanProgress(planPath)
    expect(progress1).toMatchObject({ total: 4, completed: 1, isComplete: false })

   // 7. Mid-progress verification reminder uses self-verification protocol
    const reminder1 = buildVerificationReminder({
      planName: "e2e-feature",
      progress: { total: 4, completed: 1 },
    })
    expect(reminder1.verificationPrompt).toContain("Edit/Write tool call history")
    expect(reminder1.verificationPrompt).not.toContain("type/build check")

    // 8. Session goes idle → continuation prompt
    const cont1 = checkContinuation({ sessionId: "sess_1", directory: testDir })
    expect(cont1.continuationPrompt).not.toBeNull()
    expect(cont1.continuationPrompt).toContain("1/4")
    expect(cont1.continuationPrompt).toContain("3 remaining")

    // 9. Execute task 2
    markTaskComplete(planPath, 0)

    // 10. Session 2 resumes
    const resumeResult = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_2",
      directory: testDir,
    })
    expect(resumeResult.contextInjection).toContain("Resuming Plan: e2e-feature")
    expect(resumeResult.contextInjection).toContain("2/4 tasks completed")

    // 11. Session IDs accumulated
    const stateAfterResume = readWorkState(testDir)
    expect(stateAfterResume!.session_ids).toContain("sess_1")
    expect(stateAfterResume!.session_ids).toContain("sess_2")

    // 12. Execute task 3 and verification checkbox
    markTaskComplete(planPath, 0)
    markTaskComplete(planPath, 0)

    // 13. Plan complete
    const progress2 = getPlanProgress(planPath)
    expect(progress2).toMatchObject({ total: 4, completed: 4, isComplete: true })

    // 14. Completed plan returns null continuation (no review handoff)
    const cont2 = checkContinuation({ sessionId: "sess_2", directory: testDir })
    expect(cont2.continuationPrompt).toBeNull()

    // 15. Verification reminder at completion uses self-verification protocol
    const reminder2 = buildVerificationReminder({
      planName: "e2e-feature",
      progress: { total: 4, completed: 4 },
    })
    expect(reminder2.verificationPrompt).not.toContain("call_weave_agent")
    expect(reminder2.verificationPrompt).toContain("Edit/Write tool call history")
    expect(reminder2.verificationPrompt).not.toContain("type/build check")
    expect(reminder2.verificationPrompt).toContain("acceptance criteria")
    expect(reminder2.verificationPrompt).toContain("e2e-feature")
    expect(reminder2.verificationPrompt).toContain("4/4")

    // 16. Weft agent is read-only
    const weftConfig = createWeftAgent("test-model")
    expect(weftConfig.tools?.write).toBe(false)
    expect(weftConfig.tools?.edit).toBe(false)

    // 17. Weft prompt enforces review protocol
    const weftPrompt = weftConfig.prompt as string
    expect(weftPrompt).toContain("[APPROVE]")
    expect(weftPrompt).toContain("[REJECT]")
    expect(weftPrompt).toContain("blocking issues")

    // 18. Subsequent /start-work with no new plans → all complete
    const finalResult = handleStartWork({
      promptText: makeStartWorkPrompt(),
      sessionId: "sess_3",
      directory: testDir,
    })
    expect(finalResult.contextInjection).toContain("All Plans Complete")

    // 19. Loom's PlanWorkflow does NOT mandate post-execution review (removed)
    const loomConfig = createLoomAgent("claude-opus-4")
    const loomPrompt = loomConfig.prompt as string
    const planWorkflow = loomPrompt.slice(
      loomPrompt.indexOf("<PlanWorkflow>"),
      loomPrompt.indexOf("</PlanWorkflow>"),
    )
    expect(planWorkflow).not.toContain("5. POST-EXECUTION REVIEW")
    expect(planWorkflow).not.toContain("NO SKIP CONDITIONS")

    // 20. Tapestry's completion step does NOT mandate review
    const tapestryConfig = createTapestryAgent("claude-sonnet-4")
    const tapestryPrompt = tapestryConfig.prompt as string
    expect(tapestryPrompt).not.toContain("Post-execution review required")

    // 21. Warp self-triages — always safe to invoke
    const warpConfig = createWarpAgent("test-model")
    const warpPrompt = warpConfig.prompt as string
    expect(warpPrompt).toContain("<Triage>")
    expect(warpPrompt).toContain("FAST EXIT")
  })
})
