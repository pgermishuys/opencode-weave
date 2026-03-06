import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  ensureAnalyticsDir,
  appendSessionSummary,
  readSessionSummaries,
  writeFingerprint,
  readFingerprint,
  MAX_SESSION_ENTRIES,
} from "./storage"
import { ANALYTICS_DIR, SESSION_SUMMARIES_FILE, FINGERPRINT_FILE } from "./types"
import type { SessionSummary, ProjectFingerprint } from "./types"
import { getWeaveVersion } from "../../shared/version"

let tempDir: string

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    toolUsage: [{ tool: "read", count: 5 }],
    delegations: [],
    totalToolCalls: 5,
    totalDelegations: 0,
    ...overrides,
  }
}

function makeFingerprint(overrides?: Partial<ProjectFingerprint>): ProjectFingerprint {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    stack: [{ name: "typescript", confidence: "high", evidence: "tsconfig.json exists" }],
    isMonorepo: false,
    packageManager: "bun",
    primaryLanguage: "typescript",
    weaveVersion: getWeaveVersion(),
    ...overrides,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-analytics-test-"))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("ensureAnalyticsDir", () => {
  it("creates the analytics directory when it does not exist", () => {
    const dir = ensureAnalyticsDir(tempDir)
    expect(existsSync(dir)).toBe(true)
    expect(dir).toBe(join(tempDir, ANALYTICS_DIR))
  })

  it("is idempotent — does not fail if directory already exists", () => {
    ensureAnalyticsDir(tempDir)
    const dir = ensureAnalyticsDir(tempDir)
    expect(existsSync(dir)).toBe(true)
  })
})

describe("appendSessionSummary / readSessionSummaries", () => {
  it("appends a summary and reads it back", () => {
    const summary = makeSummary()
    const ok = appendSessionSummary(tempDir, summary)
    expect(ok).toBe(true)

    const summaries = readSessionSummaries(tempDir)
    expect(summaries.length).toBe(1)
    expect(summaries[0].sessionId).toBe("sess-1")
    expect(summaries[0].totalToolCalls).toBe(5)
  })

  it("appends multiple summaries as separate JSONL lines", () => {
    appendSessionSummary(tempDir, makeSummary({ sessionId: "s1" }))
    appendSessionSummary(tempDir, makeSummary({ sessionId: "s2" }))
    appendSessionSummary(tempDir, makeSummary({ sessionId: "s3" }))

    const summaries = readSessionSummaries(tempDir)
    expect(summaries.length).toBe(3)
    expect(summaries.map((s) => s.sessionId)).toEqual(["s1", "s2", "s3"])
  })

  it("returns empty array when no summaries file exists", () => {
    const summaries = readSessionSummaries(tempDir)
    expect(summaries).toEqual([])
  })

  it("skips malformed JSONL lines without crashing", () => {
    const dir = ensureAnalyticsDir(tempDir)
    const filePath = join(dir, SESSION_SUMMARIES_FILE)
    const validLine = JSON.stringify(makeSummary({ sessionId: "valid" }))
    const content = `${validLine}\n{broken json\n${validLine.replace("valid", "valid2")}\n`
    require("fs").writeFileSync(filePath, content, "utf-8")

    const summaries = readSessionSummaries(tempDir)
    expect(summaries.length).toBe(2)
    expect(summaries[0].sessionId).toBe("valid")
    expect(summaries[1].sessionId).toBe("valid2")
  })

  it("auto-creates analytics directory on append", () => {
    expect(existsSync(join(tempDir, ANALYTICS_DIR))).toBe(false)
    appendSessionSummary(tempDir, makeSummary())
    expect(existsSync(join(tempDir, ANALYTICS_DIR))).toBe(true)
  })

  it("rotates entries when exceeding MAX_SESSION_ENTRIES", () => {
    const overshoot = 5
    const total = MAX_SESSION_ENTRIES + overshoot
    for (let i = 0; i < total; i++) {
      appendSessionSummary(tempDir, makeSummary({ sessionId: `s-${i}` }))
    }
    const summaries = readSessionSummaries(tempDir)
    expect(summaries.length).toBe(MAX_SESSION_ENTRIES)
    // Should keep the most recent entries (last MAX_SESSION_ENTRIES)
    expect(summaries[0].sessionId).toBe(`s-${overshoot}`)
    expect(summaries[summaries.length - 1].sessionId).toBe(`s-${total - 1}`)
  })
})

describe("writeFingerprint / readFingerprint", () => {
  it("writes a fingerprint and reads it back", () => {
    const fp = makeFingerprint()
    const ok = writeFingerprint(tempDir, fp)
    expect(ok).toBe(true)

    const read = readFingerprint(tempDir)
    expect(read).not.toBeNull()
    expect(read!.primaryLanguage).toBe("typescript")
    expect(read!.stack.length).toBe(1)
    expect(read!.stack[0].name).toBe("typescript")
  })

  it("returns null when no fingerprint file exists", () => {
    const fp = readFingerprint(tempDir)
    expect(fp).toBeNull()
  })

  it("returns null for malformed fingerprint JSON", () => {
    const dir = ensureAnalyticsDir(tempDir)
    require("fs").writeFileSync(join(dir, FINGERPRINT_FILE), "{invalid}", "utf-8")
    const fp = readFingerprint(tempDir)
    expect(fp).toBeNull()
  })

  it("returns null when fingerprint lacks stack array", () => {
    const dir = ensureAnalyticsDir(tempDir)
    require("fs").writeFileSync(join(dir, FINGERPRINT_FILE), '{"generatedAt":"x"}', "utf-8")
    const fp = readFingerprint(tempDir)
    expect(fp).toBeNull()
  })

  it("auto-creates analytics directory on write", () => {
    expect(existsSync(join(tempDir, ANALYTICS_DIR))).toBe(false)
    writeFingerprint(tempDir, makeFingerprint())
    expect(existsSync(join(tempDir, ANALYTICS_DIR))).toBe(true)
  })

  it("overwrites existing fingerprint", () => {
    writeFingerprint(tempDir, makeFingerprint({ primaryLanguage: "go" }))
    writeFingerprint(tempDir, makeFingerprint({ primaryLanguage: "rust" }))
    const fp = readFingerprint(tempDir)
    expect(fp!.primaryLanguage).toBe("rust")
  })
})
