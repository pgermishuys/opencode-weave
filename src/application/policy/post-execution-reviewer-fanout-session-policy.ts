import { getPlanProgress, readWorkState, writeWorkState } from "../../features/work-state"
import { extractPlannedFiles } from "../../features/analytics/plan-parser"
import { createPolicyResult, type PolicyResult } from "../../domain/policy/policy-result"
import type { ReviewerPlan } from "../../agents/review-resolver"
import type { RuntimeEffect } from "../../runtime/opencode/effects"
import type { RuntimeSessionIdleInput } from "./runtime-policy"

export interface PostExecutionReviewerResolver {
  forBaseAgent(baseAgent: "weft" | "warp", scope: "direct" | "post-execution"): ReviewerPlan
}

export interface PostExecutionReviewerFanOutSessionPolicy {
  onSessionIdle(input: RuntimeSessionIdleInput): PolicyResult<RuntimeEffect>
}

function buildChangedFilesSummary(state: { plan_name: string; active_plan: string; start_sha?: string }, sessionId: string): string {
  const plannedFiles = extractPlannedFiles(state.active_plan)
  const plannedScope = plannedFiles.length > 0
    ? plannedFiles.map((file) => `- ${file}`).join("\n")
    : "- (none extracted from plan; review all relevant implementation changes in plan scope)"
  const startShaSummary = state.start_sha
    ? `Start SHA: ${state.start_sha}`
    : "Start SHA: unavailable"

  return [
    "Post-execution review target context:",
    `Session ID: ${sessionId}`,
    `Plan: ${state.plan_name}`,
    `Plan file: ${state.active_plan}`,
    startShaSummary,
    "Review scope summary:",
    "- Primary scope: changes introduced while executing this plan.",
    "- Source of truth for scope: Start SHA diff when available; otherwise plan Files entries.",
    "Planned files (from plan **Files** fields):",
    plannedScope,
  ].join("\n")
}

export function createPostExecutionReviewerFanOutSessionPolicy(args: {
  reviewerResolver?: PostExecutionReviewerResolver
}): PostExecutionReviewerFanOutSessionPolicy {
  return {
    onSessionIdle(input) {
      if (!input.directory || !args.reviewerResolver) {
        return createPolicyResult<RuntimeEffect>()
      }

      const state = readWorkState(input.directory)
      if (!state || state.paused) {
        return createPolicyResult<RuntimeEffect>()
      }

      if (state.session_ids.length > 0 && state.session_ids.at(-1) !== input.sessionId) {
        return createPolicyResult<RuntimeEffect>()
      }

      const progress = getPlanProgress(state.active_plan)
      if (!progress.isComplete || state.reviewer_fanout_sent) {
        return createPolicyResult<RuntimeEffect>()
      }

      const originalContext = buildChangedFilesSummary(state, input.sessionId)
      const promptText = [
        "You are performing a post-execution code review.",
        "Review the completed implementation for correctness, regressions, security issues, and missing tests.",
        "Use the following scope context and return a concise verdict with concrete issues and actionable follow-ups.",
        "",
        originalContext,
      ].join("\n")
      const effects: RuntimeEffect[] = []

      for (const baseAgent of ["weft", "warp"] as const) {
        const plan = args.reviewerResolver.forBaseAgent(baseAgent, "post-execution")
        if (plan.kind === "disabled") {
          continue
        }

        effects.push({
          type: "runReviewerFanOut",
          sessionId: input.sessionId,
          plan,
          capturedPrimaryOutput: undefined,
          promptText,
          originalContext,
          idempotencyKey: `${input.sessionId}:${state.plan_name}:${baseAgent}`,
          delivery: { kind: "injectPromptAsync" },
        })
      }

      writeWorkState(input.directory, {
        ...state,
        reviewer_fanout_sent: true,
      })

      return createPolicyResult<RuntimeEffect>(effects)
    },
  }
}
