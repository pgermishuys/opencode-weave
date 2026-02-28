import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from "fs"
import { join, basename } from "path"
import { execSync } from "child_process"
import type { WorkState, PlanProgress } from "./types"
import { WEAVE_DIR, WORK_STATE_FILE, PLANS_DIR } from "./constants"

// Checkbox regexes — match lines starting with - or * followed by [ ] or [x]/[X]
const UNCHECKED_RE = /^[-*]\s*\[\s*\]/gm
const CHECKED_RE = /^[-*]\s*\[[xX]\]/gm

/**
 * Read work state from .weave/state.json.
 * Returns null if file is missing, unparseable, or invalid.
 */
export function readWorkState(directory: string): WorkState | null {
  const filePath = join(directory, WEAVE_DIR, WORK_STATE_FILE)
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    if (typeof parsed.active_plan !== "string") return null
    // Normalize session_ids
    if (!Array.isArray(parsed.session_ids)) {
      parsed.session_ids = []
    }
    return parsed as WorkState
  } catch {
    return null
  }
}

/**
 * Write work state to .weave/state.json.
 * Creates .weave/ directory if needed.
 */
export function writeWorkState(directory: string, state: WorkState): boolean {
  try {
    const dir = join(directory, WEAVE_DIR)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(dir, WORK_STATE_FILE), JSON.stringify(state, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Clear work state by deleting .weave/state.json.
 */
export function clearWorkState(directory: string): boolean {
  const filePath = join(directory, WEAVE_DIR, WORK_STATE_FILE)
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Append a session ID to the work state (if not already present).
 * Returns the updated state, or null if no state exists.
 */
export function appendSessionId(directory: string, sessionId: string): WorkState | null {
  const state = readWorkState(directory)
  if (!state) return null
  if (!state.session_ids.includes(sessionId)) {
    state.session_ids.push(sessionId)
    writeWorkState(directory, state)
  }
  return state
}

/**
 * Create a fresh WorkState for a plan file.
 */
export function createWorkState(planPath: string, sessionId: string, agent?: string, directory?: string): WorkState {
  const startSha = directory ? getHeadSha(directory) : undefined
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
    ...(agent !== undefined ? { agent } : {}),
    ...(startSha !== undefined ? { start_sha: startSha } : {}),
  }
}

/**
 * Get the current HEAD SHA of the git repo at the given directory.
 * Returns undefined if not a git repo or git is unavailable.
 */
export function getHeadSha(directory: string): string | undefined {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    return sha || undefined
  } catch {
    return undefined
  }
}

/**
 * Find all plan files in .weave/plans/, sorted by modification time (newest first).
 * Returns absolute paths.
 */
export function findPlans(directory: string): string[] {
  const plansDir = join(directory, PLANS_DIR)
  try {
    if (!existsSync(plansDir)) return []
    const files = readdirSync(plansDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const fullPath = join(plansDir, f)
        const stat = statSync(fullPath)
        return { path: fullPath, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.path)
    return files
  } catch {
    return []
  }
}

/**
 * Count checked and unchecked markdown checkboxes in a plan file.
 * Returns isComplete: true if file is missing, has 0 checkboxes, or all are checked.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true }
  }
  try {
    const content = readFileSync(planPath, "utf-8")
    const unchecked = content.match(UNCHECKED_RE) || []
    const checked = content.match(CHECKED_RE) || []
    const total = unchecked.length + checked.length
    const completed = checked.length
    return {
      total,
      completed,
      isComplete: total === 0 || completed === total,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: true }
  }
}

/**
 * Extract plan name from file path (basename minus .md extension).
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, ".md")
}

/**
 * Pause work by setting paused: true in the work state.
 * Returns false if no state exists (e.g., no active plan).
 */
export function pauseWork(directory: string): boolean {
  const state = readWorkState(directory)
  if (!state) return false
  state.paused = true
  return writeWorkState(directory, state)
}

/**
 * Resume work by setting paused: false in the work state.
 * Returns false if no state exists.
 */
export function resumeWork(directory: string): boolean {
  const state = readWorkState(directory)
  if (!state) return false
  state.paused = false
  return writeWorkState(directory, state)
}
