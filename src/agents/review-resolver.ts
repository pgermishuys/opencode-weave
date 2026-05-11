import type { AgentOverrideConfig } from "../config/schema"
import {
  buildReviewModelVariants,
  reviewVariantsFor,
  type ReviewModelVariant,
} from "./review-model-variants"

export type ReviewBaseAgent = "weft" | "warp"

type ReviewScope = "direct" | "post-execution"

type ReviewerPrimary = {
  agentName: ReviewBaseAgent
  label: "Weft" | "Warp"
  model: string
}

export type ReviewerPlan =
  | {
    kind: "fan-out"
    scope: ReviewScope
    baseAgent: ReviewBaseAgent
    primary: ReviewerPrimary
    variants: ReviewModelVariant[]
    batch: { mode: "parallel", size: number }
  }
  | {
    kind: "primary-only"
    scope: ReviewScope
    baseAgent: ReviewBaseAgent
    primary: ReviewerPrimary
    reason: "no-variants" | "all-variants-disabled"
  }
  | {
    kind: "disabled"
    scope: ReviewScope
    baseAgent: ReviewBaseAgent
    reason: "agent-disabled"
  }

export function resolveReviewers(input: {
  scope: ReviewScope
  baseAgent: ReviewBaseAgent
  agentOverrides: Record<string, AgentOverrideConfig> | undefined
  disabledAgents: Set<string>
  primaryModel: string
}): ReviewerPlan {
  const { scope, baseAgent, agentOverrides, disabledAgents, primaryModel } = input

  if (disabledAgents.has(baseAgent)) {
    return {
      kind: "disabled",
      scope,
      baseAgent,
      reason: "agent-disabled",
    }
  }

  const overrideModel = agentOverrides?.[baseAgent]?.model
  const allVariants = reviewVariantsFor(
    buildReviewModelVariants(agentOverrides, disabledAgents),
    baseAgent,
  ).filter((variant) => variant.model !== primaryModel && variant.model !== overrideModel)
  const rawConfigured = (agentOverrides?.[baseAgent]?.review_models ?? [])
    .filter((model) => model !== overrideModel)
    .filter((model) => model !== primaryModel)

  const primary = {
    agentName: baseAgent,
    label: baseAgent === "weft" ? "Weft" : "Warp",
    model: primaryModel,
  } as const

  if (rawConfigured.length === 0) {
    return {
      kind: "primary-only",
      scope,
      baseAgent,
      primary,
      reason: "no-variants",
    }
  }

  if (rawConfigured.length > 0 && allVariants.length === 0) {
    return {
      kind: "primary-only",
      scope,
      baseAgent,
      primary,
      reason: "all-variants-disabled",
    }
  }

  return {
    kind: "fan-out",
    scope,
    baseAgent,
    primary,
    variants: allVariants,
    batch: {
      mode: "parallel",
      size: 1 + allVariants.length,
    },
  }
}
