import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getTaskDir,
  generateTaskId,
  readJsonSafe,
  writeJsonAtomic,
  acquireLock,
  listTaskFiles,
  readTask,
  writeTask,
  readAllTasks,
  ensureDir,
} from "./storage"
import { TaskObjectSchema, type TaskObject } from "./types"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "weave-task-storage-test-"))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

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

describe("generateTaskId", () => {
  it("matches T-{uuid} format", () => {
    const id = generateTaskId()
    expect(/^T-[a-f0-9-]+$/.test(id)).toBe(true)
  })

  it("produces unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId()))
    expect(ids.size).toBe(100)
  })
})

describe("getTaskDir", () => {
  it("returns path under config dir with sanitized project slug", () => {
    const dir = getTaskDir("/path/to/My Project", testDir)
    expect(dir).toContain(testDir)
    expect(dir).toContain("tasks")
    expect(dir).toContain("my-project")
  })

  it("sanitizes special characters", () => {
    const dir = getTaskDir("/path/to/My Project!@#", testDir)
    expect(dir).not.toContain("!")
    expect(dir).not.toContain("@")
    expect(dir).not.toContain("#")
  })

  it("handles empty basename gracefully", () => {
    const dir = getTaskDir("/", testDir)
    expect(dir).toContain("tasks")
  })
})

describe("writeJsonAtomic", () => {
  it("writes valid JSON to target file", () => {
    const filePath = join(testDir, "test.json")
    writeJsonAtomic(filePath, { hello: "world" })
    expect(existsSync(filePath)).toBe(true)
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content).toEqual({ hello: "world" })
  })

  it("cleans up temp file", () => {
    const filePath = join(testDir, "test.json")
    writeJsonAtomic(filePath, { data: true })
    expect(existsSync(`${filePath}.tmp`)).toBe(false)
  })

  it("creates parent directories", () => {
    const filePath = join(testDir, "nested", "deep", "test.json")
    writeJsonAtomic(filePath, { nested: true })
    expect(existsSync(filePath)).toBe(true)
  })
})

describe("readJsonSafe", () => {
  it("returns parsed object for valid file", () => {
    const filePath = join(testDir, "valid.json")
    const task = createSampleTask()
    writeFileSync(filePath, JSON.stringify(task), "utf-8")
    const result = readJsonSafe(filePath, TaskObjectSchema)
    expect(result).not.toBeNull()
    expect(result!.id).toBe("T-test-1234")
  })

  it("returns null for missing file", () => {
    expect(readJsonSafe(join(testDir, "nonexistent.json"), TaskObjectSchema)).toBeNull()
  })

  it("returns null for corrupt JSON", () => {
    const filePath = join(testDir, "corrupt.json")
    writeFileSync(filePath, "not json {{{", "utf-8")
    expect(readJsonSafe(filePath, TaskObjectSchema)).toBeNull()
  })

  it("returns null for schema-invalid data", () => {
    const filePath = join(testDir, "invalid.json")
    writeFileSync(filePath, JSON.stringify({ wrong: "shape" }), "utf-8")
    expect(readJsonSafe(filePath, TaskObjectSchema)).toBeNull()
  })
})

describe("acquireLock", () => {
  it("acquires lock successfully", () => {
    const lockPath = join(testDir, "test.lock")
    const release = acquireLock(lockPath)
    expect(release).not.toBeNull()
    expect(existsSync(lockPath)).toBe(true)
    release!()
  })

  it("second acquire fails while first held", () => {
    const lockPath = join(testDir, "test.lock")
    const release1 = acquireLock(lockPath)
    expect(release1).not.toBeNull()

    const release2 = acquireLock(lockPath)
    expect(release2).toBeNull()

    release1!()
  })

  it("release allows re-acquire", () => {
    const lockPath = join(testDir, "test.lock")
    const release1 = acquireLock(lockPath)
    expect(release1).not.toBeNull()
    release1!()

    const release2 = acquireLock(lockPath)
    expect(release2).not.toBeNull()
    release2!()
  })

  it("stale lock is broken and re-acquired", () => {
    const lockPath = join(testDir, "test.lock")

    // Create a lock file with an old timestamp
    writeFileSync(lockPath, "", "utf-8")
    // Use threshold of -1 so any file age is considered stale
    const release = acquireLock(lockPath, -1)
    expect(release).not.toBeNull()
    release!()
  })
})

describe("listTaskFiles", () => {
  it("returns only T-*.json files", () => {
    ensureDir(testDir)
    writeFileSync(join(testDir, "T-abc.json"), "{}", "utf-8")
    writeFileSync(join(testDir, "T-def.json"), "{}", "utf-8")
    writeFileSync(join(testDir, "test.lock"), "", "utf-8")
    writeFileSync(join(testDir, "notes.txt"), "", "utf-8")
    const files = listTaskFiles(testDir)
    expect(files).toHaveLength(2)
    expect(files.every((f) => f.includes("T-") && f.endsWith(".json"))).toBe(true)
  })

  it("returns empty array for missing directory", () => {
    expect(listTaskFiles(join(testDir, "nonexistent"))).toEqual([])
  })

  it("ignores non-task files", () => {
    ensureDir(testDir)
    writeFileSync(join(testDir, "config.json"), "{}", "utf-8")
    writeFileSync(join(testDir, "lock.file"), "", "utf-8")
    expect(listTaskFiles(testDir)).toEqual([])
  })
})

describe("readTask / writeTask", () => {
  it("round-trips a task", () => {
    const task = createSampleTask()
    writeTask(testDir, task)
    const read = readTask(testDir, task.id)
    expect(read).not.toBeNull()
    expect(read!.id).toBe(task.id)
    expect(read!.subject).toBe(task.subject)
    expect(read!.status).toBe("pending")
  })

  it("returns null for non-existent task", () => {
    expect(readTask(testDir, "T-nonexistent")).toBeNull()
  })
})

describe("readAllTasks", () => {
  it("reads all valid task files", () => {
    const task1 = createSampleTask({ id: "T-1" })
    const task2 = createSampleTask({ id: "T-2", subject: "Second task" })
    writeTask(testDir, task1)
    writeTask(testDir, task2)
    const tasks = readAllTasks(testDir)
    expect(tasks).toHaveLength(2)
  })

  it("skips corrupt files", () => {
    const task = createSampleTask()
    writeTask(testDir, task)
    writeFileSync(join(testDir, "T-corrupt.json"), "not json", "utf-8")
    const tasks = readAllTasks(testDir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(task.id)
  })

  it("returns empty array for non-existent directory", () => {
    expect(readAllTasks(join(testDir, "nonexistent"))).toEqual([])
  })
})
