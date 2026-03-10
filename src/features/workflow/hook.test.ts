import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  parseWorkflowArgs,
  handleRunWorkflow,
  checkWorkflowContinuation,
  WORKFLOW_CONTINUATION_MARKER,
} from "./hook"
import {
  createWorkflowInstance,
  writeWorkflowInstance,
  setActiveInstance,
  getActiveWorkflowInstance,
  clearActiveInstance,
} from "./storage"
import {
  WORKFLOWS_STATE_DIR,
  WORKFLOWS_DIR_PROJECT,
} from "./constants"
import type { WorkflowDefinition } from "./types"

let testDir: string

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

function writeDefinitionFile(dir: string, def: WorkflowDefinition = TWO_STEP_DEF): string {
  const defDir = join(dir, WORKFLOWS_DIR_PROJECT)
  mkdirSync(defDir, { recursive: true })
  const defPath = join(defDir, `${def.name}.json`)
  writeFileSync(defPath, JSON.stringify(def))
  return defPath
}

function setupRunningInstance(dir: string, def: WorkflowDefinition = TWO_STEP_DEF) {
  const defPath = writeDefinitionFile(dir, def)
  const instance = createWorkflowInstance(def, defPath, "Add OAuth2 login", "sess-1")
  instance.status = "running"
  instance.steps["gather"].status = "active"
  instance.steps["gather"].started_at = new Date().toISOString()
  writeWorkflowInstance(dir, instance)
  setActiveInstance(dir, instance.instance_id)
  return instance
}

function makePromptText(args: string): string {
  return `<session-context>
Session ID: sess-1
</session-context>

<command-instructions>
The workflow engine will inject context here.
</command-instructions>

<user-request>
${args}
</user-request>`
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "wf-hook-"))
  mkdirSync(join(testDir, WORKFLOWS_STATE_DIR), { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("WORKFLOW_CONTINUATION_MARKER", () => {
  it("is a string constant", () => {
    expect(typeof WORKFLOW_CONTINUATION_MARKER).toBe("string")
    expect(WORKFLOW_CONTINUATION_MARKER.length).toBeGreaterThan(0)
  })

  it("contains weave:workflow-continuation", () => {
    expect(WORKFLOW_CONTINUATION_MARKER).toContain("weave:workflow-continuation")
  })
})

describe("parseWorkflowArgs", () => {
  it("returns null/null for empty string", () => {
    const result = parseWorkflowArgs("")
    expect(result.workflowName).toBeNull()
    expect(result.goal).toBeNull()
  })

  it("returns null/null for whitespace-only", () => {
    const result = parseWorkflowArgs("   ")
    expect(result.workflowName).toBeNull()
    expect(result.goal).toBeNull()
  })

  it("parses workflow name only", () => {
    const result = parseWorkflowArgs("secure-feature")
    expect(result.workflowName).toBe("secure-feature")
    expect(result.goal).toBeNull()
  })

  it("parses workflow name with double-quoted goal", () => {
    const result = parseWorkflowArgs('secure-feature "Add OAuth2 login"')
    expect(result.workflowName).toBe("secure-feature")
    expect(result.goal).toBe("Add OAuth2 login")
  })

  it("parses workflow name with single-quoted goal", () => {
    const result = parseWorkflowArgs("secure-feature 'Add OAuth2 login'")
    expect(result.workflowName).toBe("secure-feature")
    expect(result.goal).toBe("Add OAuth2 login")
  })

  it("parses workflow name with unquoted multi-word goal", () => {
    const result = parseWorkflowArgs("secure-feature Add OAuth2 login")
    expect(result.workflowName).toBe("secure-feature")
    expect(result.goal).toBe("Add OAuth2 login")
  })
})

describe("handleRunWorkflow", () => {
  it("returns null context when prompt has no session-context tag", () => {
    const result = handleRunWorkflow({
      promptText: "just a regular message",
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toBeNull()
    expect(result.switchAgent).toBeNull()
  })

  it("lists available workflows when no args and no active instance", () => {
    writeDefinitionFile(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText(""),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Available Workflows")
    expect(result.contextInjection).toContain("test-workflow")
  })

  it("shows 'no workflows' when no definitions found", () => {
    const result = handleRunWorkflow({
      promptText: makePromptText(""),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("No Workflows Available")
  })

  it("starts a new workflow with name and goal", () => {
    writeDefinitionFile(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText('test-workflow "Add OAuth2 login"'),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).not.toBeNull()
    expect(result.contextInjection).toContain("Add OAuth2 login")
    expect(result.switchAgent).toBe("loom")

    const instance = getActiveWorkflowInstance(testDir)
    expect(instance).not.toBeNull()
    expect(instance!.goal).toBe("Add OAuth2 login")
  })

  it("resumes active workflow when no args provided", () => {
    const inst = setupRunningInstance(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText(""),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("already running")
  })

  it("resumes active workflow when matching name provided", () => {
    setupRunningInstance(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText("test-workflow"),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("already running")
  })

  it("rejects starting a new workflow when one is active", () => {
    setupRunningInstance(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText('test-workflow "Different goal"'),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Workflow Already Active")
  })

  it("requires a goal when only name is given and no active instance", () => {
    writeDefinitionFile(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText("test-workflow"),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Goal Required")
  })

  it("returns 'not found' for unknown workflow name", () => {
    writeDefinitionFile(testDir)

    const result = handleRunWorkflow({
      promptText: makePromptText('nonexistent "Some goal"'),
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.contextInjection).toContain("Workflow Not Found")
  })
})

describe("checkWorkflowContinuation", () => {
  it("returns null when no active instance", () => {
    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.continuationPrompt).toBeNull()
    expect(result.switchAgent).toBeNull()
  })

  it("returns null when instance is not running", () => {
    const inst = setupRunningInstance(testDir)
    inst.status = "paused"
    writeWorkflowInstance(testDir, inst)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
    })
    expect(result.continuationPrompt).toBeNull()
  })

  it("returns null for interactive step without user confirmation", () => {
    setupRunningInstance(testDir)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
      lastAssistantMessage: "What do you think?",
    })
    expect(result.continuationPrompt).toBeNull()
  })

  it("advances to next step when user confirms interactive step", () => {
    setupRunningInstance(testDir)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
      lastUserMessage: "approved, let's proceed",
    })
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain(WORKFLOW_CONTINUATION_MARKER)
    expect(result.switchAgent).toBe("tapestry")
  })

  it("includes WORKFLOW_CONTINUATION_MARKER in all continuation prompts", () => {
    setupRunningInstance(testDir)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
      lastUserMessage: "confirmed",
    })
    if (result.continuationPrompt) {
      expect(result.continuationPrompt).toContain(WORKFLOW_CONTINUATION_MARKER)
    }
  })

  it("advances autonomous step when agent signals completion", () => {
    const inst = setupRunningInstance(testDir)
    // Move to the autonomous step
    inst.steps["gather"].status = "completed"
    inst.steps["gather"].summary = "Requirements gathered"
    inst.current_step_id = "build"
    inst.steps["build"].status = "active"
    inst.steps["build"].started_at = new Date().toISOString()
    writeWorkflowInstance(testDir, inst)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
      lastAssistantMessage: "All tasks are complete. <!-- workflow:step-complete -->",
    })
    // This is the last step, so it should complete
    expect(result.continuationPrompt).not.toBeNull()
    expect(result.continuationPrompt).toContain(WORKFLOW_CONTINUATION_MARKER)
    expect(result.continuationPrompt).toContain("Workflow Complete")
  })

  it("does not advance when autonomous step has no completion signal", () => {
    const inst = setupRunningInstance(testDir)
    inst.steps["gather"].status = "completed"
    inst.current_step_id = "build"
    inst.steps["build"].status = "active"
    inst.steps["build"].started_at = new Date().toISOString()
    writeWorkflowInstance(testDir, inst)

    const result = checkWorkflowContinuation({
      sessionId: "sess-1",
      directory: testDir,
      lastAssistantMessage: "Still working on it...",
    })
    expect(result.continuationPrompt).toBeNull()
  })
})
