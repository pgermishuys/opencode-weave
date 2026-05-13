export type ExecutionOwnerKind = "none" | "plan" | "workflow"

export type ExecutionLeaseStatus = "running" | "paused" | "completed"

export type SessionRuntimeMode = "ad_hoc" | "plan" | "workflow"

export type SessionRuntimeStatus = "running" | "paused" | "awaiting_user" | "idle"

/**
 * Repo-scoped runtime execution lease stored at .weave/runtime/active-execution.json.
 */
export interface ExecutionLeaseState {
  owner_kind: ExecutionOwnerKind
  owner_ref: string | null
  status: ExecutionLeaseStatus
  session_id: string | null
  executor_agent: string | null
  started_at: string
  updated_at: string
}

/**
 * Session-scoped runtime state stored at .weave/runtime/sessions/{sessionId}.json.
 */
export interface SessionRuntimeState {
  session_id: string
  foreground_agent: string | null
  mode: SessionRuntimeMode
  execution_ref: string | null
  status: SessionRuntimeStatus
  updated_at: string
}

/**
 * Tracks the active plan being executed via /start-work.
 * Stored at .weave/state.json in the project root.
 */
export interface WorkState {
  /** Absolute path to the active plan file */
  active_plan: string
  /** ISO timestamp when work started */
  started_at: string
  /** Session IDs that have worked on this plan */
  session_ids: string[]
  /** Plan name derived from filename (without .md) */
  plan_name: string
  /** Agent type to use when resuming (e.g., "tapestry") */
  agent?: string
  /** Git HEAD SHA at the time work started (absent if not a git repo) */
  start_sha?: string
  /** Whether work has been paused by a user interrupt; continuation is suppressed while true */
  paused?: boolean
  /** The `completed` count from getPlanProgress() at the time of the last continuation prompt */
  continuation_completed_snapshot?: number
  /** How many consecutive continuations have fired without progress changing */
  stale_continuation_count?: number
  /** Whether the completion verification reminder was already sent */
  verification_reminder_sent?: boolean
  /** Whether post-execution reviewer fan-out was already emitted */
  reviewer_fanout_sent?: boolean
}

/**
 * Progress snapshot from counting checkboxes in a plan file.
 */
export interface PlanProgress {
  /** Total number of checkboxes (checked + unchecked) */
  total: number
  /** Number of completed checkboxes */
  completed: number
  /** Whether all tasks are done (total === 0 or completed === total) */
  isComplete: boolean
}
