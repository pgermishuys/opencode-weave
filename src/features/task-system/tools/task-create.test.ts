import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createTaskCreateTool } from "./task-create"
import { readTask, getTaskDir } from "../storage"
import type { ToolContext } from "@opencode-ai/plugin"

let testDir: string
let configDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-task-create-test-"))
  configDir = mkdtempSync(join(tmpdir(), "weave-config-"))
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

describe("task_create tool", () => {
  it("creates task with required subject field", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Build feature X" }, makeContext())
    const parsed = JSON.parse(result)
    expect(parsed.task.subject).toBe("Build feature X")
    expect(parsed.task.id).toBeDefined()
  })

  it("auto-generates T-{uuid} format ID", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Test" }, makeContext())
    const parsed = JSON.parse(result)
    expect(/^T-[a-f0-9-]+$/.test(parsed.task.id)).toBe(true)
  })

  it("records sessionID as threadID", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Test" }, makeContext({ sessionID: "sess-abc" }))
    const parsed = JSON.parse(result)

    // Read the persisted task to verify threadID
    const taskDir = getTaskDir(testDir, configDir)
    const task = readTask(taskDir, parsed.task.id)
    expect(task).not.toBeNull()
    expect(task!.threadID).toBe("sess-abc")
  })

  it("sets default status to pending, blocks/blockedBy to []", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Test" }, makeContext())
    const parsed = JSON.parse(result)

    const taskDir = getTaskDir(testDir, configDir)
    const task = readTask(taskDir, parsed.task.id)
    expect(task!.status).toBe("pending")
    expect(task!.blocks).toEqual([])
    expect(task!.blockedBy).toEqual([])
  })

  it("accepts optional description, blockedBy, blocks, metadata", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute(
      {
        subject: "Test",
        description: "A detailed description",
        blocks: ["T-other"],
        blockedBy: ["T-prereq"],
        metadata: { priority: "high" },
      },
      makeContext(),
    )
    const parsed = JSON.parse(result)

    const taskDir = getTaskDir(testDir, configDir)
    const task = readTask(taskDir, parsed.task.id)
    expect(task!.description).toBe("A detailed description")
    expect(task!.blocks).toEqual(["T-other"])
    expect(task!.blockedBy).toEqual(["T-prereq"])
    expect(task!.metadata).toEqual({ priority: "high" })
  })

  it("returns minimal { task: { id, subject } } response", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Minimal" }, makeContext())
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed.task)).toEqual(["id", "subject"])
  })

  it("writes task to file storage (file exists after create)", async () => {
    const tool = createTaskCreateTool({ directory: testDir, configDir })
    const result = await tool.execute({ subject: "Persisted" }, makeContext())
    const parsed = JSON.parse(result)

    const taskDir = getTaskDir(testDir, configDir)
    const filePath = join(taskDir, `${parsed.task.id}.json`)
    expect(existsSync(filePath)).toBe(true)
  })
})
