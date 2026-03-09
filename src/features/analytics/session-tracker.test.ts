import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { SessionTracker, createSessionTracker } from "./session-tracker"
import { readSessionSummaries } from "./storage"

let tempDir: string
let tracker: SessionTracker

beforeEach(() => {
  tempDir = join(tmpdir(), `weave-tracker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
  tracker = createSessionTracker(tempDir)
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

describe("SessionTracker", () => {
  describe("startSession", () => {
    it("creates a new tracked session", () => {
      const session = tracker.startSession("s1")
      expect(session.sessionId).toBe("s1")
      expect(session.startedAt).toBeTruthy()
      expect(session.toolCounts).toEqual({})
      expect(session.delegations).toEqual([])
      expect(session.inFlight).toEqual({})
    })

    it("is idempotent — returns same session on second call", () => {
      const first = tracker.startSession("s1")
      const second = tracker.startSession("s1")
      expect(first).toBe(second)
      expect(first.startedAt).toBe(second.startedAt)
    })
  })

  describe("trackToolStart", () => {
    it("increments tool count", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolStart("s1", "read", "c2")
      tracker.trackToolStart("s1", "write", "c3")

      const session = tracker.getSession("s1")!
      expect(session.toolCounts.read).toBe(2)
      expect(session.toolCounts.write).toBe(1)
    })

    it("tracks in-flight calls", () => {
      tracker.trackToolStart("s1", "task", "c1", "thread")

      const session = tracker.getSession("s1")!
      expect(session.inFlight.c1).toBeDefined()
      expect(session.inFlight.c1.tool).toBe("task")
      expect(session.inFlight.c1.agent).toBe("thread")
    })

    it("lazily starts the session", () => {
      expect(tracker.isTracking("s1")).toBe(false)
      tracker.trackToolStart("s1", "read", "c1")
      expect(tracker.isTracking("s1")).toBe(true)
    })
  })

  describe("trackToolEnd", () => {
    it("removes in-flight tracking", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")

      const session = tracker.getSession("s1")!
      expect(session.inFlight.c1).toBeUndefined()
    })

    it("records delegation for task tool calls", () => {
      tracker.trackToolStart("s1", "task", "c1", "thread")
      tracker.trackToolEnd("s1", "task", "c1", "thread")

      const session = tracker.getSession("s1")!
      expect(session.delegations.length).toBe(1)
      expect(session.delegations[0].agent).toBe("thread")
      expect(session.delegations[0].toolCallId).toBe("c1")
      expect(session.delegations[0].durationMs).toBeDefined()
      expect(session.delegations[0].durationMs!).toBeGreaterThanOrEqual(0)
    })

    it("does not record delegation for non-task tools", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")

      const session = tracker.getSession("s1")!
      expect(session.delegations.length).toBe(0)
    })

    it("is safe to call for untracked sessions", () => {
      // Should not throw
      tracker.trackToolEnd("nonexistent", "read", "c1")
    })

    it("falls back to agent from inFlight if not provided on end", () => {
      tracker.trackToolStart("s1", "task", "c1", "weft")
      tracker.trackToolEnd("s1", "task", "c1")

      const session = tracker.getSession("s1")!
      expect(session.delegations[0].agent).toBe("weft")
    })
  })

  describe("trackTokenUsage", () => {
    it("accumulates tokens across multiple calls", () => {
      tracker.trackTokenUsage("s1", { input: 1000, output: 200, reasoning: 50, cacheRead: 300, cacheWrite: 100 })
      tracker.trackTokenUsage("s1", { input: 500, output: 100, reasoning: 25, cacheRead: 150, cacheWrite: 50 })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(1500)
      expect(session.tokenUsage.outputTokens).toBe(300)
      expect(session.tokenUsage.reasoningTokens).toBe(75)
      expect(session.tokenUsage.cacheReadTokens).toBe(450)
      expect(session.tokenUsage.cacheWriteTokens).toBe(150)
      expect(session.tokenUsage.totalMessages).toBe(2)
    })

    it("lazily creates session on first call", () => {
      expect(tracker.isTracking("s1")).toBe(false)
      tracker.trackTokenUsage("s1", { input: 100 })
      expect(tracker.isTracking("s1")).toBe(true)
    })

    it("handles missing/undefined token fields (treats as 0)", () => {
      tracker.trackTokenUsage("s1", { input: 500 })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(500)
      expect(session.tokenUsage.outputTokens).toBe(0)
      expect(session.tokenUsage.reasoningTokens).toBe(0)
      expect(session.tokenUsage.cacheReadTokens).toBe(0)
      expect(session.tokenUsage.cacheWriteTokens).toBe(0)
      expect(session.tokenUsage.totalMessages).toBe(1)
    })

    it("handles negative values (treats as 0)", () => {
      tracker.trackTokenUsage("s1", { input: -100, output: -50, reasoning: -10, cacheRead: -20, cacheWrite: -5 })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(0)
      expect(session.tokenUsage.outputTokens).toBe(0)
      expect(session.tokenUsage.reasoningTokens).toBe(0)
      expect(session.tokenUsage.cacheReadTokens).toBe(0)
      expect(session.tokenUsage.cacheWriteTokens).toBe(0)
      expect(session.tokenUsage.totalMessages).toBe(1)
    })

    it("handles NaN values (treats as 0)", () => {
      tracker.trackTokenUsage("s1", { input: NaN, output: Infinity })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(0)
      expect(session.tokenUsage.outputTokens).toBe(0)
      expect(session.tokenUsage.totalMessages).toBe(1)
    })

    it("tracks totalMessages count correctly", () => {
      tracker.trackTokenUsage("s1", { input: 100 })
      tracker.trackTokenUsage("s1", { input: 200 })
      tracker.trackTokenUsage("s1", { input: 300 })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.totalMessages).toBe(3)
    })

    it("multiple sessions accumulate independently", () => {
      tracker.trackTokenUsage("s1", { input: 1000, output: 200 })
      tracker.trackTokenUsage("s2", { input: 500, output: 100 })
      tracker.trackTokenUsage("s1", { input: 1000, output: 200 })

      const s1 = tracker.getSession("s1")!
      const s2 = tracker.getSession("s2")!
      expect(s1.tokenUsage.inputTokens).toBe(2000)
      expect(s1.tokenUsage.outputTokens).toBe(400)
      expect(s1.tokenUsage.totalMessages).toBe(2)
      expect(s2.tokenUsage.inputTokens).toBe(500)
      expect(s2.tokenUsage.outputTokens).toBe(100)
      expect(s2.tokenUsage.totalMessages).toBe(1)
    })
  })

  describe("endSession", () => {
    it("produces a session summary", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")
      tracker.trackToolStart("s1", "write", "c2")
      tracker.trackToolEnd("s1", "write", "c2")
      tracker.trackToolStart("s1", "task", "c3", "thread")
      tracker.trackToolEnd("s1", "task", "c3", "thread")

      const summary = tracker.endSession("s1")
      expect(summary).not.toBeNull()
      expect(summary!.sessionId).toBe("s1")
      expect(summary!.totalToolCalls).toBe(3)
      expect(summary!.totalDelegations).toBe(1)
      expect(summary!.toolUsage.length).toBe(3)
      expect(summary!.durationMs).toBeGreaterThanOrEqual(0)
    })

    it("persists summary to JSONL", () => {
      tracker.trackToolStart("s1", "read", "c1")
      tracker.trackToolEnd("s1", "read", "c1")
      tracker.endSession("s1")

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].sessionId).toBe("s1")
    })

    it("removes session from tracking", () => {
      tracker.startSession("s1")
      expect(tracker.isTracking("s1")).toBe(true)
      tracker.endSession("s1")
      expect(tracker.isTracking("s1")).toBe(false)
    })

    it("returns null for untracked sessions", () => {
      const summary = tracker.endSession("nonexistent")
      expect(summary).toBeNull()
    })

    it("includes tokenUsage in summary when tokens were tracked", () => {
      tracker.trackTokenUsage("s1", { input: 1000, output: 200, reasoning: 50, cacheRead: 300, cacheWrite: 100 })
      tracker.trackTokenUsage("s1", { input: 500, output: 100 })

      const summary = tracker.endSession("s1")
      expect(summary).not.toBeNull()
      expect(summary!.tokenUsage).toBeDefined()
      expect(summary!.tokenUsage!.inputTokens).toBe(1500)
      expect(summary!.tokenUsage!.outputTokens).toBe(300)
      expect(summary!.tokenUsage!.reasoningTokens).toBe(50)
      expect(summary!.tokenUsage!.cacheReadTokens).toBe(300)
      expect(summary!.tokenUsage!.cacheWriteTokens).toBe(100)
      expect(summary!.tokenUsage!.totalMessages).toBe(2)
    })

    it("omits tokenUsage when no tokens were tracked", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")
      expect(summary).not.toBeNull()
      expect(summary!.tokenUsage).toBeUndefined()
    })

    it("persists tokenUsage in JSONL and reads back correctly", () => {
      tracker.trackTokenUsage("s1", { input: 5000, output: 1000, reasoning: 200, cacheRead: 800, cacheWrite: 150 })
      tracker.endSession("s1")

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].tokenUsage).toBeDefined()
      expect(summaries[0].tokenUsage!.inputTokens).toBe(5000)
      expect(summaries[0].tokenUsage!.outputTokens).toBe(1000)
      expect(summaries[0].tokenUsage!.reasoningTokens).toBe(200)
      expect(summaries[0].tokenUsage!.cacheReadTokens).toBe(800)
      expect(summaries[0].tokenUsage!.cacheWriteTokens).toBe(150)
      expect(summaries[0].tokenUsage!.totalMessages).toBe(1)
    })

    it("handles backward compat — old summaries without tokenUsage read fine", () => {
      // Write an old-format summary directly (no tokenUsage field)
      const { appendSessionSummary: appendFn } = require("./storage")
      appendFn(tempDir, {
        sessionId: "old-s1",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: "2025-01-01T00:05:00.000Z",
        durationMs: 300_000,
        toolUsage: [{ tool: "read", count: 5 }],
        delegations: [],
        totalToolCalls: 5,
        totalDelegations: 0,
        // intentionally no tokenUsage
      })

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].sessionId).toBe("old-s1")
      expect(summaries[0].tokenUsage).toBeUndefined()
    })
  })

  describe("activeSessionCount", () => {
    it("tracks number of active sessions", () => {
      expect(tracker.activeSessionCount).toBe(0)
      tracker.startSession("s1")
      expect(tracker.activeSessionCount).toBe(1)
      tracker.startSession("s2")
      expect(tracker.activeSessionCount).toBe(2)
      tracker.endSession("s1")
      expect(tracker.activeSessionCount).toBe(1)
    })
  })
})

describe("createSessionTracker", () => {
  it("creates a SessionTracker instance", () => {
    const t = createSessionTracker(tempDir)
    expect(t).toBeInstanceOf(SessionTracker)
  })
})
