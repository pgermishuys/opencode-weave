import type { PluginInput } from "@opencode-ai/plugin"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "./config/schema"
import type { ResolveSkillsFn } from "./agents/agent-builder"
import type { ProjectFingerprint } from "./features/analytics/types"
import { ConfigHandler } from "./managers/config-handler"
import { BackgroundManager } from "./managers/background-manager"
import { SkillMcpManager } from "./managers/skill-mcp-manager"
import { createBuiltinAgents } from "./agents/builtin-agents"
import { buildCustomAgent, buildCustomAgentMetadata } from "./agents/custom-agent-factory"
import { AGENT_METADATA } from "./agents/builtin-agents"

export interface WeaveManagers {
  configHandler: ConfigHandler
  backgroundManager: BackgroundManager
  skillMcpManager: SkillMcpManager
  agents: Record<string, AgentConfig>
}

export function createManagers(options: {
  ctx: PluginInput
  pluginConfig: WeaveConfig
  resolveSkills?: ResolveSkillsFn
  fingerprint?: ProjectFingerprint | null
}): WeaveManagers {
  const { pluginConfig, resolveSkills, fingerprint } = options

  const agents = createBuiltinAgents({
    disabledAgents: pluginConfig.disabled_agents,
    agentOverrides: pluginConfig.agents,
    resolveSkills,
    fingerprint,
  })

  // Register custom agents from config
  if (pluginConfig.custom_agents) {
    const disabledSet = new Set(pluginConfig.disabled_agents ?? [])
    for (const [name, customConfig] of Object.entries(pluginConfig.custom_agents)) {
      // Skip disabled custom agents
      if (disabledSet.has(name)) continue
      // Prevent custom agents from overriding built-in agents
      if (agents[name] !== undefined) continue

      agents[name] = buildCustomAgent(name, customConfig, {
        resolveSkills,
        disabledSkills: pluginConfig.disabled_skills ? new Set(pluginConfig.disabled_skills) : undefined,
      })

      // Register metadata for Loom's dynamic prompt integration
      const metadata = buildCustomAgentMetadata(name, customConfig)
      ;(AGENT_METADATA as Record<string, typeof metadata>)[name] = metadata
    }
  }

  const configHandler = new ConfigHandler({ pluginConfig })
  const backgroundManager = new BackgroundManager({
    maxConcurrent: pluginConfig.background?.defaultConcurrency ?? 5,
  })
  const skillMcpManager = new SkillMcpManager()

  return { configHandler, backgroundManager, skillMcpManager, agents }
}
