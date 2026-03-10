import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  generateInstanceId,
  generateSlug,
  createWorkflowInstance,
  readWorkflowInstance,
  writeWorkflowInstance,
  readActiveInstance,
  setActiveInstance,
  clearActiveInstance,
  getActiveWorkflowInstance,
  listInstances,
  appendInstanceSessionId,
} from "./storage"
import { WORKFLOWS_STATE_DIR, INSTANCE_STATE_FILE, ACTIVE_INSTANCE_FILE } from "./constants"
import type { WorkflowDefinition } from "./types"

let testDir: string

const SAMPLE_DEFINITION: WorkflowDefinition = {
  name: "test-workflow",
  description: "A test workflow",
  version: 1,
  steps: [
    {
      id: "gather",
      name: "Gather",
      type: "interactive",
      agent: "loom",
      prompt: "Gather info for: {{instance.goal}}",
      completion: { method: "user_confirm" },
    },
    {
      id: "build",
      name: "Build",
      type: "autonomous",
      agent: "tapestry",
      prompt: "Build it.",
      completion: { method: "agent_signal" },
    },
  ],
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-workflow-test-"))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors on Windows
  }
})

describe("generateInstanceId", () => {
  it("produces wf_ prefixed IDs", () => {
    const id = generateInstanceId()
    expect(id.startsWith("wf_")).toBe(true)
  })

  it("produces 11-char IDs (wf_ + 8 hex)", () => {
    const id = generateInstanceId()
    expect(id.length).toBe(11)
  })

  it("produces hex characters after prefix", () => {
    const id = generateInstanceId()
    expect(/^wf_[0-9a-f]{8}$/.test(id)).toBe(true)
  })

  it("produces unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateInstanceId()))
    expect(ids.size).toBe(100)
  })
})

describe("generateSlug", () => {
  it("converts to lowercase and hyphens", () => {
    expect(generateSlug("Add OAuth2 Login")).toBe("add-oauth2-login")
  })

  it("strips special characters", () => {
    expect(generateSlug("Fix Bug #123!")).toBe("fix-bug-123")
  })

  it("truncates to 50 chars", () => {
    const long = "a".repeat(100)
    expect(generateSlug(long).length).toBe(50)
  })

  it("handles empty string", () => {
    expect(generateSlug("")).toBe("")
  })

  it("collapses multiple spaces/hyphens", () => {
    expect(generateSlug("hello   world---test")).toBe("hello-world-test")
  })

  it("strips leading/trailing hyphens", () => {
    expect(generateSlug("--hello--")).toBe("hello")
  })

  it("handles complex goal text", () => {
    expect(generateSlug("Add OAuth2 login with Google and GitHub providers")).toBe(
      "add-oauth2-login-with-google-and-github-providers",
    )
  })
})

describe("createWorkflowInstance", () => {
  it("creates instance with correct fields", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "Add OAuth2", "sess_1")
    expect(instance.instance_id).toMatch(/^wf_[0-9a-f]{8}$/)
    expect(instance.definition_id).toBe("test-workflow")
    expect(instance.definition_name).toBe("test-workflow")
    expect(instance.definition_path).toBe("/path/test.jsonc")
    expect(instance.goal).toBe("Add OAuth2")
    expect(instance.slug).toBe("add-oauth2")
    expect(instance.status).toBe("running")
    expect(instance.started_at).toBeTruthy()
    expect(instance.session_ids).toEqual(["sess_1"])
    expect(instance.current_step_id).toBe("gather")
    expect(instance.artifacts).toEqual({})
  })

  it("sets first step to active, rest to pending", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    expect(instance.steps["gather"].status).toBe("active")
    expect(instance.steps["gather"].started_at).toBeTruthy()
    expect(instance.steps["build"].status).toBe("pending")
    expect(instance.steps["build"].started_at).toBeUndefined()
  })

  it("initializes all steps from definition", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    expect(Object.keys(instance.steps)).toHaveLength(2)
    expect(instance.steps["gather"]).toBeDefined()
    expect(instance.steps["build"]).toBeDefined()
  })
})

describe("readWorkflowInstance / writeWorkflowInstance", () => {
  it("returns null when instance does not exist", () => {
    expect(readWorkflowInstance(testDir, "wf_nonexist")).toBeNull()
  })

  it("round-trips an instance", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "Add OAuth2", "sess_1")
    expect(writeWorkflowInstance(testDir, instance)).toBe(true)
    const read = readWorkflowInstance(testDir, instance.instance_id)
    expect(read).not.toBeNull()
    expect(read!.instance_id).toBe(instance.instance_id)
    expect(read!.goal).toBe("Add OAuth2")
    expect(read!.definition_id).toBe("test-workflow")
    expect(read!.steps["gather"].status).toBe("active")
  })

  it("creates directories as needed", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    writeWorkflowInstance(testDir, instance)
    const stateFile = join(testDir, WORKFLOWS_STATE_DIR, instance.instance_id, INSTANCE_STATE_FILE)
    expect(existsSync(stateFile)).toBe(true)
  })

  it("returns null for malformed JSON", () => {
    const id = "wf_12345678"
    const dir = join(testDir, WORKFLOWS_STATE_DIR, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, INSTANCE_STATE_FILE), "not json", "utf-8")
    expect(readWorkflowInstance(testDir, id)).toBeNull()
  })

  it("returns null for missing instance_id field", () => {
    const id = "wf_12345678"
    const dir = join(testDir, WORKFLOWS_STATE_DIR, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, INSTANCE_STATE_FILE), '{"goal":"test"}', "utf-8")
    expect(readWorkflowInstance(testDir, id)).toBeNull()
  })
})

describe("readActiveInstance / setActiveInstance / clearActiveInstance", () => {
  it("returns null when no pointer exists", () => {
    expect(readActiveInstance(testDir)).toBeNull()
  })

  it("sets and reads active instance pointer", () => {
    expect(setActiveInstance(testDir, "wf_12345678")).toBe(true)
    const pointer = readActiveInstance(testDir)
    expect(pointer).not.toBeNull()
    expect(pointer!.instance_id).toBe("wf_12345678")
  })

  it("clears active instance pointer", () => {
    setActiveInstance(testDir, "wf_12345678")
    expect(clearActiveInstance(testDir)).toBe(true)
    expect(readActiveInstance(testDir)).toBeNull()
  })

  it("clear returns true even if no pointer exists", () => {
    expect(clearActiveInstance(testDir)).toBe(true)
  })

  it("returns null for malformed pointer file", () => {
    const dir = join(testDir, WORKFLOWS_STATE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, ACTIVE_INSTANCE_FILE), "not json", "utf-8")
    expect(readActiveInstance(testDir)).toBeNull()
  })

  it("returns null for pointer missing instance_id", () => {
    const dir = join(testDir, WORKFLOWS_STATE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, ACTIVE_INSTANCE_FILE), '{"foo":"bar"}', "utf-8")
    expect(readActiveInstance(testDir)).toBeNull()
  })
})

describe("getActiveWorkflowInstance", () => {
  it("returns null when no active pointer", () => {
    expect(getActiveWorkflowInstance(testDir)).toBeNull()
  })

  it("returns null when pointer exists but instance doesn't", () => {
    setActiveInstance(testDir, "wf_nonexist")
    expect(getActiveWorkflowInstance(testDir)).toBeNull()
  })

  it("returns the active instance", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    writeWorkflowInstance(testDir, instance)
    setActiveInstance(testDir, instance.instance_id)
    const active = getActiveWorkflowInstance(testDir)
    expect(active).not.toBeNull()
    expect(active!.instance_id).toBe(instance.instance_id)
    expect(active!.goal).toBe("goal")
  })
})

describe("listInstances", () => {
  it("returns empty array when no workflows directory", () => {
    expect(listInstances(testDir)).toEqual([])
  })

  it("returns only wf_ directories", () => {
    const dir = join(testDir, WORKFLOWS_STATE_DIR)
    mkdirSync(join(dir, "wf_11111111"), { recursive: true })
    mkdirSync(join(dir, "wf_22222222"), { recursive: true })
    mkdirSync(join(dir, "not-an-instance"), { recursive: true })
    // active-instance.json is a file, not directory — should be excluded
    writeFileSync(join(dir, ACTIVE_INSTANCE_FILE), '{}', "utf-8")
    const instances = listInstances(testDir)
    expect(instances).toHaveLength(2)
    expect(instances).toContain("wf_11111111")
    expect(instances).toContain("wf_22222222")
  })

  it("returns sorted IDs", () => {
    const dir = join(testDir, WORKFLOWS_STATE_DIR)
    mkdirSync(join(dir, "wf_cccccccc"), { recursive: true })
    mkdirSync(join(dir, "wf_aaaaaaaa"), { recursive: true })
    mkdirSync(join(dir, "wf_bbbbbbbb"), { recursive: true })
    const instances = listInstances(testDir)
    expect(instances).toEqual(["wf_aaaaaaaa", "wf_bbbbbbbb", "wf_cccccccc"])
  })
})

describe("appendInstanceSessionId", () => {
  it("returns null when instance doesn't exist", () => {
    expect(appendInstanceSessionId(testDir, "wf_nonexist", "sess_1")).toBeNull()
  })

  it("appends new session ID", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    writeWorkflowInstance(testDir, instance)
    const updated = appendInstanceSessionId(testDir, instance.instance_id, "sess_2")
    expect(updated).not.toBeNull()
    expect(updated!.session_ids).toEqual(["sess_1", "sess_2"])
  })

  it("does not duplicate existing session ID", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    writeWorkflowInstance(testDir, instance)
    appendInstanceSessionId(testDir, instance.instance_id, "sess_1")
    const read = readWorkflowInstance(testDir, instance.instance_id)
    expect(read!.session_ids).toEqual(["sess_1"])
  })

  it("persists the updated session IDs", () => {
    const instance = createWorkflowInstance(SAMPLE_DEFINITION, "/path/test.jsonc", "goal", "sess_1")
    writeWorkflowInstance(testDir, instance)
    appendInstanceSessionId(testDir, instance.instance_id, "sess_2")
    const read = readWorkflowInstance(testDir, instance.instance_id)
    expect(read!.session_ids).toEqual(["sess_1", "sess_2"])
  })
})
