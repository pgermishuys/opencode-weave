/**
 * Verification reminder hook: builds a prompt that reminds the orchestrator
 * to verify completed work, optionally delegating to Weft for review.
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
 * Returns a structured reminder for the orchestrator to verify work.
 */
export function buildVerificationReminder(input: VerificationInput): VerificationResult {
  const planContext =
    input.planName && input.progress
      ? `\n**Plan**: ${input.planName} (${input.progress.completed}/${input.progress.total} tasks done)`
      : ""

  return {
    verificationPrompt: `## Verification Required
${planContext}

Before marking this task complete, verify the work:

1. **Read the changes**: \`git diff --stat\` then Read each changed file
2. **Run checks**: Run relevant tests, check for linting/type errors
3. **Validate behavior**: Does the code actually do what was requested?
4. **Gate decision**: Can you explain what every changed line does?

If uncertain about quality, delegate to \`weft\` agent for a formal review:
\`call_weave_agent(agent="weft", prompt="Review the changes for [task description]")\`

MANDATORY: If changes touch auth, crypto, certificates, tokens, signatures, or input validation, you MUST delegate to \`warp\` agent for a security audit — this is NOT optional:
\`call_weave_agent(agent="warp", prompt="Security audit the changes for [task description]")\`

Only mark complete when ALL checks pass.`,
  }
}
