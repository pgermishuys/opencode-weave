import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { aggregateTokensForPlan } from "./plan-token-aggregator"
import { appendSessionSummary } from "./storage"
import type { SessionSummary, TokenUsage } from "./types"

let tempDir: string

function makeTokenUsage(vals: {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}): TokenUsage {
  return {
    inputTokens: vals.input,
    outputTokens: vals.output,
    reasoningTokens: vals.reasoning,
    cacheReadTokens: vals.cacheRead,
    cacheWriteTokens: vals.cacheWrite,
    totalMessages: 1,
  }
}

function makeSummary(
  sessionId: string,
  tokenUsage?: TokenUsage,
): SessionSummary {
  return {
    sessionId,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    toolUsage: [],
    delegations: [],
    totalToolCalls: 0,
    totalDelegations: 0,
    tokenUsage,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-token-agg-test-"))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("aggregateTokensForPlan", () => {
  it("sums token usage for matching session IDs", () => {
    appendSessionSummary(
      tempDir,
      makeSummary("s1", makeTokenUsage({ input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 })),
    )
    appendSessionSummary(
      tempDir,
      makeSummary("s2", makeTokenUsage({ input: 200, output: 100, reasoning: 20, cacheRead: 10, cacheWrite: 4 })),
    )
    appendSessionSummary(
      tempDir,
      makeSummary("s3", makeTokenUsage({ input: 999, output: 999, reasoning: 999, cacheRead: 999, cacheWrite: 999 })),
    )

    const result = aggregateTokensForPlan(tempDir, ["s1", "s2"])
    expect(result.input).toBe(300)
    expect(result.output).toBe(150)
    expect(result.reasoning).toBe(30)
    expect(result.cacheRead).toBe(15)
    expect(result.cacheWrite).toBe(6)
  })

  it("returns zeros when no sessions match", () => {
    appendSessionSummary(
      tempDir,
      makeSummary("s1", makeTokenUsage({ input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 })),
    )

    const result = aggregateTokensForPlan(tempDir, ["nonexistent"])
    expect(result.input).toBe(0)
    expect(result.output).toBe(0)
    expect(result.reasoning).toBe(0)
    expect(result.cacheRead).toBe(0)
    expect(result.cacheWrite).toBe(0)
  })

  it("returns zeros for sessions without tokenUsage (backward compat)", () => {
    appendSessionSummary(tempDir, makeSummary("s1"))
    appendSessionSummary(tempDir, makeSummary("s2"))

    const result = aggregateTokensForPlan(tempDir, ["s1", "s2"])
    expect(result.input).toBe(0)
    expect(result.output).toBe(0)
  })

  it("handles mix of sessions with and without tokenUsage", () => {
    appendSessionSummary(
      tempDir,
      makeSummary("s1", makeTokenUsage({ input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2 })),
    )
    appendSessionSummary(tempDir, makeSummary("s2")) // no tokenUsage

    const result = aggregateTokensForPlan(tempDir, ["s1", "s2"])
    expect(result.input).toBe(100)
    expect(result.output).toBe(50)
  })

  it("returns zeros when no summaries file exists", () => {
    const result = aggregateTokensForPlan(tempDir, ["s1"])
    expect(result.input).toBe(0)
    expect(result.output).toBe(0)
  })
})
