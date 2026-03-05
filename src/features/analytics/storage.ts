import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import type { SessionSummary, ProjectFingerprint } from "./types"
import { ANALYTICS_DIR, SESSION_SUMMARIES_FILE, FINGERPRINT_FILE } from "./types"

/** Maximum number of session summary entries to keep in the JSONL file */
export const MAX_SESSION_ENTRIES = 1000

/**
 * Ensure the analytics directory exists, creating it if needed.
 * Returns the absolute path to the analytics directory.
 */
export function ensureAnalyticsDir(directory: string): string {
  const dir = join(directory, ANALYTICS_DIR)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * Append a session summary to the JSONL file.
 * Auto-creates the analytics directory if needed.
 */
export function appendSessionSummary(directory: string, summary: SessionSummary): boolean {
  try {
    const dir = ensureAnalyticsDir(directory)
    const filePath = join(dir, SESSION_SUMMARIES_FILE)
    const line = JSON.stringify(summary) + "\n"
    appendFileSync(filePath, line, { encoding: "utf-8", mode: 0o600 })

    // Rotate if needed — trim to MAX_SESSION_ENTRIES
    try {
      const content = readFileSync(filePath, "utf-8")
      const lines = content.split("\n").filter((l) => l.trim().length > 0)
      if (lines.length > MAX_SESSION_ENTRIES) {
        const trimmed = lines.slice(-MAX_SESSION_ENTRIES).join("\n") + "\n"
        writeFileSync(filePath, trimmed, { encoding: "utf-8", mode: 0o600 })
      }
    } catch {
      // rotation failure is non-fatal
    }

    return true
  } catch {
    return false
  }
}

/**
 * Read all session summaries from the JSONL file.
 * Returns an empty array if the file doesn't exist or is unparseable.
 */
export function readSessionSummaries(directory: string): SessionSummary[] {
  const filePath = join(directory, ANALYTICS_DIR, SESSION_SUMMARIES_FILE)
  try {
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim().length > 0)
    const summaries: SessionSummary[] = []
    for (const line of lines) {
      try {
        summaries.push(JSON.parse(line) as SessionSummary)
      } catch {
        // skip malformed lines
      }
    }
    return summaries
  } catch {
    return []
  }
}

/**
 * Write a project fingerprint to the analytics directory.
 * Auto-creates the analytics directory if needed.
 */
export function writeFingerprint(directory: string, fingerprint: ProjectFingerprint): boolean {
  try {
    const dir = ensureAnalyticsDir(directory)
    const filePath = join(dir, FINGERPRINT_FILE)
    writeFileSync(filePath, JSON.stringify(fingerprint, null, 2), { encoding: "utf-8", mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/**
 * Read the project fingerprint from the analytics directory.
 * Returns null if the file doesn't exist or is unparseable.
 */
export function readFingerprint(directory: string): ProjectFingerprint | null {
  const filePath = join(directory, ANALYTICS_DIR, FINGERPRINT_FILE)
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.stack)) return null
    return parsed as ProjectFingerprint
  } catch {
    return null
  }
}
