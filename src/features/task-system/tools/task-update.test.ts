import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createTaskUpdateTool } from "./task-update"
import { getTaskDir, writeTask, readTask, ensureDir } from "../storage"
import type { TaskObject } from "../types"
import type { ToolContext } from "@opencode-ai/plugin"

let testDir: string
let configDir: string
let taskDir: string

function createSampleTask(overrides: Partial<TaskObject> = {}): TaskObject {
  return {
    id: "T-test-1234",
    subject: "Test task",
    description: "A test task",
    status: "pending",
    threadID: "sess-1",
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-task-update-test-"))
  configDir = mkdtempSync(join(tmpdir(), "weave-config-"))
  taskDir = getTaskDir(testDir, configDir)
  ensureDir(taskDir)
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "sess-test",
    messageID: "msg-1",
    agent: "loom",
    directory: testDir,
    worktree: testDir,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  }
}

describe("task_update tool", () => {
  it("updates subject", async () => {
    const task = createSampleTask()
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, subject: "Updated subject" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.subject).toBe("Updated subject")
  })

  it("updates description", async () => {
    const task = createSampleTask()
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, description: "New desc" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.description).toBe("New desc")
  })

  it("updates status", async () => {
    const task = createSampleTask()
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, status: "in_progress" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.status).toBe("in_progress")
  })

  it("additively appends to blocks without replacing existing entries", async () => {
    const task = createSampleTask({ blocks: ["T-existing"] })
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, addBlocks: ["T-new"] }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.blocks).toEqual(["T-existing", "T-new"])
  })

  it("avoids duplicate blocks when adding", async () => {
    const task = createSampleTask({ blocks: ["T-existing"] })
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, addBlocks: ["T-existing"] }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.blocks).toEqual(["T-existing"])
  })

  it("additively appends to blockedBy", async () => {
    const task = createSampleTask({ blockedBy: ["T-blocker"] })
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, addBlockedBy: ["T-new-blocker"] }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.blockedBy).toEqual(["T-blocker", "T-new-blocker"])
  })

  it("merges metadata without replacing entire object", async () => {
    const task = createSampleTask({ metadata: { priority: "low", owner: "alice" } })
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, metadata: { priority: "high" } }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.metadata.priority).toBe("high")
    expect(parsed.task.metadata.owner).toBe("alice") // preserved
  })

  it("deletes metadata keys when set to null", async () => {
    const task = createSampleTask({ metadata: { priority: "high", owner: "alice" } })
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: task.id, metadata: { owner: null } }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.metadata.priority).toBe("high")
    expect(parsed.task.metadata.owner).toBeUndefined()
  })

  it("returns error for missing task", async () => {
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: "T-nonexistent" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.error).toBe("task_not_found")
  })

  it("returns error for invalid ID format", async () => {
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute({ id: "invalid-format" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.error).toBe("invalid_task_id")
  })

  it("persists changes to file storage", async () => {
    const task = createSampleTask()
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    await tool.execute({ id: task.id, status: "completed" }, makeContext())

    // Read directly from file storage
    const persisted = readTask(taskDir, task.id)
    expect(persisted!.status).toBe("completed")
  })

  it("updates multiple fields in single call", async () => {
    const task = createSampleTask()
    writeTask(taskDir, task)
    const tool = createTaskUpdateTool({ directory: testDir, configDir })
    const result = await tool.execute(
      { id: task.id, subject: "New subject", status: "in_progress", description: "New desc" },
      makeContext(),
    )
    const parsed = JSON.parse(result)
    expect(parsed.task.subject).toBe("New subject")
    expect(parsed.task.status).toBe("in_progress")
    expect(parsed.task.description).toBe("New desc")
  })
})
