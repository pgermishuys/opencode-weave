import type {
  TrackedSession,
  SessionSummary,
  ToolUsageEntry,
  DelegationEntry,
  InFlightToolCall,
  TokenUsage,
} from "./types"
import { appendSessionSummary } from "./storage"
import { log } from "../../shared/log"

/**
 * SessionTracker tracks tool usage and delegations across sessions,
 * producing SessionSummary records when sessions end.
 *
 * Usage:
 * - Call `startSession()` when a session begins (or lazily on first tool call)
 * - Call `trackToolStart()` / `trackToolEnd()` on tool.execute.before/after
 * - Call `endSession()` when the session ends → writes summary to JSONL
 */
export class SessionTracker {
  private sessions = new Map<string, TrackedSession>()
  private directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  /**
   * Start tracking a session. Idempotent — if already tracking, returns existing.
   */
  startSession(sessionId: string): TrackedSession {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing

    const session: TrackedSession = {
      sessionId,
      startedAt: new Date().toISOString(),
      toolCounts: {},
      delegations: [],
      inFlight: {},
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalMessages: 0,
      },
    }
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Track a tool execution start. Lazily starts the session if needed.
   */
  trackToolStart(sessionId: string, toolName: string, callId: string, agent?: string): void {
    const session = this.startSession(sessionId)

    // Increment tool count
    session.toolCounts[toolName] = (session.toolCounts[toolName] ?? 0) + 1

    // Track in-flight for duration measurement
    const inFlight: InFlightToolCall = {
      tool: toolName,
      startedAt: Date.now(),
    }
    if (agent) {
      inFlight.agent = agent
    }
    session.inFlight[callId] = inFlight
  }

  /**
   * Track a tool execution end. Records delegation if it was a task tool.
   */
  trackToolEnd(sessionId: string, toolName: string, callId: string, agent?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const inFlight = session.inFlight[callId]
    delete session.inFlight[callId]

    // Record delegation for task tool calls
    if (toolName === "task") {
      const delegation: DelegationEntry = {
        agent: agent ?? inFlight?.agent ?? "unknown",
        toolCallId: callId,
      }
      if (inFlight) {
        delegation.durationMs = Date.now() - inFlight.startedAt
      }
      session.delegations.push(delegation)
    }
  }

  /**
   * Track token usage from a message.updated event.
   * Accumulates all token fields into the session's running totals.
   * Lazily starts the session if needed.
   */
  trackTokenUsage(
    sessionId: string,
    tokens: {
      input?: number
      output?: number
      reasoning?: number
      cacheRead?: number
      cacheWrite?: number
    },
  ): void {
    const session = this.startSession(sessionId)
    const safeNum = (v: number | undefined): number =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0

    session.tokenUsage.inputTokens += safeNum(tokens.input)
    session.tokenUsage.outputTokens += safeNum(tokens.output)
    session.tokenUsage.reasoningTokens += safeNum(tokens.reasoning)
    session.tokenUsage.cacheReadTokens += safeNum(tokens.cacheRead)
    session.tokenUsage.cacheWriteTokens += safeNum(tokens.cacheWrite)
    session.tokenUsage.totalMessages += 1
  }

  /**
   * End a session and persist the summary. Removes the session from tracking.
   * Returns the generated summary, or null if the session wasn't being tracked.
   */
  endSession(sessionId: string): SessionSummary | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    const now = new Date()
    const startedAt = new Date(session.startedAt)
    const durationMs = now.getTime() - startedAt.getTime()

    const toolUsage: ToolUsageEntry[] = Object.entries(session.toolCounts).map(
      ([tool, count]) => ({ tool, count }),
    )

    const totalToolCalls = toolUsage.reduce((sum, entry) => sum + entry.count, 0)

    const summary: SessionSummary = {
      sessionId,
      startedAt: session.startedAt,
      endedAt: now.toISOString(),
      durationMs,
      toolUsage,
      delegations: session.delegations,
      totalToolCalls,
      totalDelegations: session.delegations.length,
    }

    // Include token usage only when at least one message contributed token data
    if (session.tokenUsage.totalMessages > 0) {
      summary.tokenUsage = { ...session.tokenUsage }
    }

    // Persist to JSONL — fire-and-forget
    try {
      appendSessionSummary(this.directory, summary)
      log("[analytics] Session summary persisted", {
        sessionId,
        totalToolCalls,
        totalDelegations: session.delegations.length,
        ...(summary.tokenUsage ? {
          inputTokens: summary.tokenUsage.inputTokens,
          outputTokens: summary.tokenUsage.outputTokens,
        } : {}),
      })
    } catch (err) {
      log("[analytics] Failed to persist session summary (non-fatal)", {
        sessionId,
        error: String(err),
      })
    }

    this.sessions.delete(sessionId)
    return summary
  }

  /**
   * Check if a session is currently being tracked.
   */
  isTracking(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get the current tracked session data (for inspection/testing).
   */
  getSession(sessionId: string): TrackedSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Get the number of sessions currently being tracked.
   */
  get activeSessionCount(): number {
    return this.sessions.size
  }
}

/**
 * Create a new SessionTracker instance.
 */
export function createSessionTracker(directory: string): SessionTracker {
  return new SessionTracker(directory)
}
