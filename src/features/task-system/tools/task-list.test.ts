import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createTaskListTool } from "./task-list"
import { getTaskDir, writeTask, ensureDir } from "../storage"
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
  testDir = mkdtempSync(join(tmpdir(), "weave-task-list-test-"))
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

describe("task_list tool", () => {
  it("lists active tasks (pending + in_progress)", async () => {
    writeTask(taskDir, createSampleTask({ id: "T-1", status: "pending" }))
    writeTask(taskDir, createSampleTask({ id: "T-2", status: "in_progress" }))

    const tool = createTaskListTool({ directory: testDir, configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)

    expect(parsed.tasks).toHaveLength(2)
  })

  it("excludes completed and deleted tasks", async () => {
    writeTask(taskDir, createSampleTask({ id: "T-1", status: "pending" }))
    writeTask(taskDir, createSampleTask({ id: "T-2", status: "completed" }))
    writeTask(taskDir, createSampleTask({ id: "T-3", status: "deleted" }))

    const tool = createTaskListTool({ directory: testDir, configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)

    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0].id).toBe("T-1")
  })

  it("filters blockedBy to only unresolved blockers", async () => {
    writeTask(taskDir, createSampleTask({ id: "T-blocker", status: "completed" }))
    writeTask(taskDir, createSampleTask({
      id: "T-blocked",
      status: "pending",
      blockedBy: ["T-blocker", "T-still-blocking"],
    }))
    writeTask(taskDir, createSampleTask({ id: "T-still-blocking", status: "pending" }))

    const tool = createTaskListTool({ directory: testDir, configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)

    const blockedTask = parsed.tasks.find((t: { id: string }) => t.id === "T-blocked")
    expect(blockedTask.blockedBy).toEqual(["T-still-blocking"])
  })

  it("returns empty array when no tasks exist", async () => {
    const tool = createTaskListTool({ directory: testDir, configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.tasks).toEqual([])
  })

  it("returns empty array when directory doesn't exist", async () => {
    const tool = createTaskListTool({ directory: join(testDir, "nonexistent"), configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.tasks).toEqual([])
  })

  it("returns summary format (id, subject, status, blockedBy — no description)", async () => {
    writeTask(taskDir, createSampleTask({ id: "T-1", subject: "My task", description: "Long description" }))

    const tool = createTaskListTool({ directory: testDir, configDir })
    const result = await tool.execute({}, makeContext())
    const parsed = JSON.parse(result)

    const task = parsed.tasks[0]
    expect(task.id).toBe("T-1")
    expect(task.subject).toBe("My task")
    expect(task.status).toBe("pending")
    expect(task.blockedBy).toEqual([])
    expect(task.description).toBeUndefined()
  })
})
