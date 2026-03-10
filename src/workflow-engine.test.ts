/**
 * End-to-end integration test for the workflow engine.
 * Exercises the full workflow instance lifecycle with real file I/O.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  WORKFLOWS_STATE_DIR,
  WORKFLOWS_DIR_PROJECT,
  getActiveWorkflowInstance,
  startWorkflow,
  checkAndAdvance,
  pauseWorkflow,
  resumeWorkflow,
  skipStep,
  abortWorkflow,
  discoverWorkflows,
} from "./features/workflow"
import type { CompletionContext, WorkflowDefinition } from "./features/workflow"
import {
  parseWorkflowArgs,
  handleRunWorkflow,
  checkWorkflowContinuation,
  WORKFLOW_CONTINUATION_MARKER,
} from "./features/workflow/hook"
import { handleWorkflowCommand } from "./features/workflow/commands"
import {
  createWorkflowInstance,
  writeWorkflowInstance,
  setActiveInstance,
  readWorkflowInstance,
  listInstances,
} from "./features/workflow/storage"

let testDir: string

/** A full 4-step workflow definition mimicking a real secure-feature workflow. */
const SECURE_FEATURE_DEF: WorkflowDefinition = {
  name: "secure-feature",
  description: "Plan, review, build, and verify a secure feature",
  version: 1,
  steps: [
    {
      id: "gather",
      name: "Gather Requirements",
      type: "interactive",
      agent: "loom",
      prompt: "Gather requirements for: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
    {
      id: "plan",
      name: "Create Plan",
      type: "autonomous",
      agent: "pattern",
      prompt: "Create a plan for: {{instance.goal}}\nBased on: {{artifacts.requirements}}",
      completion: { method: "agent_signal" },
    },
    {
      id: "review",
      name: "Plan Review",
      type: "gate",
      agent: "weft",
      prompt: "Review the plan for: {{instance.goal}}",
      completion: { method: "review_verdict" },
      on_reject: "pause",
    },
    {
      id: "build",
      name: "Build Feature",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Build the feature: {{instance.goal}}",
      completion: { method: "agent_signal" },
    },
  ],
}

function writeDefinitionFile(dir: string, def: WorkflowDefinition = SECURE_FEATURE_DEF): string {
  const defDir = join(dir, WORKFLOWS_DIR_PROJECT)
  mkdirSync(defDir, { recursive: true })
  const defPath = join(defDir, `${def.name}.json`)
  writeFileSync(defPath, JSON.stringify(def))
  return defPath
}

function makePromptText(args: string): string {
  return `<session-context>
Session ID: sess-e2e
</session-context>

<command-instructions>
The workflow engine will inject context here.
</command-instructions>

<user-request>
${args}
</user-request>`
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "wf-e2e-"))
  mkdirSync(join(testDir, WORKFLOWS_STATE_DIR), { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("Workflow Engine E2E: Full lifecycle", () => {
  it("runs a complete 4-step workflow from start to finish", () => {
    const defPath = writeDefinitionFile(testDir)

    // ── Step 1: Start the workflow ──
    const startAction = startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Add OAuth2 login with Google and GitHub providers",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    expect(startAction.type).toBe("inject_prompt")
    expect(startAction.agent).toBe("loom")
    expect(startAction.prompt).toContain("Add OAuth2 login with Google and GitHub providers")

    let instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.status).toBe("running")
    expect(instance!.current_step_id).toBe("gather")
    expect(instance!.goal).toBe("Add OAuth2 login with Google and GitHub providers")
    expect(instance!.steps.gather.status).toBe("active")

    // ── Step 2: Complete interactive step via user confirmation ──
    const gatherComplete = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "Looks good, let's proceed",
      },
    })

    expect(gatherComplete.type).toBe("inject_prompt")
    expect(gatherComplete.agent).toBe("pattern")

    instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("plan")
    expect(instance!.steps.gather.status).toBe("completed")
    expect(instance!.steps.plan.status).toBe("active")

    // ── Step 3: Complete autonomous step via agent signal ──
    const planComplete = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "Plan created successfully. <!-- workflow:step-complete -->",
      },
    })

    expect(planComplete.type).toBe("inject_prompt")
    expect(planComplete.agent).toBe("weft")

    instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("review")
    expect(instance!.steps.plan.status).toBe("completed")
    expect(instance!.steps.review.status).toBe("active")

    // ── Step 4: Complete gate step with APPROVE ──
    const reviewComplete = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "Code quality looks excellent. [APPROVE]",
      },
    })

    expect(reviewComplete.type).toBe("inject_prompt")
    expect(reviewComplete.agent).toBe("tapestry")

    instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("build")
    expect(instance!.steps.review.status).toBe("completed")
    expect(instance!.steps.review.verdict).toBe("approve")

    // ── Step 5: Complete last step → workflow completes ──
    const buildComplete = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "Feature built and tested. <!-- workflow:step-complete -->",
      },
    })

    expect(buildComplete.type).toBe("complete")

    instance = getActiveWorkflowInstance(testDir)
    expect(instance).toBeNull() // Active pointer cleared

    // But the instance itself should still exist on disk
    const instances = listInstances(testDir)
    expect(instances.length).toBe(1)
    const finishedInstance = readWorkflowInstance(testDir, instances[0])
    expect(finishedInstance!.status).toBe("completed")
    expect(finishedInstance!.ended_at).toBeTruthy()
  })

  it("handles gate step REJECT with pause", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Add feature X",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    // Advance past gather
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "approved",
      },
    })

    // Advance past plan
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "<!-- workflow:step-complete -->",
      },
    })

    // Gate step REJECT
    const reviewResult = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "review_verdict" },
        artifacts: {},
        lastAssistantMessage: "Critical issues found. [REJECT]",
      },
    })

    expect(reviewResult.type).toBe("pause")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.status).toBe("paused")
    expect(instance!.steps.review.verdict).toBe("reject")
  })
})

describe("Workflow Engine E2E: Pause/resume", () => {
  it("pauses and resumes a workflow preserving state", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Add OAuth2",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    // Advance past gather
    checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "user_confirm" },
        artifacts: {},
        lastUserMessage: "confirmed",
      },
    })

    // Pause
    expect(pauseWorkflow(testDir, "User requested")).toBe(true)
    let instance = getActiveWorkflowInstance(testDir)
    expect(instance!.status).toBe("paused")
    expect(instance!.current_step_id).toBe("plan")

    // Resume
    const resumeAction = resumeWorkflow(testDir)
    expect(resumeAction.type).toBe("inject_prompt")
    expect(resumeAction.agent).toBe("pattern")

    instance = getActiveWorkflowInstance(testDir)
    expect(instance!.status).toBe("running")
    expect(instance!.current_step_id).toBe("plan")
  })
})

describe("Workflow Engine E2E: Skip step", () => {
  it("skips current step and advances to next", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Skip test",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    const skipAction = skipStep(testDir)
    expect(skipAction.type).toBe("inject_prompt")
    expect(skipAction.agent).toBe("pattern")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance!.current_step_id).toBe("plan")
    expect(instance!.steps.gather.status).toBe("completed")
    expect(instance!.steps.gather.summary).toContain("skipped")
  })
})

describe("Workflow Engine E2E: Abort", () => {
  it("aborts workflow and clears active pointer", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Abort test",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    expect(abortWorkflow(testDir)).toBe(true)
    expect(getActiveWorkflowInstance(testDir)).toBeNull()

    const instances = listInstances(testDir)
    expect(instances.length).toBe(1)
    const abortedInstance = readWorkflowInstance(testDir, instances[0])
    expect(abortedInstance!.status).toBe("cancelled")
    expect(abortedInstance!.ended_at).toBeTruthy()
  })
})

describe("Workflow Engine E2E: Hook integration", () => {
  it("handleRunWorkflow starts workflow and returns first step prompt", () => {
    writeDefinitionFile(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText('secure-feature "Add OAuth2"'),
      sessionId: "sess-e2e",
      directory: testDir,
    })

    expect(result.contextInjection).not.toBeNull()
    expect(result.contextInjection).toContain("Add OAuth2")
    expect(result.switchAgent).toBe("loom")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.goal).toBe("Add OAuth2")
  })

  it("checkWorkflowContinuation advances step when completion condition is met", () => {
    const defPath = writeDefinitionFile(testDir)
    const instance = createWorkflowInstance(SECURE_FEATURE_DEF, defPath, "Test goal", "sess-e2e")
    instance.status = "running"
    instance.steps.gather.status = "active"
    instance.steps.gather.started_at = new Date().toISOString()
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)

    const result = checkWorkflowContinuation({
      sessionId: "sess-e2e",
      directory: testDir,
      lastUserMessage: "approved, let's go",
    })

    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain(WORKFLOW_CONTINUATION_MARKER)
    expect(result.switchAgent).toBe("pattern")
  })

  it("continuation prompts always contain WORKFLOW_CONTINUATION_MARKER", () => {
    const defPath = writeDefinitionFile(testDir)
    const instance = createWorkflowInstance(SECURE_FEATURE_DEF, defPath, "Marker test", "sess-e2e")
    instance.status = "running"
    instance.steps.gather.status = "active"
    instance.steps.gather.started_at = new Date().toISOString()
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)

    const result = checkWorkflowContinuation({
      sessionId: "sess-e2e",
      directory: testDir,
      lastUserMessage: "confirmed",
    })

    expect(result.continuationPrompt).toContain(WORKFLOW_CONTINUATION_MARKER)
  })
})

describe("Workflow Engine E2E: Workflow commands", () => {
  it("'workflow status' shows current state during active workflow", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Add OAuth2",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    const result = handleWorkflowCommand("workflow status", testDir)
    expect(result.handled).toBe(true)
    expect(result.contextInjection).toContain("Workflow Status: secure-feature")
    expect(result.contextInjection).toContain("Add OAuth2")
    expect(result.contextInjection).toContain("[→] Gather Requirements (active)")
  })

  it("'workflow abort' cancels workflow via natural language command", () => {
    const defPath = writeDefinitionFile(testDir)

    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Abort via command",
      sessionId: "sess-e2e",
      directory: testDir,
    })

    const result = handleWorkflowCommand("abort workflow", testDir)
    expect(result.handled).toBe(true)
    expect(result.contextInjection).toContain("Workflow Aborted")
    expect(getActiveWorkflowInstance(testDir)).toBeNull()
  })
})

describe("Workflow Engine E2E: Discovery", () => {
  it("discovers workflow definitions from project directory", () => {
    writeDefinitionFile(testDir)

    const workflows = discoverWorkflows(testDir)
    expect(workflows.length).toBe(1)
    expect(workflows[0].definition.name).toBe("secure-feature")
    expect(workflows[0].scope).toBe("project")
  })

  it("parseWorkflowArgs handles various argument formats", () => {
    expect(parseWorkflowArgs("")).toEqual({ workflowName: null, goal: null })
    expect(parseWorkflowArgs("my-flow")).toEqual({ workflowName: "my-flow", goal: null })
    expect(parseWorkflowArgs('my-flow "Add auth"')).toEqual({ workflowName: "my-flow", goal: "Add auth" })
    expect(parseWorkflowArgs("my-flow 'Add auth'")).toEqual({ workflowName: "my-flow", goal: "Add auth" })
    expect(parseWorkflowArgs("my-flow Add auth")).toEqual({ workflowName: "my-flow", goal: "Add auth" })
  })
})

describe("Workflow Engine E2E: Session resume", () => {
  it("resumes workflow from disk state in a new session", () => {
    const defPath = writeDefinitionFile(testDir)

    // Start workflow in "session 1"
    startWorkflow({
      definition: SECURE_FEATURE_DEF,
      definitionPath: defPath,
      goal: "Resume test",
      sessionId: "sess-1",
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

    // Simulate a new session — just read state from disk
    const instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.current_step_id).toBe("plan")
    expect(instance!.status).toBe("running")
    expect(instance!.goal).toBe("Resume test")

    // Can still advance in the "new session"
    const result = checkAndAdvance({
      directory: testDir,
      context: {
        directory: testDir,
        config: { method: "agent_signal" },
        artifacts: {},
        lastAssistantMessage: "<!-- workflow:step-complete -->",
      },
    })
    expect(result.type).toBe("inject_prompt")
    expect(result.agent).toBe("weft")
  })
})
