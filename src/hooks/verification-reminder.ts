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
- Run \`git diff --stat\` to identify all changed files
- Read EVERY changed file — confirm the changes are correct and complete
- Cross-check: does the code actually implement what the task required?

### 2. Run Automated Checks
- Detect the project toolchain from config files (package.json → bun/npm/yarn/pnpm, go.mod → go, *.csproj/*.sln → dotnet, Cargo.toml → cargo, Makefile → make, etc.)
- Run **scoped tests only** — test files/packages affected by your changes:
  - Use \`git diff --name-only\` to identify changed files, then run tests for those files/packages only
  - Examples: \`bun test src/changed-module.test.ts\`, \`go test ./changed/package/...\`, \`dotnet test --filter FullyQualifiedName~ChangedNamespace\`, \`cargo test module_name\`
- If you cannot determine the affected scope, you can skip running the tests.
- Run the project's type/build check if applicable (e.g. \`tsc --noEmit\`, \`go vet ./...\`, \`dotnet build\`, \`cargo check\`) — ZERO errors
- If any check fails: fix the issue before proceeding

### 3. Validate Acceptance Criteria
- Re-read the task's acceptance criteria from the plan
- Verify EACH criterion is met — not approximately, exactly
- If any criterion is not met: address it before marking complete

### 4. Security-Sensitive Changes
If changes touch auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows:
- Note the security-relevant changes in your completion report
- These will be reviewed by Loom's mandatory post-execution Warp security audit
- Do NOT skip this — Warp needs to know what to focus on

### Gate
Only mark \`- [ ]\` → \`- [x]\` when ALL checks above pass.
If ANY check fails, fix first — then re-verify.
</VerificationProtocol>`,
  }
}
