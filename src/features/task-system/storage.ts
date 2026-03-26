import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, readdirSync, statSync, openSync, closeSync } from "fs"
import { join, basename } from "path"
import { randomUUID } from "crypto"
import { TaskObjectSchema, type TaskObject } from "./types"

/**
 * Derive the task storage directory for a given project.
 * Uses the opencode config dir (~/.config/opencode by default) + sanitized project slug.
 */
export function getTaskDir(directory: string, configDir?: string): string {
  const base = configDir ?? join(getHomeDir(), ".config", "opencode")
  const slug = sanitizeSlug(basename(directory))
  return join(base, "tasks", slug)
}

/** Get home directory (cross-platform) */
function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp"
}

/** Sanitize a string for use as a directory name */
function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "default"
}

/** Generate a unique task ID */
export function generateTaskId(): string {
  return `T-${randomUUID()}`
}

/**
 * Read and parse a JSON file safely. Returns null for missing, corrupt, or invalid data.
 */
export function readJsonSafe<T>(filePath: string, schema: { parse: (data: unknown) => T }): T | null {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    return schema.parse(parsed)
  } catch {
    return null
  }
}

/**
 * Write JSON atomically: write to a temp file then rename.
 * This prevents partial writes from corrupting the target file.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = join(filePath, "..")
  mkdirSync(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  renameSync(tmpPath, filePath)
}

/**
 * Acquire a file-based lock. Uses exclusive file creation (wx flag).
 * Returns a release function on success, null on failure.
 *
 * Stale locks older than `staleThresholdMs` (default 30s) are automatically broken.
 */
export function acquireLock(
  lockPath: string,
  staleThresholdMs = 30_000,
): (() => void) | null {
  // Check for stale lock
  try {
    const stat = statSync(lockPath)
    const age = Date.now() - stat.mtimeMs
    if (age > staleThresholdMs) {
      // Stale lock — break it
      try {
        unlinkSync(lockPath)
      } catch {
        // Race: another process may have already removed it
      }
    }
  } catch {
    // Lock file doesn't exist — good
  }

  try {
    // Exclusive create — fails if file already exists
    const fd = openSync(lockPath, "wx")
    closeSync(fd)
    return () => {
      try {
        unlinkSync(lockPath)
      } catch {
        // Lock already removed
      }
    }
  } catch {
    return null
  }
}

/** Ensure a directory exists */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

/** List task files (T-*.json) in the task directory */
export function listTaskFiles(taskDir: string): string[] {
  try {
    return readdirSync(taskDir)
      .filter((f) => f.startsWith("T-") && f.endsWith(".json"))
      .map((f) => join(taskDir, f))
  } catch {
    return []
  }
}

/** Get the file path for a task by ID */
export function getTaskFilePath(taskDir: string, taskId: string): string {
  return join(taskDir, `${taskId}.json`)
}

/** Read a single task from file storage */
export function readTask(taskDir: string, taskId: string): TaskObject | null {
  return readJsonSafe(getTaskFilePath(taskDir, taskId), TaskObjectSchema)
}

/** Write a single task to file storage (atomic) */
export function writeTask(taskDir: string, task: TaskObject): void {
  writeJsonAtomic(getTaskFilePath(taskDir, task.id), task)
}

/** Read all tasks from a task directory */
export function readAllTasks(taskDir: string): TaskObject[] {
  const files = listTaskFiles(taskDir)
  const tasks: TaskObject[] = []
  for (const file of files) {
    const task = readJsonSafe(file, TaskObjectSchema)
    if (task) tasks.push(task)
  }
  return tasks
}
