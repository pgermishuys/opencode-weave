import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import { getAgentDisplayName } from "../shared/agent-display-names"

/** Input to the config pipeline */
export interface ConfigPipelineInput {
  pluginConfig: WeaveConfig
  /** Available agents from createBuiltinAgents (or empty for testing) */
  agents?: Record<string, AgentConfig>
  /** Available tool names */
  availableTools?: string[]
}

/** Output from config pipeline */
export interface ConfigPipelineOutput {
  agents: Record<string, AgentConfig>
  /** Default agent display name (set on config.default_agent) */
  defaultAgent?: string
  tools: string[]
  mcps: Record<string, unknown>
  commands: Record<string, unknown>
}

/**
 * Runs the 6-phase config pipeline for the OpenCode config hook.
 * Phases 1, 4, 5, 6 are pass-through for v1.
 * Phase 2 merges agent overrides, filters disabled, and remaps keys to display names.
 * Phase 3 filters disabled tools.
 */
export class ConfigHandler {
  private readonly pluginConfig: WeaveConfig

  constructor(options: { pluginConfig: WeaveConfig }) {
    this.pluginConfig = options.pluginConfig
  }

  /** Run the 6-phase pipeline and return accumulated config output */
  async handle(input: ConfigPipelineInput): Promise<ConfigPipelineOutput> {
    const { pluginConfig, agents = {}, availableTools = [] } = input

    // Phase 1: applyProviderConfig — no-op for v1
    this.applyProviderConfig()

    // Phase 2: applyAgentConfig — merge overrides, exclude disabled, remap keys
    const resolvedAgents = this.applyAgentConfig(agents, pluginConfig)

    // Phase 3: applyToolConfig — filter disabled tools
    const resolvedTools = this.applyToolConfig(availableTools, pluginConfig)

    // Phase 4: applyMcpConfig — empty for v1
    const resolvedMcps = this.applyMcpConfig()

    // Phase 5: applyCommandConfig — empty for v1
    const resolvedCommands = this.applyCommandConfig()

    // Phase 6: applySkillConfig — no-op for v1
    this.applySkillConfig()

    // Determine default agent display name (loom is default primary agent)
    const defaultAgent = this.resolveDefaultAgent(resolvedAgents)

    return {
      agents: resolvedAgents,
      defaultAgent,
      tools: resolvedTools,
      mcps: resolvedMcps,
      commands: resolvedCommands,
    }
  }

  /** Phase 1: Provider detection happens elsewhere — pass through */
  private applyProviderConfig(): void {
    // no-op for v1
  }

  /**
   * Phase 2: Merge agent overrides from pluginConfig.agents.
   * Exclude agents listed in pluginConfig.disabled_agents.
   * Remap keys from config keys (e.g., "loom") to display names (e.g., "Loom (Main Orchestrator)").
   */
  private applyAgentConfig(
    agents: Record<string, AgentConfig>,
    pluginConfig: WeaveConfig,
  ): Record<string, AgentConfig> {
    const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
    const overrides = pluginConfig.agents ?? {}

    const result: Record<string, AgentConfig> = {}

    for (const [name, agentConfig] of Object.entries(agents)) {
      if (disabledSet.has(name)) {
        continue
      }

      const override = overrides[name]
      const merged = override ? { ...agentConfig, ...override } : { ...agentConfig }

      // Remap key to display name for OpenCode UI
      const displayName = getAgentDisplayName(name)
      result[displayName] = merged
    }

    return result
  }

  /**
   * Resolve the default agent display name.
   * Returns the display name of "loom" if present in resolved agents, otherwise first primary agent.
   */
  private resolveDefaultAgent(agents: Record<string, AgentConfig>): string | undefined {
    const loomDisplayName = getAgentDisplayName("loom")
    if (agents[loomDisplayName]) return loomDisplayName
    // Fallback: first agent in the map
    const firstKey = Object.keys(agents)[0]
    return firstKey
  }

  /** Phase 3: Filter tools by disabled_tools */
  private applyToolConfig(availableTools: string[], pluginConfig: WeaveConfig): string[] {
    const disabledSet = new Set(pluginConfig.disabled_tools ?? [])
    return availableTools.filter((tool) => !disabledSet.has(tool))
  }

  /** Phase 4: MCP loading is done elsewhere — return empty for v1 */
  private applyMcpConfig(): Record<string, unknown> {
    return {}
  }

  /** Phase 5: Return empty commands for v1 */
  private applyCommandConfig(): Record<string, unknown> {
    return {}
  }

  /** Phase 6: Skill injection happens in agent builder — no-op for v1 */
  private applySkillConfig(): void {
    // no-op for v1
  }
}
