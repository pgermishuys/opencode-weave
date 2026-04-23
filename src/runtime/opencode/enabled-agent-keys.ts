import type { WeaveConfig } from "../../config/schema"
import type { AvailableAgent } from "../../agents/dynamic-prompt-builder"
import { resolveEffectiveReviewers } from "../../review/reviewer-resolution"

const BUILTIN_AGENT_NAMES = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft", "warp"] as const

/**
 * Derives the full set of enabled agent keys from a WeaveConfig.
 *
 * Includes:
 * - Built-in agents that are not disabled
 * - Custom agents that are not disabled
 * - `shuttle-{category}` agents for all defined categories (patterns only affect
 *   routing hints in Tapestry's prompt, not agent existence),
 *   as long as the base `shuttle` agent is not disabled and the specific
 *   `shuttle-{category}` key is not disabled
 */
export function buildEnabledAgentKeys(pluginConfig: WeaveConfig): Set<string> {
  const disabled = new Set(pluginConfig.disabled_agents ?? [])
  const enabled = new Set<string>()

  for (const builtin of BUILTIN_AGENT_NAMES) {
    if (!disabled.has(builtin)) {
      enabled.add(builtin)
    }
  }

  for (const custom of Object.keys(pluginConfig.custom_agents ?? {})) {
    if (!disabled.has(custom)) {
      enabled.add(custom)
    }
  }

  // Add shuttle-{category} agents for all defined categories (patterns affect routing hints only, not existence)
  const shuttleEnabled = !disabled.has("shuttle")
  if (shuttleEnabled && pluginConfig.categories) {
    for (const categoryName of Object.keys(pluginConfig.categories)) {
      const categoryAgentName = `shuttle-${categoryName}`
      if (!disabled.has(categoryAgentName)) {
        enabled.add(categoryAgentName)
      }
    }
  }

  return enabled
}

/**
 * Derives only effective additional reviewer keys from review.additional_agents.
 *
 * Notes:
 * - Excludes `weft` because it remains built-in always-on reviewer flow.
 * - Excludes `warp` because security review is resolved separately.
 */
export function buildEffectiveAdditionalReviewerKeys(
  pluginConfig: WeaveConfig,
  customAgentMetadata: AvailableAgent[],
): Set<string> {
  const resolution = resolveEffectiveReviewers({ pluginConfig, customAgentMetadata })
  return new Set(resolution.effectiveReviewers.map((reviewer) => reviewer.key))
}
