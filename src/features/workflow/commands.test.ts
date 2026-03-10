import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { handleWorkflowCommand } from "./commands"
import {
  createWorkflowInstance,
  writeWorkflowInstance,
  setActiveInstance,
  getActiveWorkflowInstance,
} from "./storage"
import { WORKFLOWS_STATE_DIR } from "./constants"
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
      prompt: "Gather info",
      completion: { method: "user_confirm" },
    },
    {
      id: "build",
      name: "Build Feature",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Build it",
      completion: { method: "agent_signal" },
    },
  ],
}

function setupRunningInstance(dir: string, def: WorkflowDefinition = TWO_STEP_DEF) {
  const defPath = join(dir, "workflow-def.json")
  writeFileSync(defPath, JSON.stringify(def))
  const instance = createWorkflowInstance(def, defPath, "Add OAuth2 login", "sess-1")
  instance.status = "running"
  instance.steps["gather"].status = "active"
  instance.steps["gather"].started_at = new Date().toISOString()
  writeWorkflowInstance(dir, instance)
  setActiveInstance(dir, instance.instance_id)
  return instance
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "wf-commands-"))
  mkdirSync(join(testDir, WORKFLOWS_STATE_DIR), { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe("handleWorkflowCommand", () => {
  describe("when no active workflow", () => {
    it("returns handled=false for any keyword", () => {
      const result = handleWorkflowCommand("workflow pause", testDir)
      expect(result.handled).toBe(false)
    })

    it("returns handled=false for status", () => {
      const result = handleWorkflowCommand("workflow status", testDir)
      expect(result.handled).toBe(false)
    })
  })

  describe("when workflow is active", () => {
    describe("pause", () => {
      it("pauses with 'workflow pause'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow pause", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Paused")

        const instance = getActiveWorkflowInstance(testDir)
        expect(instance?.status).toBe("paused")
      })

      it("pauses with 'pause workflow'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("pause workflow", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Paused")
      })

      it("pauses case-insensitively", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("Workflow Pause", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Paused")
      })

      it("returns error when workflow is already paused", () => {
        const inst = setupRunningInstance(testDir)
        inst.status = "paused"
        writeWorkflowInstance(testDir, inst)

        const result = handleWorkflowCommand("workflow pause", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Not Running")
      })
    })

    describe("skip", () => {
      it("skips with 'workflow skip'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow skip", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Step Skipped")
      })

      it("skips with 'skip step'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("skip step", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Step Skipped")
      })

      it("advances to next step and switches agent", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow skip", testDir)
        expect(result.handled).toBe(true)
        expect(result.switchAgent).toBe("tapestry")

        const instance = getActiveWorkflowInstance(testDir)
        expect(instance?.current_step_id).toBe("build")
        expect(instance?.steps["gather"].status).toBe("completed")
        expect(instance?.steps["build"].status).toBe("active")
      })

      it("completes workflow when skipping last step", () => {
        const inst = setupRunningInstance(testDir)
        // Move to last step
        inst.steps["gather"].status = "completed"
        inst.current_step_id = "build"
        inst.steps["build"].status = "active"
        inst.steps["build"].started_at = new Date().toISOString()
        writeWorkflowInstance(testDir, inst)

        const result = handleWorkflowCommand("skip step", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Complete")
      })

      it("returns error when workflow is not running", () => {
        const inst = setupRunningInstance(testDir)
        inst.status = "paused"
        writeWorkflowInstance(testDir, inst)

        const result = handleWorkflowCommand("workflow skip", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Not Running")
      })
    })

    describe("abort", () => {
      it("aborts with 'workflow abort'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow abort", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Aborted")
        expect(result.contextInjection).toContain("test-workflow")

        const instance = getActiveWorkflowInstance(testDir)
        expect(instance).toBeNull()
      })

      it("aborts with 'abort workflow'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("abort workflow", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Aborted")
      })

      it("aborts even when paused", () => {
        const inst = setupRunningInstance(testDir)
        inst.status = "paused"
        writeWorkflowInstance(testDir, inst)

        const result = handleWorkflowCommand("workflow abort", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Aborted")
      })
    })

    describe("status", () => {
      it("shows status with 'workflow status'", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow status", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Status: test-workflow")
        expect(result.contextInjection).toContain("Add OAuth2 login")
        expect(result.contextInjection).toContain("running")
      })

      it("shows step progress markers", () => {
        const inst = setupRunningInstance(testDir)
        inst.steps["gather"].status = "completed"
        inst.steps["gather"].summary = "Requirements gathered"
        inst.current_step_id = "build"
        inst.steps["build"].status = "active"
        writeWorkflowInstance(testDir, inst)

        const result = handleWorkflowCommand("workflow status", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("[✓] Gather Requirements")
        expect(result.contextInjection).toContain("[→] Build Feature (active)")
        expect(result.contextInjection).toContain("1/2 steps")
      })

      it("includes goal in status", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow status", testDir)
        expect(result.contextInjection).toContain("Add OAuth2 login")
      })
    })

    describe("no match", () => {
      it("returns handled=false for unrecognized message", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("please help me with something", testDir)
        expect(result.handled).toBe(false)
      })

      it("returns handled=false for partial keyword match", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("workflow", testDir)
        expect(result.handled).toBe(false)
      })

      it("returns handled=false for empty message", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("", testDir)
        expect(result.handled).toBe(false)
      })
    })

    describe("keyword detection within longer messages", () => {
      it("detects 'workflow pause' within a sentence", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("can you do a workflow pause please", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Paused")
      })

      it("detects 'workflow status' within a sentence", () => {
        setupRunningInstance(testDir)
        const result = handleWorkflowCommand("show me workflow status now", testDir)
        expect(result.handled).toBe(true)
        expect(result.contextInjection).toContain("Workflow Status")
      })
    })
  })
})
