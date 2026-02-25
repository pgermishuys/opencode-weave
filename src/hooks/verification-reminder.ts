/**
 * Verification reminder hook: builds a structured prompt that enforces
 * mandatory per-task self-verification before marking a task complete.
 */

export interface VerificationInput {
  /** Name of the plan being executed, if any */
  planName?: string
  /** Progress of the current plan */
  progress?: { total: number; completed: number }
}

export interface VerificationResult {
  /** Verification prompt to inject, or null if not applicable */
  verificationPrompt: string | null
}

/**
 * Build a verification reminder prompt to inject after task completion.
 * Returns a structured self-verification protocol — Tapestry cannot spawn
 * subagents, so verification is self-performed and security concerns are
 * noted for Loom's mandatory post-execution Warp review.
 */
export function buildVerificationReminder(input: VerificationInput): VerificationResult {
  const planContext =
    input.planName && input.progress
      ? `\n**Plan**: ${input.planName} (${input.progress.completed}/${input.progress.total} tasks done)`
      : ""

  return {
    verificationPrompt: `<VerificationProtocol>
## Verification Required — DO NOT SKIP
${planContext}

Before marking this task complete, you MUST complete ALL of these steps:

### 1. Inspect Changes
- Review your Edit/Write tool call history to identify all files you modified
- Read EVERY changed file — confirm the changes are correct and complete
- Cross-check: does the code actually implement what the task required?

### 2. Validate Acceptance Criteria
- Re-read the task's acceptance criteria from the plan
- Verify EACH criterion is met — not approximately, exactly
- If any criterion is not met: address it before marking complete

### Gate
Only mark \`- [ ]\` → \`- [x]\` when ALL checks above pass.
If ANY check fails, fix first — then re-verify.
</VerificationProtocol>`,
  }
}
