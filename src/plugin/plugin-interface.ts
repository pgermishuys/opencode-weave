import type { PluginInterface, ToolsRecord } from "./types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { PluginContext } from "./types"
import type { SessionTracker } from "../features/analytics"
import { createPluginAdapter } from "../runtime/opencode/plugin-adapter"

export function createPluginInterface(args: {
  pluginConfig: WeaveConfig
  hooks: CreatedHooks
  tools: ToolsRecord
  configHandler: ConfigHandler
  agents: Record<string, AgentConfig>
  client?: PluginContext["client"]
  directory?: string
  tracker?: SessionTracker
}): PluginInterface {
  const { pluginConfig, hooks, tools, configHandler, agents, client, directory = "", tracker } = args

  const adapter = createPluginAdapter({
    pluginConfig,
    hooks,
    tools,
    configHandler,
    agents,
    client,
    directory,
    tracker,
  })

  return {
    tool: tools,
    config: async (config: Record<string, unknown>) => adapter.config(config),
    "chat.message": async (input, output) => adapter.handleChatMessage({ sessionID: input.sessionID }, output as never),
    "chat.params": async (input, _output) => adapter.handleChatParams(input as never),
    "chat.headers": async (_input, _output) => {
      // pass-through for v1
    },
    event: async (input) => adapter.handleEvent({ event: input.event as never }),
    "tool.execute.before": async (input, output) => adapter.handleToolExecuteBefore(input as never, output as never),
    "tool.execute.after": async (input, output) => adapter.handleToolExecuteAfter(input as never, output as never),
    "command.execute.before": async (input, output) => adapter.handleCommandExecuteBefore(input as never, output as never),
    "tool.definition": async (input, output) => adapter.handleToolDefinition(input as never, output as never),
    "experimental.session.compacting": async (input) => adapter.handleSessionCompacting(input as never),
  }
}
