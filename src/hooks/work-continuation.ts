/**
 * Work continuation hook: checks if there's an active plan with remaining tasks
 * and returns a continuation prompt to keep the executor going.
 */

import { readWorkState, getPlanProgress, clearWorkState } from "../features/work-state"

export interface ContinuationInput {
  sessionId: string
  directory: string
}

export interface ContinuationResult {
  /** Continuation prompt to inject, or null if no active work */
  continuationPrompt: string | null
  /** Agent to switch to when injecting the prompt (config key, e.g. "loom") */
  switchAgent?: string
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

  const progress = getPlanProgress(state.active_plan)
  if (progress.total === 0) {
    // Plan file is missing or has no tasks — clean up stale state
    clearWorkState(directory)
    return { continuationPrompt: null }
  }
  if (progress.isComplete) {
    // Capture plan info before clearing state
    const planPath = state.active_plan
    const planName = state.plan_name
    // Plan is done — clean up so future idle events take the fast exit
    clearWorkState(directory)
    return {
      continuationPrompt: `Tapestry has completed all tasks in the plan "${planName}".

**Plan file**: ${planPath}
**Status**: All ${progress.total} tasks marked complete.

## Review Instructions

1. **Invoke Weft** to review all changes made during this plan execution. Tell Weft to check the git diff for quality, correctness, and adherence to the plan's acceptance criteria.
2. **Invoke Warp** if any changes touch security-relevant areas (auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows). When in doubt, invoke Warp — false positives are cheap.
3. **Report findings** to the user with a concise summary of the review results.
4. **Suggest next steps** if any issues are found.

This is an automated post-execution review. Do NOT skip it.`,
      switchAgent: "loom",
    }
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
