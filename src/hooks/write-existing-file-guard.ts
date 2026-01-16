import * as fs from "fs"
import { log } from "../shared/log"

export interface WriteGuardState {
  readFiles: Set<string>
}

export function createWriteGuardState(): WriteGuardState {
  return { readFiles: new Set() }
}

export function trackFileRead(state: WriteGuardState, filePath: string): void {
  state.readFiles.add(filePath)
}

export interface WriteGuardCheckResult {
  allowed: boolean
  warning?: string
}

export function checkWriteAllowed(state: WriteGuardState, filePath: string): WriteGuardCheckResult {
  if (!fs.existsSync(filePath)) {
    return { allowed: true }
  }
  if (state.readFiles.has(filePath)) {
    return { allowed: true }
  }
  const warning = `⚠️ Write guard: Attempting to write to '${filePath}' without reading it first. Read the file before overwriting to avoid data loss.`
  log(`[write-guard] BLOCKED write to unread file: ${filePath}`)
  return { allowed: false, warning }
}

export function createWriteGuard(state: WriteGuardState) {
  return {
    trackRead: (filePath: string) => trackFileRead(state, filePath),
    checkWrite: (filePath: string) => checkWriteAllowed(state, filePath),
  }
}
