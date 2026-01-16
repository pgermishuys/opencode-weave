/**
 * Tool permission management — per-agent grant/deny tool lists.
 *
 * Tools are represented as a boolean map where false = denied.
 * This matches the AgentConfig.tools shape from @opencode-ai/sdk.
 */

export type ToolPermissionMap = Record<string, boolean>

export type ToolPermissions = {
  getRestrictions(agentName: string): ToolPermissionMap
  isToolAllowed(agentName: string, toolName: string): boolean
}

/**
 * Build a ToolPermissions object from a record of agent configs.
 *
 * Each agent config's `tools` map is extracted and used for permission checks.
 * Agents without a `tools` map have no restrictions (all tools allowed).
 */
export function createToolPermissions(
  agentRestrictions: Record<string, ToolPermissionMap>
): ToolPermissions {
  return {
    getRestrictions(agentName: string): ToolPermissionMap {
      return agentRestrictions[agentName] ?? {}
    },

    isToolAllowed(agentName: string, toolName: string): boolean {
      const restrictions = agentRestrictions[agentName]
      if (!restrictions) return true
      const permission = restrictions[toolName]
      if (permission === undefined) return true
      return permission
    },
  }
}
