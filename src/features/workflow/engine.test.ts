import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { startWorkflow, checkAndAdvance, pauseWorkflow, resumeWorkflow, skipStep, abortWorkflow } from "./engine"
import { readWorkflowInstance, readActiveInstance, getActiveWorkflowInstance, setActiveInstance, writeWorkflowInstance, createWorkflowInstance } from "./storage"
import { WORKFLOWS_STATE_DIR, ACTIVE_INSTANCE_FILE } from "./constants"
import type { WorkflowDefinition, WorkflowInstance } from "./types"
import type { CompletionContext } from "./completion"

let testDir: string

/** A minimal 2-step workflow definition used across tests. */
const TWO_STEP_DEF: WorkflowDefinition = {
  name: "test-workflow",
  description: "A test workflow",
  version: 1,
  steps: [
    {
      id: "gather",
      name: "Gather Requirements",
      type: "interactive",
      agent: "loom",
      prompt: "Gather info for: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
    {
      id: "build",
      name: "Build Feature",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Build: {{instance.goal}}",
      completion: { method: "agent_signal" },
    },
  ],
}

/** A 3-step workflow with a gate step. */
const THREE_STEP_GATE_DEF: WorkflowDefinition = {
  name: "gate-workflow",
  description: "Workflow with a gate step",
  version: 1,
  steps: [
    {
      id: "plan",
      name: "Create Plan",
      type: "autonomous",
      agent: "pattern",
      prompt: "Create a plan for: {{instance.goal}}",
      completion: { method: "agent_signal" },
    },
    {
      id: "review",
      name: "Review Plan",
      type: "gate",
      agent: "weft",
      prompt: "Review the plan.",
      completion: { method: "review_verdict" },
      on_reject: "pause",
    },
    {
      id: "execute",
      name: "Execute Plan",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Execute the plan.",
      completion: { method: "agent_signal" },
    },
  ],
}

/** A 2-step workflow where gate on_reject = "fail". */
const GATE_FAIL_DEF: WorkflowDefinition = {
  name: "gate-fail-workflow",
  description: "Gate rejects with fail",
  version: 1,
  steps: [
    {
      id: "review",
      name: "Review",
      type: "gate",
      agent: "weft",
      prompt: "Review.",
      completion: { method: "review_verdict" },
      on_reject: "fail",
    },
    {
      id: "execute",
      name: "Execute",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Execute.",
      completion: { method: "agent_signal" },
    },
  ],
}

/** Write a workflow definition to a temp path and return the path. */
function writeDefinitionFile(def: WorkflowDefinition): string {
  const defPath = join(testDir, `${def.name}.jsonc`)
  writeFileSync(defPath, JSON.stringify(def, null, 2), "utf-8")
  return defPath
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-engine-test-"))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on Windows
  }
})

// ─── startWorkflow ──────────────────────────────────────────────────────────

describe("startWorkflow", () => {
  it("creates an instance and sets it as active", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    const action = startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Add OAuth2 login",
      sessionId: "sess_001",
      directory: testDir,
    })

    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("loom")
    expect(action.prompt).toBeDefined()
    expect(action.prompt).toContain("Add OAuth2 login")

    // Instance should exist on disk
    const pointer = readActiveInstance(testDir)
    expect(pointer).not.toBeNull()

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.goal).toBe("Add OAuth2 login")
    expect(instance!.status).toBe("running")
    expect(instance!.current_step_id).toBe("gather")
    expect(instance!.steps["gather"].status).toBe("active")
    expect(instance!.steps["build"].status).toBe("pending")
  })

  it("returns context-threaded prompt for first step", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    const action = startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Build search feature",
      sessionId: "sess_002",
      directory: testDir,
    })

    expect(action.prompt).toContain("Workflow Context")
    expect(action.prompt).toContain("Build search feature")
    expect(action.prompt).toContain("Gather info for: Build search feature")
  })

  it("sets the first step agent in the action", () => {
    const defPath = writeDefinitionFile(THREE_STEP_GATE_DEF)
    const action = startWorkflow({
      definition: THREE_STEP_GATE_DEF,
      definitionPath: defPath,
      goal: "Add feature X",
      sessionId: "sess_003",
      directory: testDir,
    })

    expect(action.agent).toBe("pattern")
  })

  it("stores session ID in instance", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Test session tracking",
      sessionId: "sess_track_001",
      directory: testDir,
    })

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.session_ids).toContain("sess_track_001")
  })
})

// ─── checkAndAdvance ────────────────────────────────────────────────────────

describe("checkAndAdvance", () => {
  it("returns none when no active instance", () => {
    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
      },
    })
    expect(action.type).toBe("none")
  })

  it("returns none when instance is not running", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Paused workflow",
      sessionId: "sess_p",
      directory: testDir,
    })
    pauseWorkflow(testDir, "Testing")

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
      },
    })
    expect(action.type).toBe("none")
  })

  it("returns none when step completion is not met", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Incomplete test",
      sessionId: "sess_inc",
      directory: testDir,
    })

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "tell me more about X",
      },
    })
    expect(action.type).toBe("none")
  })

  it("advances to next step when completion is met", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Advance test",
      sessionId: "sess_adv",
      directory: testDir,
    })

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })

    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("tapestry")
    expect(action.prompt).toContain("Advance test")

    // Verify instance state
    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("build")
    expect(instance!.steps["gather"].status).toBe("completed")
    expect(instance!.steps["build"].status).toBe("active")
  })

  it("completes the workflow when last step finishes", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Complete workflow test",
      sessionId: "sess_comp",
      directory: testDir,
    })

    // Advance past step 1
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })

    // Now complete step 2 with agent_signal
    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "Done! <!-- workflow:step-complete -->",
      },
    })

    expect(action.type).toBe("complete")
    expect(action.reason).toContain("all steps done")

    // Active pointer should be cleared
    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()

    // Instance should be readable by ID and show completed
    // We need to find the instance ID — list the directories
    const instance = (() => {
      const dir = join(testDir, WORKFLOWS_STATE_DIR)
      const entries = require("fs").readdirSync(dir, { withFileTypes: true })
      const instanceDir = entries.find((e: any) => e.isDirectory() && e.name.startsWith("wf_"))
      if (!instanceDir) return null
      return readWorkflowInstance(testDir, instanceDir.name)
    })()

    expect(instance).not.toBeNull()
    expect(instance!.status).toBe("completed")
    expect(instance!.ended_at).toBeDefined()
    expect(instance!.steps["gather"].status).toBe("completed")
    expect(instance!.steps["build"].status).toBe("completed")
  })

  it("captures completion summary and artifacts on advance", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Artifact capture test",
      sessionId: "sess_art",
      directory: testDir,
    })

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "Looks good, confirmed",
      },
    })

    expect(action.type).toBe("inject_prompt")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.steps["gather"].summary).toBeDefined()
    expect(instance!.steps["gather"].completed_at).toBeDefined()
  })

  it("returns none when definition cannot be loaded", () => {
    // Create an instance manually with a bad definition path
    const instance = createWorkflowInstance(TWO_STEP_DEF, "/nonexistent/def.jsonc", "Bad def", "sess_bad")
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })

    expect(action.type).toBe("none")
  })
})

// ─── Gate step handling ─────────────────────────────────────────────────────

describe("gate step handling", () => {
  it("pauses workflow on gate rejection with on_reject=pause", () => {
    const defPath = writeDefinitionFile(THREE_STEP_GATE_DEF)
    startWorkflow({
      definition: THREE_STEP_GATE_DEF,
      definitionPath: defPath,
      goal: "Gate pause test",
      sessionId: "sess_gate_p",
      directory: testDir,
    })

    // Complete step 1 (agent_signal)
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "<!-- workflow:step-complete -->",
      },
    })

    // Step 2 is gate with review_verdict — send REJECT
    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "Issues found. [REJECT]",
      },
    })

    expect(action.type).toBe("pause")
    expect(action.reason).toContain("rejected")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.status).toBe("paused")
    expect(instance!.steps["review"].verdict).toBe("reject")
  })

  it("fails workflow on gate rejection with on_reject=fail", () => {
    const defPath = writeDefinitionFile(GATE_FAIL_DEF)
    startWorkflow({
      definition: GATE_FAIL_DEF,
      definitionPath: defPath,
      goal: "Gate fail test",
      sessionId: "sess_gate_f",
      directory: testDir,
    })

    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "[REJECT] — critical issues",
      },
    })

    expect(action.type).toBe("pause")
    expect(action.reason).toContain("failed")

    // Active pointer should be cleared on failure
    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()
  })

  it("advances past gate step on APPROVE", () => {
    const defPath = writeDefinitionFile(THREE_STEP_GATE_DEF)
    startWorkflow({
      definition: THREE_STEP_GATE_DEF,
      definitionPath: defPath,
      goal: "Gate approve test",
      sessionId: "sess_gate_a",
      directory: testDir,
    })

    // Complete step 1
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "<!-- workflow:step-complete -->",
      },
    })

    // Step 2 gate — APPROVE
    const action = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "All good. [APPROVE]",
      },
    })

    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("tapestry")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("execute")
    expect(instance!.steps["review"].status).toBe("completed")
    expect(instance!.steps["review"].verdict).toBe("approve")
  })
})

// ─── pauseWorkflow ──────────────────────────────────────────────────────────

describe("pauseWorkflow", () => {
  it("pauses a running workflow", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Pause test",
      sessionId: "sess_pause",
      directory: testDir,
    })

    const result = pauseWorkflow(testDir, "User requested pause")
    expect(result).toBe(true)

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.status).toBe("paused")
    expect(instance!.pause_reason).toBe("User requested pause")
  })

  it("uses default reason when none provided", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Default pause test",
      sessionId: "sess_dp",
      directory: testDir,
    })

    pauseWorkflow(testDir)

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.pause_reason).toBe("Paused by user")
  })

  it("returns false when no active workflow", () => {
    const result = pauseWorkflow(testDir)
    expect(result).toBe(false)
  })

  it("returns false when workflow is not running", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Double pause test",
      sessionId: "sess_pp",
      directory: testDir,
    })

    pauseWorkflow(testDir)
    const result = pauseWorkflow(testDir)
    expect(result).toBe(false)
  })
})

// ─── resumeWorkflow ─────────────────────────────────────────────────────────

describe("resumeWorkflow", () => {
  it("resumes a paused workflow and returns context-threaded prompt", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Resume test",
      sessionId: "sess_resume",
      directory: testDir,
    })

    pauseWorkflow(testDir, "Testing")

    const action = resumeWorkflow(testDir)
    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("loom")
    expect(action.prompt).toContain("Resume test")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.status).toBe("running")
    expect(instance!.pause_reason).toBeUndefined()
  })

  it("returns none when no paused workflow", () => {
    const action = resumeWorkflow(testDir)
    expect(action.type).toBe("none")
    expect(action.reason).toContain("No paused workflow")
  })

  it("returns none when workflow is running (not paused)", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Running resume test",
      sessionId: "sess_rr",
      directory: testDir,
    })

    const action = resumeWorkflow(testDir)
    expect(action.type).toBe("none")
  })

  it("resumes at correct step after mid-workflow pause", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Mid-workflow resume test",
      sessionId: "sess_mwr",
      directory: testDir,
    })

    // Advance to step 2
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })

    pauseWorkflow(testDir)

    const action = resumeWorkflow(testDir)
    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("tapestry")
    expect(action.prompt).toContain("Mid-workflow resume test")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("build")
  })

  it("returns none when definition file is missing on resume", () => {
    const defPath = join(testDir, "missing-def.jsonc")
    // Create instance manually pointing to non-existent definition
    const instance = createWorkflowInstance(TWO_STEP_DEF, defPath, "Missing def", "sess_md")
    instance.status = "paused"
    instance.pause_reason = "test"
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)

    const action = resumeWorkflow(testDir)
    expect(action.type).toBe("none")
    expect(action.reason).toContain("Failed to load")
  })
})

// ─── skipStep ───────────────────────────────────────────────────────────────

describe("skipStep", () => {
  it("skips the current step and advances to next", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Skip test",
      sessionId: "sess_skip",
      directory: testDir,
    })

    const action = skipStep(testDir)
    expect(action.type).toBe("inject_prompt")
    expect(action.agent).toBe("tapestry")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("build")
    expect(instance!.steps["gather"].status).toBe("completed")
    expect(instance!.steps["gather"].summary).toBe("Step skipped by user")
  })

  it("completes workflow when skipping the last step", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Skip last step test",
      sessionId: "sess_sl",
      directory: testDir,
    })

    skipStep(testDir) // skip step 1 → now on step 2
    const action = skipStep(testDir) // skip step 2 → workflow complete

    expect(action.type).toBe("complete")
    expect(action.reason).toContain("all steps done")

    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()
  })

  it("returns none when no active workflow", () => {
    const action = skipStep(testDir)
    expect(action.type).toBe("none")
  })

  it("returns none when definition cannot be loaded", () => {
    const instance = createWorkflowInstance(TWO_STEP_DEF, "/nonexistent/def.jsonc", "Bad def", "sess_bd")
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)

    const action = skipStep(testDir)
    expect(action.type).toBe("none")
  })
})

// ─── abortWorkflow ──────────────────────────────────────────────────────────

describe("abortWorkflow", () => {
  it("cancels the active workflow and clears active pointer", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Abort test",
      sessionId: "sess_abort",
      directory: testDir,
    })

    const result = abortWorkflow(testDir)
    expect(result).toBe(true)

    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()
  })

  it("sets instance status to cancelled with ended_at", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Abort status test",
      sessionId: "sess_as",
      directory: testDir,
    })

    // Get instance ID before abort (since pointer will be cleared)
    const preAbortInstance = getActiveWorkflowInstance(testDir)
    const instanceId = preAbortInstance!.instance_id

    abortWorkflow(testDir)

    const instance = readWorkflowInstance(testDir, instanceId)
    expect(instance!.status).toBe("cancelled")
    expect(instance!.ended_at).toBeDefined()
  })

  it("returns false when no active workflow", () => {
    const result = abortWorkflow(testDir)
    expect(result).toBe(false)
  })

  it("can abort a paused workflow", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Abort paused test",
      sessionId: "sess_ap",
      directory: testDir,
    })

    pauseWorkflow(testDir)

    const result = abortWorkflow(testDir)
    expect(result).toBe(true)

    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()
  })
})

// ─── Full lifecycle ─────────────────────────────────────────────────────────

describe("full lifecycle", () => {
  it("runs a 3-step workflow through completion with context threading", () => {
    const defPath = writeDefinitionFile(THREE_STEP_GATE_DEF)
    const action1 = startWorkflow({
      definition: THREE_STEP_GATE_DEF,
      definitionPath: defPath,
      goal: "Full lifecycle test",
      sessionId: "sess_full",
      directory: testDir,
    })

    // Step 1: autonomous (agent_signal)
    expect(action1.type).toBe("inject_prompt")
    expect(action1.agent).toBe("pattern")

    const action2 = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "Plan done. <!-- workflow:step-complete -->",
      },
    })

    // Step 2: gate (review_verdict) — APPROVE
    expect(action2.type).toBe("inject_prompt")
    expect(action2.agent).toBe("weft")
    expect(action2.prompt).toContain("Completed Steps")

    const action3 = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "Everything looks good. [APPROVE]",
      },
    })

    // Step 3: autonomous (agent_signal)
    expect(action3.type).toBe("inject_prompt")
    expect(action3.agent).toBe("tapestry")
    expect(action3.prompt).toContain("Completed Steps")

    const action4 = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "All done. <!-- workflow:step-complete -->",
      },
    })

    expect(action4.type).toBe("complete")

    const pointer = readActiveInstance(testDir)
    expect(pointer).toBeNull()
  })

  it("handles pause-resume-complete lifecycle", () => {
    const defPath = writeDefinitionFile(TWO_STEP_DEF)
    startWorkflow({
      definition: TWO_STEP_DEF,
      definitionPath: defPath,
      goal: "Pause-resume lifecycle",
      sessionId: "sess_prl",
      directory: testDir,
    })

    // Pause
    const paused = pauseWorkflow(testDir, "User busy")
    expect(paused).toBe(true)

    // checkAndAdvance should return none while paused
    const noOp = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })
    expect(noOp.type).toBe("none")

    // Resume
    const resumed = resumeWorkflow(testDir)
    expect(resumed.type).toBe("inject_prompt")

    // Now advance
    const advanced = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })
    expect(advanced.type).toBe("inject_prompt")
    expect(advanced.agent).toBe("tapestry")
  })
})
