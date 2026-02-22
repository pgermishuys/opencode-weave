/** Possible lifecycle states for a background task */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

/** Options for spawning a background task */
export interface SpawnOptions {
  agentName: string
  prompt: string
  category?: string
  skills?: string[]
  concurrencyKey?: string
}

/** A record representing a background task and its lifecycle */
export interface TaskRecord {
  id: string
  status: TaskStatus
  options: SpawnOptions
  result?: unknown
  error?: string
  startedAt?: Date
  completedAt?: Date
}

/** Terminal statuses — tasks in these states cannot be cancelled or transitioned */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"])

/**
 * In-memory background task manager for the Weave OpenCode plugin.
 *
 * v1 tracks tasks in memory only — no real session spawning, polling, or
 * tmux integration.  Real concurrency control and SDK integration are
 * deferred to a future release.
 *
 * ## Planned Delegation Tracking Integration
 *
 * Once a UI consumer exists (e.g. a `/status` slash command), this class
 * should be wired into `plugin-interface.ts` as follows:
 *
 * 1. **`tool.execute.before`** — when `input.tool === "task"`, call
 *    `backgroundManager.spawn({ agentName: args.agent, prompt: args.description })`
 *    and store the returned task ID keyed by `input.callID`.
 *
 * 2. **`tool.execute.after`** — look up the task ID by `input.callID` and
 *    transition its status:
 *    - On success: set `status = "completed"` and `completedAt = new Date()`
 *    - On error: set `status = "failed"` and `error = err.message`
 *
 * 3. **`/status` command** — call `list({ status: "running" })` to surface
 *    all in-flight delegations to the user in real time.
 *
 * This is deferred until there is an OpenCode API to read task status back
 * out of the plugin (e.g. a query hook or TUI panel).
 */
export class BackgroundManager {
  private readonly tasks: Map<string, TaskRecord> = new Map()
  readonly maxConcurrent: number

  constructor(options?: { maxConcurrent?: number }) {
    this.maxConcurrent = options?.maxConcurrent ?? 5
  }

  /**
   * Creates a new task record with status "pending", stores it, and returns
   * the generated task ID.
   */
  spawn(options: SpawnOptions): string {
    const runningCount = this.getRunningCount()
    if (runningCount >= this.maxConcurrent) {
      throw new Error(`Concurrency limit reached: ${runningCount}/${this.maxConcurrent} tasks running`)
    }
    const id = crypto.randomUUID()
    const record: TaskRecord = {
      id,
      status: "pending",
      options,
      startedAt: new Date(),
    }
    this.tasks.set(id, record)
    return id
  }

  /**
   * Returns the task record for the given ID, or `undefined` if not found.
   */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * Attempts to cancel the task with the given ID.
   *
   * - Returns `true` if the task was found and successfully cancelled.
   * - Returns `false` if the task does not exist or is already in a terminal
   *   state ("completed", "failed", "cancelled").
   */
  cancel(taskId: string): boolean {
    const record = this.tasks.get(taskId)
    if (!record) {
      return false
    }
    if (TERMINAL_STATUSES.has(record.status)) {
      return false
    }
    record.status = "cancelled"
    record.completedAt = new Date()
    return true
  }

  /**
   * Cancels all tasks that are not yet in a terminal state.
   */
  cancelAll(): void {
    for (const record of this.tasks.values()) {
      if (!TERMINAL_STATUSES.has(record.status)) {
        record.status = "cancelled"
        record.completedAt = new Date()
      }
    }
  }

  /**
   * Returns all tasks, optionally filtered by status.
   *
   * @param filter - If `filter.status` is provided, only tasks with that
   *   status are returned.  If no filter is given, all tasks are returned.
   */
  list(filter?: { status?: TaskStatus }): TaskRecord[] {
    const all = Array.from(this.tasks.values())
    if (filter?.status !== undefined) {
      return all.filter((t) => t.status === filter.status)
    }
    return all
  }

  /**
   * Returns the number of tasks currently in the "running" state.
   */
  getRunningCount(): number {
    let count = 0
    for (const record of this.tasks.values()) {
      if (record.status === "running") {
        count++
      }
    }
    return count
  }
}
