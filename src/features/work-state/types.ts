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
