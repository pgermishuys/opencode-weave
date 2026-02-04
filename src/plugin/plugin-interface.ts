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

    config: async (config: Record<string, unknown>) => {
      const result = await configHandler.handle({
        pluginConfig,
        agents,
        availableTools: [],
      })
      // Mutate the config object to register agents with OpenCode
      // Keys are display names (e.g., "Loom (Main Orchestrator)")
      config.agent = result.agents

      // Register slash commands so OpenCode exposes them (e.g., /start-work)
      config.command = result.commands

      // Set the default agent so OpenCode selects it on startup
      if (result.defaultAgent) {
        config.default_agent = result.defaultAgent
      }
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

      // /start-work command detection and plan resolution
      if (hooks.startWork) {
        const promptText =
          _output.parts
            ?.filter((p: { type: string }) => p.type === "text")
            .map((p: { type: string; text?: string }) => p.text ?? "")
            .join("\n") ?? ""

        const result = hooks.startWork(promptText, sessionID)
        if (result.contextInjection) {
          // Inject plan context into the message parts
          _output.parts = [
            ...(_output.parts ?? []),
            { type: "text", text: `\n\n${result.contextInjection}` },
          ]
        }
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

      // Work continuation: nudge idle sessions with active plans
      if (hooks.workContinuation && event.type === "session.idle") {
        const evt = event as { type: string; properties: { info: { id: string } } }
        const sessionId = evt.properties?.info?.id ?? ""
        if (sessionId) {
          const result = hooks.workContinuation(sessionId)
          if (result.continuationPrompt) {
            // The continuation prompt is available for the host to inject
            // In a full implementation, this would use promptAsync or similar
          }
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

      // Pattern MD-only guard: block Pattern from writing non-.md files outside .weave/
      if (filePath && hooks.patternMdOnly) {
        const agentName = (input as Record<string, unknown>).agent as string | undefined
        if (agentName) {
          const check = hooks.patternMdOnly(agentName, input.tool, filePath)
          if (!check.allowed) {
            throw new Error(check.reason ?? "Pattern agent is restricted to .md files in .weave/")
          }
        }
      }
    },

    "tool.execute.after": async (_input, _output) => {
      // pass-through for v1
    },
  }
}
