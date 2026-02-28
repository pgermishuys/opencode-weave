/**
 * Work continuation hook: checks if there's an active plan with remaining tasks
 * and returns a continuation prompt to keep the executor going.
 */

import { readWorkState, getPlanProgress } from "../features/work-state"

export interface ContinuationInput {
  sessionId: string
  directory: string
}

export interface ContinuationResult {
  /** Continuation prompt to inject, or null if no active work / plan complete */
  continuationPrompt: string | null
}

/**
 * Check if there's active work that should continue.
 * Returns a continuation prompt if the plan has remaining tasks, null otherwise.
 */
export function checkContinuation(input: ContinuationInput): ContinuationResult {
  const { directory } = input

  const state = readWorkState(directory)
  if (!state) {
    return { continuationPrompt: null }
  }

  if (state.paused) {
    return { continuationPrompt: null }
  }

  const progress = getPlanProgress(state.active_plan)
  if (progress.isComplete) {
    return { continuationPrompt: null }
  }

  const remaining = progress.total - progress.completed
  return {
    continuationPrompt: `You have an active work plan with incomplete tasks. Continue working.

**Plan**: ${state.plan_name}
**File**: ${state.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed (${remaining} remaining)

1. Read the plan file NOW to check exact current progress
2. Use todowrite to restore sidebar: summary todo "${state.plan_name} ${progress.completed}/${progress.total}" (in_progress) + next task (in_progress) + 2-3 upcoming (pending). Max 35 chars each.
3. Find the first unchecked \`- [ ]\` task
4. Execute it, verify it, mark \`- [ ]\` → \`- [x]\`
5. Update sidebar todos as you complete tasks
6. Do not stop until all tasks are complete`,
  }
}
