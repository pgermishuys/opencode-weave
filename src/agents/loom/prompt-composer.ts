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
import type { CategoriesConfig } from "../../config/schema"
import type { ReviewModelVariant } from "../review-model-variants"
import { formatReviewVariantList, reviewVariantsFor } from "../review-model-variants"

export interface LoomPromptOptions {
  /** Set of disabled agent names (lowercase config keys) */
  disabledAgents?: Set<string>
  /** Project fingerprint for injecting project context into the prompt */
  fingerprint?: ProjectFingerprint | null
  /** Custom agent metadata for dynamic delegation sections */
  customAgents?: AvailableAgent[]
  /** Categories config for category-aware shuttle routing */
  categories?: CategoriesConfig
  /** Visible review model variants generated from agents.weft/warp.review_models */
  reviewModelVariants?: ReviewModelVariant[]
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

export function buildDelegationSection(disabled: Set<string>, reviewModelVariants: ReviewModelVariant[] = []): string {
  const lines: string[] = []
  const weftVariants = reviewVariantsFor(reviewModelVariants, "weft")
  const warpVariants = reviewVariantsFor(reviewModelVariants, "warp")

  if (isAgentEnabled("thread", disabled)) {
    lines.push("- Use thread for fast codebase exploration (read-only, cheap)")
  }
  if (isAgentEnabled("spindle", disabled)) {
    lines.push("- Use spindle for external docs and research (read-only)")
  }
  if (isAgentEnabled("pattern", disabled)) {
    lines.push(
      "- Use pattern for planning, scoping, and work breakdown before substantial implementation begins",
    )
  }
  if (isAgentEnabled("tapestry", disabled)) {
    lines.push("- Use /start-work to hand off to Tapestry for todo-list driven execution of multi-step plans")
  }
  if (isAgentEnabled("shuttle", disabled)) {
    lines.push(
      "- Use shuttle for category-specific specialist work when the main need is domain expertise rather than planning or scoping",
    )
  }
  if (isAgentEnabled("weft", disabled)) {
    let weftLine = "- Use Weft for reviewing completed work or validating plans before execution"
    if (weftVariants.length > 0) {
      weftLine += `; also delegate visible Weft code-quality variants: ${formatReviewVariantList(weftVariants)}. These are Weft reviewers only — never label or use weft-review-* variants as Warp/security audits.`
    }
    if (isAgentEnabled("warp", disabled)) {
      weftLine +=
        "\n  - MUST use Warp for security audits when changes touch auth, crypto, certificates, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows — not optional. Use subagent_type \"warp\" for security unless warp-review-* variants are explicitly listed. Never substitute a weft-review-* variant for Warp."
      if (warpVariants.length > 0) {
        weftLine += ` Also delegate visible Warp model variants: ${formatReviewVariantList(warpVariants)}.`
      }
    }
    lines.push(weftLine)
  } else if (isAgentEnabled("warp", disabled)) {
    // Warp without Weft — still mention Warp
    let warpLine = "- MUST use Warp for security audits when changes touch auth, crypto, tokens, signatures, input validation, secrets, passwords, sessions, CORS, CSP, .env files, or OAuth/OIDC/SAML flows — not optional."
    if (warpVariants.length > 0) {
      warpLine += ` Also delegate visible Warp model variants: ${formatReviewVariantList(warpVariants)}.`
    }
    lines.push(warpLine)
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
1. Tell the user which agent you're delegating to by name and why
2. Update the sidebar todo BEFORE the Task tool call
3. Summarize what the agent found when it returns${durationNote}
</DelegationNarration>`
}

export function buildPlanWorkflowSection(disabled: Set<string>, reviewModelVariants: ReviewModelVariant[] = []): string {
  const hasWeft = isAgentEnabled("weft", disabled)
  const hasWarp = isAgentEnabled("warp", disabled)
  const hasTapestry = isAgentEnabled("tapestry", disabled)
  const hasPattern = isAgentEnabled("pattern", disabled)
  const weftVariants = reviewVariantsFor(reviewModelVariants, "weft")
  const warpVariants = reviewVariantsFor(reviewModelVariants, "warp")

  const steps: string[] = []

  if (hasPattern) {
    steps.push(`1. PLAN: Delegate to Pattern → produces a plan at \`.weave/plans/{name}.md\``)
  }

  if (hasWeft || hasWarp) {
    const stepNum = hasPattern ? 2 : 1
    const reviewers: string[] = []
    if (hasWeft) {
      reviewers.push(weftVariants.length > 0 ? `Weft plus ${formatReviewVariantList(weftVariants)} for code-quality/plan review only` : "Weft")
    }
    if (hasWarp) {
      reviewers.push(warpVariants.length > 0 ? `Warp plus ${formatReviewVariantList(warpVariants)} for security-relevant plans` : "Warp for security-relevant plans")
    }
    const boundary = weftVariants.length > 0
      ? " Do not use weft-review-* variants as Warp/security reviewers."
      : ""
    steps.push(`${stepNum}. REVIEW: Delegate to ${reviewers.join(", ")} to validate the plan.${boundary}`)
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

export function buildReviewWorkflowSection(disabled: Set<string>, reviewModelVariants: ReviewModelVariant[] = []): string {
  const hasWeft = isAgentEnabled("weft", disabled)
  const hasWarp = isAgentEnabled("warp", disabled)
  const weftVariants = reviewVariantsFor(reviewModelVariants, "weft")
  const warpVariants = reviewVariantsFor(reviewModelVariants, "warp")

  if (!hasWeft && !hasWarp) return ""

  const lines: string[] = []

  if (hasWeft) {
    lines.push("- Delegate to Weft after non-trivial changes (3+ files, or when quality matters)")
    if (weftVariants.length > 0) {
      lines.push(`- Also delegate visible Weft code-quality variants: ${formatReviewVariantList(weftVariants)}`)
      lines.push("- Never label or use weft-review-* variants as Warp/security audits")
      lines.push("- Multi-review batch rule: when delegating to Weft plus variants, issue all Weft Task calls in the same assistant turn before waiting for any result; do not run only the first reviewer and stop")
    }
  }
  if (hasWarp) {
    lines.push("- Warp is mandatory when changes touch auth, crypto, tokens, secrets, or input validation; use subagent_type \"warp\" unless warp-review-* variants are configured")
    if (warpVariants.length > 0) {
      lines.push(`- Also delegate visible Warp model variants: ${formatReviewVariantList(warpVariants)}`)
      lines.push("- Multi-review batch rule: when delegating to Warp plus variants, issue all Warp Task calls in the same assistant turn before waiting for any result")
    }
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
 * Build a category routing section listing shuttle-{category} agents.
 * Categories with patterns get file-pattern routing guidance.
 * Categories without patterns are still listed as available specialists.
 * Returns empty string when no categories exist or shuttle is disabled.
 */
export function buildCategoryRoutingSection(
  categories: CategoriesConfig | undefined,
  disabled: Set<string>,
): string {
  if (!categories || !isAgentEnabled("shuttle", disabled)) return ""

  const withPatterns: string[] = []
  const withoutPatterns: string[] = []
  for (const [name, cfg] of Object.entries(categories)) {
    const agentName = `shuttle-${name}`
    if (!isAgentEnabled(agentName, disabled)) continue
    const desc = cfg.description ? ` — ${cfg.description}` : ""
    if (cfg.patterns?.length) {
      const patterns = cfg.patterns.join(", ")
      withPatterns.push(`- \`${agentName}\`${desc} (patterns: ${patterns})`)
    } else {
      withoutPatterns.push(`- \`${agentName}\`${desc}`)
    }
  }

  if (withPatterns.length === 0 && withoutPatterns.length === 0) return ""

  const lines: string[] = []

  if (withPatterns.length > 0) {
    lines.push("Prefer category-specific shuttle agents when file patterns match the task:")
    lines.push("")
    lines.push(...withPatterns)
    if (withoutPatterns.length > 0) {
      lines.push("")
      lines.push("Also available (no file-pattern routing — use when task domain is clear):")
      lines.push("")
      lines.push(...withoutPatterns)
    }
    lines.push("")
    lines.push(
      "Use `shuttle-{category}` instead of generic `shuttle` when the task matches a category's patterns.",
    )
  } else {
    lines.push("Category-specific shuttle agents are available — use by task domain:")
    lines.push("")
    lines.push(...withoutPatterns)
  }

  return `<CategoryRouting>\n${lines.join("\n")}\n</CategoryRouting>`
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
  const categories = options.categories
  const reviewModelVariants = options.reviewModelVariants ?? []

  const sections = [
    buildRoleSection(),
    buildProjectContextSection(fingerprint),
    buildDisciplineSection(),
    buildSidebarTodosSection(),
    buildDelegationSection(disabled, reviewModelVariants),
    buildDelegationNarrationSection(disabled),
    buildCategoryRoutingSection(categories, disabled),
    buildCustomAgentDelegationSection(customAgents, disabled),
    buildPlanWorkflowSection(disabled, reviewModelVariants),
    buildReviewWorkflowSection(disabled, reviewModelVariants),
    buildStyleSection(),
  ].filter((s) => s.length > 0)

  return sections.join("\n\n")
}
