import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { writeMetricsReport, readMetricsReports } from "./storage"
import { MAX_METRICS_ENTRIES } from "./types"
import type { MetricsReport } from "./types"

let tempDir: string

function makeReport(overrides?: Partial<MetricsReport>): MetricsReport {
  return {
    planName: "test-plan",
    generatedAt: "2026-01-01T00:00:00.000Z",
    adherence: {
      coverage: 0.8,
      precision: 0.9,
      plannedFilesChanged: ["a.ts", "b.ts"],
      unplannedChanges: ["c.ts"],
      missedFiles: ["d.ts"],
      totalPlannedFiles: 3,
      totalActualFiles: 3,
    },
    quality: undefined,
    gaps: undefined,
    tokenUsage: {
      input: 1000,
      output: 500,
      reasoning: 200,
      cacheRead: 100,
      cacheWrite: 50,
    },
    durationMs: 300_000,
    sessionCount: 2,
    startSha: "abc123",
    sessionIds: ["s1", "s2"],
    ...overrides,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-metrics-storage-test-"))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("writeMetricsReport / readMetricsReports", () => {
  it("writes a report and reads it back", () => {
    const report = makeReport()
    const ok = writeMetricsReport(tempDir, report)
    expect(ok).toBe(true)

    const reports = readMetricsReports(tempDir)
    expect(reports.length).toBe(1)
    expect(reports[0].planName).toBe("test-plan")
    expect(reports[0].adherence.coverage).toBe(0.8)
    expect(reports[0].adherence.precision).toBe(0.9)
    expect(reports[0].tokenUsage.input).toBe(1000)
    expect(reports[0].sessionIds).toEqual(["s1", "s2"])
  })

  it("appends multiple reports as separate JSONL lines", () => {
    writeMetricsReport(tempDir, makeReport({ planName: "plan-a" }))
    writeMetricsReport(tempDir, makeReport({ planName: "plan-b" }))
    writeMetricsReport(tempDir, makeReport({ planName: "plan-c" }))

    const reports = readMetricsReports(tempDir)
    expect(reports.length).toBe(3)
    expect(reports.map((r) => r.planName)).toEqual(["plan-a", "plan-b", "plan-c"])
  })

  it("returns empty array when no reports file exists", () => {
    const reports = readMetricsReports(tempDir)
    expect(reports).toEqual([])
  })

  it("preserves Phase 1 reports with undefined quality and gaps", () => {
    const report = makeReport({ quality: undefined, gaps: undefined })
    writeMetricsReport(tempDir, report)

    const reports = readMetricsReports(tempDir)
    expect(reports[0].quality).toBeUndefined()
    expect(reports[0].gaps).toBeUndefined()
    expect(reports[0].adherence).toBeDefined()
  })

  it("preserves optional endSha field", () => {
    const report = makeReport({ endSha: "def456" })
    writeMetricsReport(tempDir, report)

    const reports = readMetricsReports(tempDir)
    expect(reports[0].endSha).toBe("def456")
  })

  it("rotates entries when exceeding MAX_METRICS_ENTRIES", () => {
    const overshoot = 5
    const total = MAX_METRICS_ENTRIES + overshoot
    for (let i = 0; i < total; i++) {
      writeMetricsReport(tempDir, makeReport({ planName: `plan-${i}` }))
    }
    const reports = readMetricsReports(tempDir)
    expect(reports.length).toBe(MAX_METRICS_ENTRIES)
    // Should keep the most recent entries
    expect(reports[0].planName).toBe(`plan-${overshoot}`)
    expect(reports[reports.length - 1].planName).toBe(`plan-${total - 1}`)
  })

  it("round-trips all adherence sub-fields", () => {
    const report = makeReport({
      adherence: {
        coverage: 2 / 3,
        precision: 1 / 3,
        plannedFilesChanged: ["x.ts"],
        unplannedChanges: ["y.ts", "z.ts"],
        missedFiles: ["w.ts"],
        totalPlannedFiles: 2,
        totalActualFiles: 3,
      },
    })
    writeMetricsReport(tempDir, report)

    const reports = readMetricsReports(tempDir)
    expect(reports[0].adherence.coverage).toBeCloseTo(2 / 3)
    expect(reports[0].adherence.precision).toBeCloseTo(1 / 3)
    expect(reports[0].adherence.plannedFilesChanged).toEqual(["x.ts"])
    expect(reports[0].adherence.unplannedChanges).toEqual(["y.ts", "z.ts"])
    expect(reports[0].adherence.missedFiles).toEqual(["w.ts"])
  })
})
