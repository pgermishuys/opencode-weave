/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "loom", "thread").
 * Display names include role suffixes for UI (e.g., "Loom (Main Orchestrator)").
 *
 * OpenCode uses the agent key in config.agent as the display name in the UI,
 * so we remap lowercase config keys to descriptive display names.
 *
 * This map is mutable — custom agents can register display names via
 * registerAgentDisplayName().
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

/** Built-in agent config keys — these cannot be overwritten by custom agents */
const BUILTIN_CONFIG_KEYS = new Set(Object.keys(AGENT_DISPLAY_NAMES))

/** Lazily-computed reverse lookup (display name → config key). Invalidated on registration. */
let reverseDisplayNames: Record<string, string> | null = null

function getReverseDisplayNames(): Record<string, string> {
  if (reverseDisplayNames === null) {
    reverseDisplayNames = Object.fromEntries(
      Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]),
    )
  }
  return reverseDisplayNames
}

/**
 * Register a display name for an agent config key.
 * Custom agents call this so getAgentDisplayName/getAgentConfigKey work for them.
 *
 * Throws if the display name collides with a built-in agent's display name,
 * or if the config key is a built-in agent name.
 */
export function registerAgentDisplayName(configKey: string, displayName: string): void {
  // Prevent custom agents from using a builtin config key
  if (BUILTIN_CONFIG_KEYS.has(configKey)) {
    throw new Error(
      `Cannot register display name for "${configKey}": it is a built-in agent name`,
    )
  }

  // Prevent custom agents from claiming a builtin agent's display name
  const reverse = getReverseDisplayNames()
  const existingKey = reverse[displayName.toLowerCase()]
  if (existingKey !== undefined && BUILTIN_CONFIG_KEYS.has(existingKey)) {
    throw new Error(
      `Display name "${displayName}" is reserved for built-in agent "${existingKey}"`,
    )
  }

  AGENT_DISPLAY_NAMES[configKey] = displayName
  reverseDisplayNames = null // invalidate cache
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

/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Loom (Main Orchestrator)" → "loom", "loom" → "loom", "unknown" → "unknown"
 */
export function getAgentConfigKey(agentName: string): string {
  const lower = agentName.toLowerCase()
  const reverse = getReverseDisplayNames()
  const reversed = reverse[lower]
  if (reversed !== undefined) return reversed
  if (AGENT_DISPLAY_NAMES[lower] !== undefined) return lower
  return lower
}
