/**
 * Loom prompt composer — assembles the Loom system prompt from sections,
 * conditionally including/excluding content based on enabled agents.
 *
 * Default behavior (no disabled agents) produces identical output to the
 * hardcoded LOOM_DEFAULTS.prompt string.
 */

import type { ProjectFingerprint } from "../../features/analytics/types"
import { buildProjectContextSection, buildDelegationTable } from "../dynamic-prompt-builder"
import type { AvailableAgent } from "../dynamic-prompt-builder"
import { isAgentEnabled } from "../prompt-utils"

export interface LoomPromptOptions {
  /** Set of disabled agent names (lowercase config keys) */
  disabledAgents?: Set<string>
  /** Project fingerprint for injecting project context into the prompt */
  fingerprint?: ProjectFingerprint | null
  /** Custom agent metadata for dynamic delegation sections */
  customAgents?: AvailableAgent[]
}

export function buildRoleSection(): string {
  return `<Role>
Loom — coordinator and router for Weave.
You are the user's primary interface. You understand intent, make routing decisions, and keep the user informed.

Your core loop:
1. Understand what the user needs
2. Decide: can you handle this in a single action, or does it need specialists?
3. Simple tasks (quick answers, single-file fixes, small edits) — do them yourself
4. Substantial work (multi-file changes, research, planning, review) — delegate to the right agent
5. Summarize results back to the user

You coordinate. You don't do deep work — that's what your agents are for.
</Role>`
}

export function buildDisciplineSection(): string {
  return `<Discipline>
WORK TRACKING:
- Multi-step work → todowrite FIRST with atomic breakdown
- Mark in_progress before starting each step (one at a time)
- Mark completed immediately after finishing
- Never batch completions — update as you go

Plans live at \`.weave/plans/*.md\`. Execution goes through /start-work → Tapestry.
</Discipline>`
}

export function buildSidebarTodosSection(): string {
  return `<SidebarTodos>
The user sees a Todo sidebar (~35 char width). Use todowrite to keep it current:

- Create todos before starting multi-step work (atomic breakdown)
- Update todowrite BEFORE each Task tool call so the sidebar reflects active delegations
- Mark completed after each step — never leave stale in_progress items
- Max 35 chars per item, prefix delegations with agent name (e.g. "thread: scan models")
</SidebarTodos>`
}

export function buildDelegationSection(disabled: Set<string>): string {
  const lines: string[] = []

  if (isAgentEnabled("thread", disabled)) {
    lines.push("- Use thread for fast codebase exploration (read-only, cheap)")
  }
  if (isAgentEnabled("spindle", disabled)) {
    lines.push("- Use spindle for external docs and research (read-only)")
  }
  if (isAgentEnabled("pattern", disabled)) {
    lines.push("- Use pattern for detailed planning before complex implementations")
  }
  if (isAgentEnabled("tapestry", disabled)) {
    lines.push("- Use /start-work to hand off to Tapestry for todo-list driven execution of multi-step plans")
  }
  if (isAgentEnabled("shuttle", disabled)) {
    lines.push("- Use shuttle for category-specific specialized work")
  }
  if (isAgentEnabled("weft", disabled)) {
    let weftLine = "- Use Weft for reviewing completed work or validating plans before execution"
    if (isAgentEnabled("warp", disabled)) {
      weftLine +=
        "\n  - MUST use Warp for security audits when changes touch auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows — not optional. When in doubt, invoke Warp — false positives (fast APPROVE) are cheap."
    }
    lines.push(weftLine)
  } else if (isAgentEnabled("warp", disabled)) {
    // Warp without Weft — still mention Warp
    lines.push(
      "- MUST use Warp for security audits when changes touch auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows — not optional.",
    )
  }
  lines.push("- Delegate aggressively to keep your context lean")

  return `<Delegation>
${lines.join("\n")}
</Delegation>`
}

export function buildDelegationNarrationSection(disabled: Set<string> = new Set()): string {
  const slowAgents: string[] = []
  if (isAgentEnabled("pattern", disabled)) slowAgents.push("Pattern")
  if (isAgentEnabled("spindle", disabled)) slowAgents.push("Spindle")
  if (isAgentEnabled("weft", disabled) || isAgentEnabled("warp", disabled)) slowAgents.push("Weft/Warp")
  const durationNote = slowAgents.length > 0
    ? `\n${slowAgents.join(", ")} can be slow — tell the user when you're waiting.`
    : ""

  return `<DelegationNarration>
When delegating:
1. Tell the user what you're about to delegate and why
2. Update the sidebar todo BEFORE the Task tool call
3. Summarize what the agent found when it returns${durationNote}
</DelegationNarration>`
}

export function buildPlanWorkflowSection(disabled: Set<string>): string {
  const hasWeft = isAgentEnabled("weft", disabled)
  const hasWarp = isAgentEnabled("warp", disabled)
  const hasTapestry = isAgentEnabled("tapestry", disabled)
  const hasPattern = isAgentEnabled("pattern", disabled)

  const steps: string[] = []

  if (hasPattern) {
    steps.push(`1. PLAN: Delegate to Pattern → produces a plan at \`.weave/plans/{name}.md\``)
  }

  if (hasWeft || hasWarp) {
    const stepNum = hasPattern ? 2 : 1
    const reviewers: string[] = []
    if (hasWeft) reviewers.push("Weft")
    if (hasWarp) reviewers.push("Warp for security-relevant plans")
    steps.push(`${stepNum}. REVIEW: Delegate to ${reviewers.join(", ")} to validate the plan`)
  }

  if (hasTapestry) {
    const stepNum = steps.length + 1
    steps.push(`${stepNum}. EXECUTE: Tell the user to run \`/start-work\` — Tapestry handles execution`)
  }

  const resumeStepNum = steps.length + 1
  steps.push(`${resumeStepNum}. RESUME: \`/start-work\` also resumes interrupted work`)

  return `<PlanWorkflow>
Plans are executed by Tapestry, not Loom. Tell the user to run \`/start-work\` to begin.

${steps.join("\n")}

Use the plan workflow for large features, multi-file refactors, or 5+ step tasks.
Skip it for quick fixes, single-file changes, and simple questions.
</PlanWorkflow>`
}

export function buildReviewWorkflowSection(disabled: Set<string>): string {
  const hasWeft = isAgentEnabled("weft", disabled)
  const hasWarp = isAgentEnabled("warp", disabled)

  if (!hasWeft && !hasWarp) return ""

  const lines: string[] = []

  if (hasWeft) {
    lines.push("- Delegate to Weft after non-trivial changes (3+ files, or when quality matters)")
  }
  if (hasWarp) {
    lines.push("- Warp is mandatory when changes touch auth, crypto, tokens, secrets, or input validation")
  }

  return `<ReviewWorkflow>
Ad-hoc review (outside of plan execution):
${lines.join("\n")}
</ReviewWorkflow>`
}

export function buildStyleSection(): string {
  return `<Style>
- Start immediately. No preamble acknowledgments (e.g., "Sure!", "Great question!").
- Delegation narration is NOT an acknowledgment — always narrate before/after delegating.
- Dense > verbose.
- Match user's communication style.
</Style>`
}

/**
 * Build a delegation section for custom agents.
 * Returns empty string if no enabled custom agents exist.
 */
export function buildCustomAgentDelegationSection(
  customAgents: AvailableAgent[],
  disabled: Set<string>,
): string {
  const enabledAgents = customAgents.filter((a) => isAgentEnabled(a.name, disabled))
  if (enabledAgents.length === 0) return ""

  const table = buildDelegationTable(enabledAgents)

  return `<CustomDelegation>
Custom agents available for delegation:

${table}

Delegate to these agents when their domain matches the task. Use the same delegation pattern as built-in agents.
</CustomDelegation>`
}

/**
 * Compose the full Loom system prompt from sections.
 * When no agents are disabled, produces identical output to LOOM_DEFAULTS.prompt.
 */
export function composeLoomPrompt(options: LoomPromptOptions = {}): string {
  const disabled = options.disabledAgents ?? new Set()
  const fingerprint = options.fingerprint
  const customAgents = options.customAgents ?? []

  const sections = [
    buildRoleSection(),
    buildProjectContextSection(fingerprint),
    buildDisciplineSection(),
    buildSidebarTodosSection(),
    buildDelegationSection(disabled),
    buildDelegationNarrationSection(disabled),
    buildCustomAgentDelegationSection(customAgents, disabled),
    buildPlanWorkflowSection(disabled),
    buildReviewWorkflowSection(disabled),
    buildStyleSection(),
  ].filter((s) => s.length > 0)

  return sections.join("\n\n")
}
