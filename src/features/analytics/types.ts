/**
 * Analytics types for session intelligence and learning.
 * All analytics data is stored under `.weave/analytics/`.
 */

/** Directory where analytics data is stored (relative to project root) */
export const ANALYTICS_DIR = ".weave/analytics"

/** File name for session summaries (JSONL format) */
export const SESSION_SUMMARIES_FILE = "session-summaries.jsonl"

/** File name for project fingerprint */
export const FINGERPRINT_FILE = "fingerprint.json"

// ── Session Summary ──────────────────────────────────────────────

/** A single tool invocation recorded during a session */
export interface ToolUsageEntry {
  /** Tool name (e.g., "read", "write", "task") */
  tool: string
  /** Number of times this tool was invoked */
  count: number
}

/** A delegation to a sub-agent recorded during a session */
export interface DelegationEntry {
  /** Sub-agent type (e.g., "thread", "pattern", "weft") */
  agent: string
  /** Tool call ID that started this delegation */
  toolCallId: string
  /** Duration in milliseconds (if completed) */
  durationMs?: number
}

/** Accumulated token usage across all messages in a session */
export interface TokenUsage {
  /** Total input tokens consumed */
  inputTokens: number
  /** Total output tokens generated */
  outputTokens: number
  /** Total reasoning tokens used */
  reasoningTokens: number
  /** Total cache read tokens */
  cacheReadTokens: number
  /** Total cache write tokens */
  cacheWriteTokens: number
  /** Total number of assistant messages processed */
  totalMessages: number
}

/** Summary of a completed session, appended as a JSONL line */
export interface SessionSummary {
  /** Unique session identifier */
  sessionId: string
  /** ISO timestamp when session started */
  startedAt: string
  /** ISO timestamp when session ended */
  endedAt: string
  /** Duration in milliseconds */
  durationMs: number
  /** Tools used during the session */
  toolUsage: ToolUsageEntry[]
  /** Delegations made during the session */
  delegations: DelegationEntry[]
  /** Total number of tool calls */
  totalToolCalls: number
  /** Total number of delegations */
  totalDelegations: number
  /** Display name of the agent that ran this session (e.g., "Loom (Main Orchestrator)") */
  agentName?: string
  /** Total dollar cost accumulated across all messages */
  totalCost?: number
  /** Aggregated token usage across all messages (absent for old entries or sessions with no messages) */
  tokenUsage?: TokenUsage
}

// ── Project Fingerprint ──────────────────────────────────────────

/** Detected language/framework in the project */
export interface DetectedStack {
  /** Language or framework name (e.g., "typescript", "react", "bun") */
  name: string
  /** Detection confidence: "high" if found in lockfile/config, "medium" for deps */
  confidence: "high" | "medium"
  /** Evidence for detection (e.g., "tsconfig.json exists") */
  evidence: string
}

/** Project fingerprint — captures the tech stack and structure */
export interface ProjectFingerprint {
  /** ISO timestamp when fingerprint was generated */
  generatedAt: string
  /** Detected technology stack entries */
  stack: DetectedStack[]
  /** Whether a monorepo structure was detected */
  isMonorepo: boolean
  /** Package manager detected (e.g., "bun", "npm", "yarn", "pnpm") */
  packageManager?: string
  /** Primary language detected */
  primaryLanguage?: string
  /** Operating system (e.g., "darwin", "win32", "linux") */
  os?: string
  /** CPU architecture (e.g., "arm64", "x64") */
  arch?: string
  /** Weave version that generated this fingerprint (e.g., "0.6.3") */
  weaveVersion?: string
}

// ── Suggestions ──────────────────────────────────────────────────

/** A suggestion generated from session analytics */
export interface Suggestion {
  /** Unique identifier for deduplication */
  id: string
  /** Human-readable suggestion text */
  text: string
  /** Category of suggestion */
  category: "tool-usage" | "delegation" | "workflow" | "token-usage"
  /** Confidence level */
  confidence: "high" | "medium" | "low"
}

// ── Metrics Report ───────────────────────────────────────────────

/** File name for metrics reports (JSONL format) */
export const METRICS_REPORTS_FILE = "metrics-reports.jsonl"

/** Maximum number of metrics report entries to keep in the JSONL file */
export const MAX_METRICS_ENTRIES = 100

/** Token usage for metrics reports (simplified field names vs session TokenUsage) */
export interface MetricsTokenUsage {
  /** Total input tokens consumed */
  input: number
  /** Total output tokens generated */
  output: number
  /** Total reasoning tokens used */
  reasoning: number
  /** Total cache read tokens */
  cacheRead: number
  /** Total cache write tokens */
  cacheWrite: number
}

/** Create a zero-valued MetricsTokenUsage */
export function zeroTokenUsage(): MetricsTokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

/** Plan execution adherence metrics */
export interface AdherenceReport {
  /** Proportion of planned files that actually changed (0-1) */
  coverage: number
  /** Proportion of actual changes that were planned (0-1) */
  precision: number
  /** Planned files that actually changed */
  plannedFilesChanged: string[]
  /** Files changed but not in the plan */
  unplannedChanges: string[]
  /** Planned files that did not change */
  missedFiles: string[]
  /** Total number of files in the plan */
  totalPlannedFiles: number
  /** Total number of files actually changed */
  totalActualFiles: number
}

/** Metrics report for a completed plan */
export interface MetricsReport {
  /** Plan name (from plan file basename) */
  planName: string
  /** ISO timestamp when report was generated */
  generatedAt: string
  /** Adherence metrics */
  adherence: AdherenceReport
  /** Code quality score (Phase 2 — undefined in Phase 1) */
  quality?: unknown
  /** Quality gaps (Phase 2 — undefined in Phase 1) */
  gaps?: unknown
  /** Token usage across all sessions */
  tokenUsage: MetricsTokenUsage
  /** Total duration of all sessions in milliseconds */
  durationMs: number
  /** Number of sessions that worked on this plan */
  sessionCount: number
  /** Git HEAD SHA when work started */
  startSha?: string
  /** Git HEAD SHA when work ended (optional) */
  endSha?: string
  /** Session IDs that contributed to this report */
  sessionIds: string[]
}

// ── Session Tracker ──────────────────────────────────────────────

/** Tracks in-flight tool calls for duration measurement */
export interface InFlightToolCall {
  /** Tool name */
  tool: string
  /** Start timestamp (ms since epoch) */
  startedAt: number
  /** Sub-agent type if this is a task delegation */
  agent?: string
}

/** Active session being tracked */
export interface TrackedSession {
  /** Session ID */
  sessionId: string
  /** ISO timestamp when tracking started */
  startedAt: string
  /** Tool usage counts keyed by tool name */
  toolCounts: Record<string, number>
  /** Completed delegations */
  delegations: DelegationEntry[]
  /** In-flight tool calls keyed by callID */
  inFlight: Record<string, InFlightToolCall>
  /** Display name of the agent running this session */
  agentName?: string
  /** Accumulated dollar cost across all messages */
  totalCost: number
  /** Cumulative token usage across all messages */
  tokenUsage: TokenUsage
}
