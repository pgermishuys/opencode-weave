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
  category: "tool-usage" | "delegation" | "workflow"
  /** Confidence level */
  confidence: "high" | "medium" | "low"
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
}
