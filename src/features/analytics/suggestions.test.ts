import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { generateSuggestions, getSuggestionsForProject } from "./suggestions"
import { appendSessionSummary } from "./storage"
import type { SessionSummary, TokenUsage } from "./types"

let tempDir: string

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "s1",
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

beforeEach(() => {
  tempDir = join(tmpdir(), `weave-suggest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("generateSuggestions", () => {
  it("returns empty array when fewer than 3 sessions", () => {
    const summaries = [makeSummary({ sessionId: "s1" }), makeSummary({ sessionId: "s2" })]
    expect(generateSuggestions(summaries)).toEqual([])
  })

  it("returns empty array for empty input", () => {
    expect(generateSuggestions([])).toEqual([])
  })

  it("detects high tool usage (>50 avg calls per session)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 60,
        toolUsage: [{ tool: "read", count: 60 }],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "high-tool-usage")).toBe(true)
  })

  it("does not flag high tool usage when under threshold", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [{ tool: "read", count: 10 }],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "high-tool-usage")).toBe(false)
  })

  it("detects read-heavy sessions (>60% reads)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [
          { tool: "read", count: 8 },
          { tool: "write", count: 2 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "read-heavy")).toBe(true)
  })

  it("does not flag read-heavy when balanced", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 10,
        toolUsage: [
          { tool: "read", count: 4 },
          { tool: "write", count: 3 },
          { tool: "grep", count: 3 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "read-heavy")).toBe(false)
  })

  it("detects low delegation with enough sessions", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "low-delegation")).toBe(true)
  })

  it("does not flag low delegation with insufficient sessions", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    // 3 sessions < 5 minimum for low-delegation suggestion
    expect(suggestions.some((s) => s.id === "low-delegation")).toBe(false)
  })

  it("detects slow delegations (>60s average)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 1,
        delegations: [
          { agent: "pattern", toolCallId: `c${i}`, durationMs: 90_000 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "slow-delegation-pattern")).toBe(true)
  })

  it("does not flag fast delegations", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalDelegations: 1,
        delegations: [
          { agent: "thread", toolCallId: `c${i}`, durationMs: 5_000 },
        ],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id?.startsWith("slow-delegation"))).toBe(false)
  })

  it("detects many short sessions (>30% under 30s)", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        durationMs: i < 3 ? 10_000 : 300_000, // 3 out of 5 are short
        totalToolCalls: 5,
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "many-short-sessions")).toBe(true)
  })

  it("detects many long sessions (>30% over 30 minutes)", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        durationMs: i < 3 ? 35 * 60 * 1000 : 300_000, // 3 out of 5 are long
      }),
    )
    const suggestions = generateSuggestions(summaries)
    expect(suggestions.some((s) => s.id === "many-long-sessions")).toBe(true)
  })

  it("all suggestions have required fields", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `s${i}`,
        totalToolCalls: 60,
        toolUsage: [{ tool: "read", count: 60 }],
        totalDelegations: 0,
        delegations: [],
      }),
    )
    const suggestions = generateSuggestions(summaries)
    for (const s of suggestions) {
      expect(s.id).toBeTruthy()
      expect(s.text).toBeTruthy()
      expect(["tool-usage", "delegation", "workflow", "token-usage"]).toContain(s.category)
      expect(["high", "medium", "low"]).toContain(s.confidence)
    }
  })

  describe("token usage suggestions", () => {
    function makeTokenUsage(overrides?: Partial<TokenUsage>): TokenUsage {
      return {
        inputTokens: 50_000,
        outputTokens: 10_000,
        reasoningTokens: 5_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 5_000,
        totalMessages: 10,
        ...overrides,
      }
    }

    it("detects high token usage (>100k avg input tokens)", () => {
      const summaries = Array.from({ length: 3 }, (_, i) =>
        makeSummary({
          sessionId: `s${i}`,
          tokenUsage: makeTokenUsage({ inputTokens: 150_000 }),
        }),
      )
      const suggestions = generateSuggestions(summaries)
      expect(suggestions.some((s) => s.id === "high-token-usage")).toBe(true)
    })

    it("does not flag high token usage when under threshold", () => {
      const summaries = Array.from({ length: 3 }, (_, i) =>
        makeSummary({
          sessionId: `s${i}`,
          tokenUsage: makeTokenUsage({ inputTokens: 50_000 }),
        }),
      )
      const suggestions = generateSuggestions(summaries)
      expect(suggestions.some((s) => s.id === "high-token-usage")).toBe(false)
    })

    it("detects low cache hit ratio (<30%)", () => {
      const summaries = Array.from({ length: 3 }, (_, i) =>
        makeSummary({
          sessionId: `s${i}`,
          tokenUsage: makeTokenUsage({
            inputTokens: 100_000,
            cacheReadTokens: 10_000, // 10% ratio
          }),
        }),
      )
      const suggestions = generateSuggestions(summaries)
      expect(suggestions.some((s) => s.id === "low-cache-hit-ratio")).toBe(true)
    })

    it("does not flag cache ratio when above threshold", () => {
      const summaries = Array.from({ length: 3 }, (_, i) =>
        makeSummary({
          sessionId: `s${i}`,
          tokenUsage: makeTokenUsage({
            inputTokens: 100_000,
            cacheReadTokens: 50_000, // 50% ratio
          }),
        }),
      )
      const suggestions = generateSuggestions(summaries)
      expect(suggestions.some((s) => s.id === "low-cache-hit-ratio")).toBe(false)
    })

    it("gracefully handles summaries without tokenUsage field", () => {
      // Mix of old (no tokenUsage) and new summaries — fewer than 3 with tokens
      const summaries = [
        makeSummary({ sessionId: "s1" }), // no tokenUsage
        makeSummary({ sessionId: "s2" }), // no tokenUsage
        makeSummary({
          sessionId: "s3",
          tokenUsage: makeTokenUsage({ inputTokens: 200_000 }),
        }),
      ]
      const suggestions = generateSuggestions(summaries)
      // Should not generate token suggestions (only 1 session with tokens < 3 minimum)
      expect(suggestions.some((s) => s.category === "token-usage")).toBe(false)
    })

    it("skips token suggestions when fewer than 3 sessions have token data", () => {
      const summaries = Array.from({ length: 5 }, (_, i) =>
        makeSummary({ sessionId: `s${i}` }),
      )
      // 5 sessions but none have tokenUsage
      const suggestions = generateSuggestions(summaries)
      expect(suggestions.some((s) => s.category === "token-usage")).toBe(false)
    })
  })
})

describe("getSuggestionsForProject", () => {
  it("returns suggestions based on stored summaries", () => {
    // Store 5 sessions with high tool usage
    for (let i = 0; i < 5; i++) {
      appendSessionSummary(
        tempDir,
        makeSummary({
          sessionId: `s${i}`,
          totalToolCalls: 60,
          toolUsage: [{ tool: "read", count: 60 }],
          totalDelegations: 0,
        }),
      )
    }

    const suggestions = getSuggestionsForProject(tempDir)
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it("returns empty array when no summaries exist", () => {
    const suggestions = getSuggestionsForProject(tempDir)
    expect(suggestions).toEqual([])
  })
})
