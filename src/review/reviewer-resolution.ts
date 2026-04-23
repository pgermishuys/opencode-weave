import type { WeaveConfig } from "../config/schema"
import type { AvailableAgent } from "../agents/dynamic-prompt-builder"
import { warnConfig } from "../shared/log"

export type ReviewerSource = "builtin" | "custom"

export interface ResolvedReviewer {
  key: string
  label: string
  source: ReviewerSource
  isValid: boolean
}

export interface ReviewerResolutionResult {
  reviewers: ResolvedReviewer[]
  effectiveReviewers: ResolvedReviewer[]
  warnings: string[]
}

const RESERVED_REVIEWER_KEYS = new Set(["weft", "warp"])
const BUILTIN_AGENT_KEYS = new Set(["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft", "warp"])

export function resolveEffectiveReviewers(input: {
  pluginConfig: WeaveConfig
  customAgentMetadata: AvailableAgent[]
}): ReviewerResolutionResult {
  const { pluginConfig, customAgentMetadata } = input

  const requested = pluginConfig.review?.additional_agents ?? []
  const disabled = new Set(pluginConfig.disabled_agents ?? [])
  const customConfig = pluginConfig.custom_agents ?? {}

  const metadataByLower = new Map<string, AvailableAgent>()
  for (const agent of customAgentMetadata) {
    metadataByLower.set(agent.name.toLowerCase(), agent)
  }

  const customByLower = new Map<string, string>()
  for (const key of Object.keys(customConfig)) {
    customByLower.set(key.toLowerCase(), key)
  }

  const reviewers: ResolvedReviewer[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const raw of requested) {
    const key = raw.trim()
    if (!key) {
      const warning = "Ignoring empty review.additional_agents entry — remove empty values from config"
      warnings.push(warning)
      warnConfig(warning)
      continue
    }

    const normalized = key.toLowerCase()
    if (seen.has(normalized)) {
      const warning = `Ignoring duplicate reviewer \"${key}\" in review.additional_agents`
      warnings.push(warning)
      warnConfig(warning)
      continue
    }
    seen.add(normalized)

    const source: ReviewerSource = BUILTIN_AGENT_KEYS.has(normalized) ? "builtin" : "custom"

    if (RESERVED_REVIEWER_KEYS.has(normalized)) {
      const warning = `Ignoring reviewer \"${key}\" in review.additional_agents: \"${normalized}\" is managed by built-in review flow`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({ key: normalized, label: normalized, source: "builtin", isValid: false })
      continue
    }

    if (source === "builtin") {
      const warning = `Ignoring reviewer \"${key}\" in review.additional_agents: only custom_agents keys are supported`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({ key: normalized, label: key, source, isValid: false })
      continue
    }

    const resolvedCustomKey = customByLower.get(normalized)
    if (!resolvedCustomKey) {
      const warning = `Ignoring reviewer \"${key}\" in review.additional_agents: custom agent not found`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({ key, label: key, source, isValid: false })
      continue
    }

    if (disabled.has(resolvedCustomKey)) {
      const warning = `Ignoring reviewer \"${resolvedCustomKey}\" in review.additional_agents: agent is disabled via disabled_agents`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({ key: resolvedCustomKey, label: resolvedCustomKey, source, isValid: false })
      continue
    }

    const metadata = metadataByLower.get(resolvedCustomKey.toLowerCase())
    if (!metadata) {
      const warning = `Ignoring reviewer \"${resolvedCustomKey}\" in review.additional_agents: custom agent metadata is unavailable`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({ key: resolvedCustomKey, label: resolvedCustomKey, source, isValid: false })
      continue
    }

    const customDisplay = customConfig[resolvedCustomKey]?.display_name?.trim()
    const mode = customConfig[resolvedCustomKey]?.mode
    if (mode === "primary") {
      const warning = `Ignoring reviewer \"${resolvedCustomKey}\" in review.additional_agents: custom agent mode \"primary\" cannot be delegated via subagent_type; use mode \"subagent\" or \"all\"`
      warnings.push(warning)
      warnConfig(warning)
      reviewers.push({
        key: resolvedCustomKey,
        label: customDisplay || metadata.description || resolvedCustomKey,
        source,
        isValid: false,
      })
      continue
    }

    reviewers.push({
      key: resolvedCustomKey,
      label: customDisplay || metadata.description || resolvedCustomKey,
      source,
      isValid: true,
    })
  }

  return {
    reviewers,
    effectiveReviewers: reviewers.filter((reviewer) => reviewer.isValid),
    warnings,
  }
}
