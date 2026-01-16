import type { PluginInterface, ToolsRecord } from "./types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"

export function createPluginInterface(args: {
  pluginConfig: WeaveConfig
  hooks: CreatedHooks
  tools: ToolsRecord
  configHandler: ConfigHandler
  agents: Record<string, AgentConfig>
}): PluginInterface {
  const { pluginConfig, hooks, tools, configHandler, agents } = args

  return {
    tool: tools,

    config: async (_input) => {
      await configHandler.handle({
        pluginConfig,
        agents,
        availableTools: [],
      })
    },

    "chat.message": async (input, _output) => {
      const { sessionID } = input

      if (hooks.checkContextWindow) {
        hooks.checkContextWindow({
          usedTokens: 0,
          maxTokens: 0,
          sessionId: sessionID,
        })
      }

      if (hooks.firstMessageVariant) {
        if (hooks.firstMessageVariant.shouldApplyVariant(sessionID)) {
          hooks.firstMessageVariant.markApplied(sessionID)
        }
      }

      if (hooks.processMessageForKeywords) {
        hooks.processMessageForKeywords("", sessionID)
      }
    },

    "chat.params": async (_input, _output) => {
      // pass-through for v1
    },

    "chat.headers": async (_input, _output) => {
      // pass-through for v1
    },

    event: async (input) => {
      const { event } = input

      if (hooks.firstMessageVariant) {
        if (event.type === "session.created") {
          const evt = event as { type: string; properties: { info: { id: string } } }
          hooks.firstMessageVariant.markSessionCreated(evt.properties.info.id)
        }
        if (event.type === "session.deleted") {
          const evt = event as { type: string; properties: { info: { id: string } } }
          hooks.firstMessageVariant.clearSession(evt.properties.info.id)
        }
      }
    },

    "tool.execute.before": async (input, _output) => {
      const args = _output.args as Record<string, unknown> | null | undefined
      const filePath =
        (args?.file_path as string | undefined) ??
        (args?.path as string | undefined) ??
        ""

      if (filePath && hooks.shouldInjectRules && hooks.getRulesForFile) {
        if (hooks.shouldInjectRules(input.tool)) {
          hooks.getRulesForFile(filePath)
          // rules content available — would inject into context in full implementation
        }
      }

      if (filePath && hooks.writeGuard) {
        if (input.tool === "read") {
          hooks.writeGuard.trackRead(filePath)
        }
      }
    },

    "tool.execute.after": async (_input, _output) => {
      // pass-through for v1
    },
  }
}
