/**
 * Step execution types: interactive (needs user input), autonomous (runs without user),
 * gate (requires APPROVE/REJECT verdict).
 */
export type StepType = "interactive" | "autonomous" | "gate"

/**
 * How a step's completion is detected.
 */
export type CompletionMethod = "user_confirm" | "plan_created" | "plan_complete" | "review_verdict" | "agent_signal"

/**
 * Per-step status in a workflow instance.
 */
export type StepStatus = "pending" | "active" | "awaiting_user" | "completed" | "failed" | "skipped"

/**
 * Instance-level workflow status.
 */
export type WorkflowStatus = "running" | "paused" | "completed" | "failed" | "cancelled"

/**
 * What happens when a gate step rejects.
 */
export type OnRejectAction = "pause" | "fail"

/**
 * Reference to an artifact that a step consumes or produces.
 */
export interface ArtifactRef {
  name: string
  description?: string
}

/**
 * Artifact input/output declarations for a step.
 */
export interface StepArtifacts {
  inputs?: ArtifactRef[]
  outputs?: ArtifactRef[]
}

/**
 * Configuration for how a step's completion is detected.
 */
export interface CompletionConfig {
  method: CompletionMethod
  /** For plan_created/plan_complete: the plan name to check */
  plan_name?: string
  /** For user_confirm: custom keywords to detect */
  keywords?: string[]
}

/**
 * A single step in a workflow definition (template).
 */
export interface WorkflowStepDefinition {
  /** Unique step ID within the workflow (e.g., "gather", "plan-review") */
  id: string
  /** Human-readable step name */
  name: string
  /** Step execution type */
  type: StepType
  /** Agent to activate for this step */
  agent: string
  /** Prompt template with {{instance.goal}}, {{artifacts.X}} variables */
  prompt: string
  /** How to detect step completion */
  completion: CompletionConfig
  /** Artifact declarations */
  artifacts?: StepArtifacts
  /** For gate steps: what to do on reject */
  on_reject?: OnRejectAction
}

/**
 * A workflow definition (reusable template).
 * Stored as JSONC in .opencode/workflows/ or ~/.config/opencode/workflows/.
 */
export interface WorkflowDefinition {
  /** Workflow name matching the filename (e.g., "secure-feature") */
  name: string
  /** Human-readable description */
  description?: string
  /** Schema version for future migration */
  version: number
  /** Ordered list of steps */
  steps: WorkflowStepDefinition[]
}

/**
 * Per-step state in a workflow instance.
 */
export interface StepState {
  /** Step ID matching the definition */
  id: string
  /** Current step status */
  status: StepStatus
  /** ISO timestamp when the step became active */
  started_at?: string
  /** ISO timestamp when the step completed/failed/skipped */
  completed_at?: string
  /** For gate steps: the verdict */
  verdict?: "approve" | "reject"
  /** Error message if failed */
  error?: string
  /** Artifacts produced by this step */
  artifacts?: Record<string, string>
  /** Summary of what this step produced (for context threading) */
  summary?: string
}

/**
 * A workflow instance — a specific execution of a workflow definition,
 * bound to a user goal with accumulated artifacts and step states.
 */
export interface WorkflowInstance {
  /** Unique instance ID (e.g., "wf_a1b2c3d4") */
  instance_id: string
  /** ID of the workflow definition (matches definition name) */
  definition_id: string
  /** Human-readable workflow name */
  definition_name: string
  /** Path to the workflow definition file */
  definition_path: string
  /** The user's goal — what they're trying to accomplish */
  goal: string
  /** URL-safe slug derived from the goal (for plan filenames, etc.) */
  slug: string
  /** Current workflow-level status */
  status: WorkflowStatus
  /** ISO timestamp when the instance was created */
  started_at: string
  /** ISO timestamp when the instance completed/failed/cancelled */
  ended_at?: string
  /** Session IDs that have participated in this instance */
  session_ids: string[]
  /** ID of the currently active step */
  current_step_id: string
  /** Per-step state */
  steps: Record<string, StepState>
  /** Accumulated artifacts from completed steps (name -> value) */
  artifacts: Record<string, string>
  /** Why the workflow is paused (if paused) */
  pause_reason?: string
}

/**
 * Pointer file content — tracks which instance is currently active.
 * Stored at .weave/workflows/active-instance.json.
 */
export interface ActiveInstancePointer {
  instance_id: string
}
