import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { SessionTracker, createSessionTracker } from "./session-tracker"
import { readSessionSummaries, appendSessionSummary } from "./storage"

let tempDir: string
let tracker: SessionTracker

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "weave-tracker-test-"))
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

    it("records delegation for executed Thread, Weft, and Warp task tool calls", () => {
      tracker.trackToolStart("s1", "task", "c1", "thread")
      tracker.trackToolEnd("s1", "task", "c1", "thread")
      tracker.trackToolStart("s1", "task", "c2", "weft")
      tracker.trackToolEnd("s1", "task", "c2", "weft")
      tracker.trackToolStart("s1", "task", "c3", "warp")
      tracker.trackToolEnd("s1", "task", "c3", "warp")

      const session = tracker.getSession("s1")!
      expect(session.delegations.map(({ agent, toolCallId }) => ({ agent, toolCallId }))).toEqual([
        { agent: "thread", toolCallId: "c1" },
        { agent: "weft", toolCallId: "c2" },
        { agent: "warp", toolCallId: "c3" },
      ])
      for (const delegation of session.delegations) {
        expect(delegation.durationMs).toBeDefined()
        expect(delegation.durationMs!).toBeGreaterThanOrEqual(0)
      }
    })

    it("does not record delegation for call_weave_agent because runtime delegation evidence is task-only", () => {
      tracker.trackToolStart("s1", "call_weave_agent", "c1", "weft")
      tracker.trackToolEnd("s1", "call_weave_agent", "c1", "weft")

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
      const appendFn = appendSessionSummary
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

  describe("setAgentName", () => {
    it("stores agent name on session", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom (Main Orchestrator)")
      const session = tracker.getSession("s1")!
      expect(session.agentName).toBe("Loom (Main Orchestrator)")
    })

    it("is idempotent — first call wins", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom")
      tracker.setAgentName("s1", "Tapestry")
      const session = tracker.getSession("s1")!
      expect(session.agentName).toBe("Loom")
    })

    it("is safe to call for untracked sessions", () => {
      // Should not throw
      tracker.setAgentName("nonexistent", "Loom")
    })
  })

  describe("trackModel", () => {
    it("stores model ID on session", () => {
      tracker.startSession("s1")
      tracker.trackModel("s1", "claude-sonnet-4-20250514")
      const session = tracker.getSession("s1")!
      expect(session.model).toBe("claude-sonnet-4-20250514")
    })

    it("is idempotent — first call wins", () => {
      tracker.startSession("s1")
      tracker.trackModel("s1", "claude-opus-4")
      tracker.trackModel("s1", "claude-sonnet-4-20250514")
      const session = tracker.getSession("s1")!
      expect(session.model).toBe("claude-opus-4")
    })

    it("is safe to call for untracked sessions — no-op, no throw", () => {
      // Should not throw
      tracker.trackModel("nonexistent", "claude-sonnet-4-20250514")
    })

    it("includes model in endSession summary", () => {
      tracker.startSession("s1")
      tracker.trackModel("s1", "claude-sonnet-4-20250514")
      const summary = tracker.endSession("s1")!
      expect(summary.model).toBe("claude-sonnet-4-20250514")
    })

    it("omits model from summary when not set", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.model).toBeUndefined()
    })

    it("persists model in JSONL and reads back correctly", () => {
      tracker.startSession("s1")
      tracker.trackModel("s1", "gpt-4o")
      tracker.endSession("s1")

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].model).toBe("gpt-4o")
    })

    it("old JSONL entries without model field parse correctly (undefined)", () => {
      appendSessionSummary(tempDir, {
        sessionId: "old-s1",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: "2025-01-01T00:05:00.000Z",
        durationMs: 300_000,
        toolUsage: [],
        delegations: [],
        totalToolCalls: 0,
        totalDelegations: 0,
        // intentionally no model field
      })

      const summaries = readSessionSummaries(tempDir)
      expect(summaries.length).toBe(1)
      expect(summaries[0].model).toBeUndefined()
    })
  })

  describe("trackCost", () => {
    it("accumulates cost across multiple calls", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", 0.05)
      tracker.trackCost("s1", 0.03)
      tracker.trackCost("s1", 0.02)
      const session = tracker.getSession("s1")!
      expect(session.totalCost).toBeCloseTo(0.10, 10)
    })

    it("is safe to call for untracked sessions", () => {
      tracker.trackCost("nonexistent", 0.05)
    })
  })

  describe("trackTokenUsage", () => {
    it("accumulates all token fields and increments totalMessages", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 })
      tracker.trackTokenUsage("s1", { input: 200, output: 100, reasoning: 20, cacheRead: 40, cacheWrite: 10 })

      const session = tracker.getSession("s1")!
      expect(session.tokenUsage.inputTokens).toBe(300)
      expect(session.tokenUsage.outputTokens).toBe(150)
      expect(session.tokenUsage.reasoningTokens).toBe(30)
      expect(session.tokenUsage.cacheReadTokens).toBe(60)
      expect(session.tokenUsage.cacheWriteTokens).toBe(15)
      expect(session.tokenUsage.totalMessages).toBe(2)
    })

    it("is safe to call for untracked sessions", () => {
      tracker.trackTokenUsage("nonexistent", { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 })
    })
  })

  describe("endSession with new fields", () => {
    it("includes agentName, totalCost, and tokenUsage in summary", () => {
      tracker.startSession("s1")
      tracker.setAgentName("s1", "Loom")
      tracker.trackCost("s1", 0.05)
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 })

      const summary = tracker.endSession("s1")!
      expect(summary.agentName).toBe("Loom")
      expect(summary.totalCost).toBeCloseTo(0.05, 10)
      expect(summary.tokenUsage).toBeDefined()
      expect(summary.tokenUsage!.inputTokens).toBe(100)
      expect(summary.tokenUsage!.outputTokens).toBe(50)
      expect(summary.tokenUsage!.totalMessages).toBe(1)
    })

    it("omits agentName when not set (undefined)", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.agentName).toBeUndefined()
    })

    it("omits totalCost when no cost tracked", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBeUndefined()
    })

    it("omits tokenUsage when no messages tracked", () => {
      tracker.startSession("s1")
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage).toBeUndefined()
    })

    it("includes totalCost when cost was tracked", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", 0.05)
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBe(0.05)
    })

    it("includes tokenUsage when messages were tracked", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage).toBeDefined()
      expect(summary.tokenUsage!.totalMessages).toBe(1)
    })

    it("trackCost ignores NaN and negative values", () => {
      tracker.startSession("s1")
      tracker.trackCost("s1", NaN)
      tracker.trackCost("s1", -5)
      tracker.trackCost("s1", 0.10)
      const summary = tracker.endSession("s1")!
      expect(summary.totalCost).toBe(0.10)
    })

    it("trackTokenUsage ignores NaN and negative token values", () => {
      tracker.startSession("s1")
      tracker.trackTokenUsage("s1", { input: NaN, output: -1, reasoning: 100, cacheRead: NaN, cacheWrite: 50 })
      const summary = tracker.endSession("s1")!
      expect(summary.tokenUsage!.inputTokens).toBe(0)
      expect(summary.tokenUsage!.outputTokens).toBe(0)
      expect(summary.tokenUsage!.reasoningTokens).toBe(100)
      expect(summary.tokenUsage!.cacheReadTokens).toBe(0)
      expect(summary.tokenUsage!.cacheWriteTokens).toBe(50)
    })
  })
})

describe("createSessionTracker", () => {
  it("creates a SessionTracker instance", () => {
    const t = createSessionTracker(tempDir)
    expect(t).toBeInstanceOf(SessionTracker)
  })
})
