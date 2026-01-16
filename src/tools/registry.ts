import type { WeaveConfig } from "../config/schema"
import type { ToolPermissions, ToolPermissionMap } from "./permissions"
import { createToolPermissions } from "./permissions"

export type { ToolPermissions, ToolPermissionMap }

/**
 * Result from createToolRegistry.
 * filteredTools: tool names allowed globally (not in disabled_tools).
 * permissions: per-agent tool permission checker.
 * taskSystemEnabled: whether the task spawning tool is globally enabled.
 */
export interface ToolRegistryResult {
  filteredTools: string[]
  permissions: ToolPermissions
  taskSystemEnabled: boolean
}

export interface ToolRegistryOptions {
  /** All available tool names (from OpenCode's tool system) */
  availableTools: string[]
  /** Config with disabled_tools list */
  config: WeaveConfig
  /** Per-agent tool restriction maps (from agent configs) */
  agentRestrictions: Record<string, ToolPermissionMap>
}

/**
 * Create a tool registry that filters by disabled_tools and builds per-agent permissions.
 *
 * Tools are not reimplemented here — they come from OpenCode.
 * Weave only manages which tools are visible and which are denied per agent.
 */
export function createToolRegistry(options: ToolRegistryOptions): ToolRegistryResult {
  const { availableTools, config, agentRestrictions } = options

  const disabledSet = new Set(config.disabled_tools ?? [])

  const filteredTools = availableTools.filter((tool) => !disabledSet.has(tool))

  const taskSystemEnabled = !disabledSet.has("task")

  const permissions = createToolPermissions(agentRestrictions)

  return {
    filteredTools,
    permissions,
    taskSystemEnabled,
  }
}
