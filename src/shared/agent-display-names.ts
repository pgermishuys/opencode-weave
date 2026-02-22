/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "loom", "thread").
 * Display names include role suffixes for UI (e.g., "Loom (Main Orchestrator)").
 *
 * OpenCode uses the agent key in config.agent as the display name in the UI,
 * so we remap lowercase config keys to descriptive display names.
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  loom: "Loom (Main Orchestrator)",
  tapestry: "Tapestry (Execution Orchestrator)",
  shuttle: "shuttle",
  pattern: "pattern",
  thread: "thread",
  spindle: "spindle",
  warp: "warp",
  weft: "weft",
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for flexibility.
 * Returns original key if not found in the mapping.
 */
export function getAgentDisplayName(configKey: string): string {
  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[configKey]
  if (exactMatch !== undefined) return exactMatch

  // Fall back to case-insensitive search
  const lowerKey = configKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }

  // Unknown agent: return original key
  return configKey
}

const REVERSE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]),
)

/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Loom (Main Orchestrator)" → "loom", "loom" → "loom", "unknown" → "unknown"
 */
export function getAgentConfigKey(agentName: string): string {
  const lower = agentName.toLowerCase()
  const reversed = REVERSE_DISPLAY_NAMES[lower]
  if (reversed !== undefined) return reversed
  if (AGENT_DISPLAY_NAMES[lower] !== undefined) return lower
  return lower
}
