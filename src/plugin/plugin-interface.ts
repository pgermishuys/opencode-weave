import type { PluginInterface, ToolsRecord } from "./types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import { getAgentDisplayName } from "../shared/agent-display-names"

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
        const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
        const message = (_output as Record<string, unknown>).message as
          | Record<string, unknown>
          | undefined

        // Defensively substitute template placeholders that OpenCode should have replaced.
        // If OpenCode already substituted them these replacements are harmless no-ops.
        if (parts) {
          const timestamp = new Date().toISOString()
          for (const part of parts) {
            if (part.type === "text" && part.text) {
              part.text = part.text
                .replace(/\$SESSION_ID/g, sessionID)
                .replace(/\$TIMESTAMP/g, timestamp)
            }
          }
        }

        const promptText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() ?? ""

        const result = hooks.startWork(promptText, sessionID)

        // Switch agent by mutating output.message.agent (OpenCode reads this to route the message)
        if (result.switchAgent && message) {
          message.agent = getAgentDisplayName(result.switchAgent)
        }

        if (result.contextInjection && parts) {
          // Mutate the existing text part in-place (do NOT replace the parts array reference)
          const idx = parts.findIndex((p) => p.type === "text" && p.text)
          if (idx >= 0 && parts[idx].text) {
            parts[idx].text += `\n\n---\n${result.contextInjection}`
          } else {
            // No existing text part — create one so the context isn't lost
            parts.push({ type: "text", text: result.contextInjection })
          }
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
        const evt = event as { type: string; properties: { sessionID: string } }
        const sessionId = evt.properties?.sessionID ?? ""
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
