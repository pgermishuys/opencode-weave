import type { PluginInput } from "@opencode-ai/plugin"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "./config/schema"
import type { ResolveSkillsFn } from "./agents/agent-builder"
import { ConfigHandler } from "./managers/config-handler"
import { BackgroundManager } from "./managers/background-manager"
import { SkillMcpManager } from "./managers/skill-mcp-manager"
import { createBuiltinAgents } from "./agents/builtin-agents"

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
}): WeaveManagers {
  const { pluginConfig, resolveSkills } = options

  const agents = createBuiltinAgents({
    disabledAgents: pluginConfig.disabled_agents,
    agentOverrides: pluginConfig.agents,
    resolveSkills,
  })

  const configHandler = new ConfigHandler({ pluginConfig })
  const backgroundManager = new BackgroundManager({
    maxConcurrent: pluginConfig.background?.defaultConcurrency ?? 5,
  })
  const skillMcpManager = new SkillMcpManager()

  return { configHandler, backgroundManager, skillMcpManager, agents }
}
