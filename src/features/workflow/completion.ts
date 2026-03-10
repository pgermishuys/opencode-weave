import { existsSync } from "fs"
import { join } from "path"
import type { CompletionConfig, CompletionMethod } from "./types"
import { findPlans, getPlanProgress } from "../work-state/storage"

/**
 * Result of checking whether a step's completion condition is met.
 */
export interface CompletionCheckResult {
  complete: boolean
  verdict?: "approve" | "reject"
  artifacts?: Record<string, string>
  /** Concise summary of step output for context threading */
  summary?: string
  reason?: string
}

/**
 * Context provided to completion checkers.
 */
export interface CompletionContext {
  /** Last assistant message text (from message.part.updated tracking) */
  lastAssistantMessage?: string
  /** Last user message text (for user_confirm) */
  lastUserMessage?: string
  /** Working directory */
  directory: string
  /** Completion config from the step definition */
  config: CompletionConfig
  /** Current artifacts in the instance */
  artifacts: Record<string, string>
}

/** Default keywords for user_confirm detection */
const DEFAULT_CONFIRM_KEYWORDS = ["confirmed", "approved", "continue", "done", "let's proceed", "looks good", "lgtm"]

/** Regex for [APPROVE] or [REJECT] markers (case-insensitive, whitespace-tolerant) */
const VERDICT_APPROVE_RE = /\[\s*APPROVE\s*\]/i
const VERDICT_REJECT_RE = /\[\s*REJECT\s*\]/i

/** Agent completion signal marker */
const AGENT_SIGNAL_MARKER = "<!-- workflow:step-complete -->"

/**
 * Check whether a step's completion condition is met.
 */
export function checkStepCompletion(
  method: CompletionMethod,
  context: CompletionContext,
): CompletionCheckResult {
  switch (method) {
    case "user_confirm":
      return checkUserConfirm(context)
    case "plan_created":
      return checkPlanCreated(context)
    case "plan_complete":
      return checkPlanComplete(context)
    case "review_verdict":
      return checkReviewVerdict(context)
    case "agent_signal":
      return checkAgentSignal(context)
    default:
      return { complete: false, reason: `Unknown completion method: ${method}` }
  }
}

function checkUserConfirm(context: CompletionContext): CompletionCheckResult {
  const { lastUserMessage, config } = context
  if (!lastUserMessage) return { complete: false }

  const keywords = config.keywords ?? DEFAULT_CONFIRM_KEYWORDS
  const lowerMessage = lastUserMessage.toLowerCase().trim()

  for (const keyword of keywords) {
    if (lowerMessage.includes(keyword.toLowerCase())) {
      return {
        complete: true,
        summary: `User confirmed: "${lastUserMessage.slice(0, 100)}"`,
      }
    }
  }

  return { complete: false }
}

function checkPlanCreated(context: CompletionContext): CompletionCheckResult {
  const { config, directory } = context
  const planName = config.plan_name
  if (!planName) {
    return { complete: false, reason: "plan_created requires plan_name in completion config" }
  }

  // Check if a plan file matching the name exists
  const plans = findPlans(directory)
  const matchingPlan = plans.find((p) => p.includes(planName))

  if (matchingPlan) {
    return {
      complete: true,
      artifacts: { plan_path: matchingPlan },
      summary: `Plan created at ${matchingPlan}`,
    }
  }

  // Also check the direct path
  const directPath = join(directory, ".weave", "plans", `${planName}.md`)
  if (existsSync(directPath)) {
    return {
      complete: true,
      artifacts: { plan_path: directPath },
      summary: `Plan created at ${directPath}`,
    }
  }

  return { complete: false }
}

function checkPlanComplete(context: CompletionContext): CompletionCheckResult {
  const { config, directory } = context
  const planName = config.plan_name
  if (!planName) {
    return { complete: false, reason: "plan_complete requires plan_name in completion config" }
  }

  const planPath = join(directory, ".weave", "plans", `${planName}.md`)
  if (!existsSync(planPath)) {
    return { complete: false, reason: `Plan file not found: ${planPath}` }
  }

  const progress = getPlanProgress(planPath)
  if (progress.isComplete) {
    return {
      complete: true,
      summary: `Plan completed: ${progress.completed}/${progress.total} tasks done`,
    }
  }

  return {
    complete: false,
    reason: `Plan in progress: ${progress.completed}/${progress.total} tasks done`,
  }
}

function checkReviewVerdict(context: CompletionContext): CompletionCheckResult {
  const { lastAssistantMessage } = context
  if (!lastAssistantMessage) return { complete: false }

  if (VERDICT_APPROVE_RE.test(lastAssistantMessage)) {
    return {
      complete: true,
      verdict: "approve",
      summary: "Review verdict: APPROVED",
    }
  }

  if (VERDICT_REJECT_RE.test(lastAssistantMessage)) {
    return {
      complete: true,
      verdict: "reject",
      summary: "Review verdict: REJECTED",
    }
  }

  return { complete: false }
}

function checkAgentSignal(context: CompletionContext): CompletionCheckResult {
  const { lastAssistantMessage } = context
  if (!lastAssistantMessage) return { complete: false }

  if (lastAssistantMessage.includes(AGENT_SIGNAL_MARKER)) {
    return {
      complete: true,
      summary: "Agent signaled completion",
    }
  }

  return { complete: false }
}
