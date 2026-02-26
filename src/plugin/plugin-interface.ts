import type { PluginInterface, ToolsRecord } from "./types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { PluginContext } from "./types"
import { getAgentDisplayName } from "../shared/agent-display-names"
import { log, logDelegation } from "../shared/log"
import {
  setContextLimit,
  updateUsage,
  getState as getTokenState,
  clearTokenSession,
} from "../hooks"

export function createPluginInterface(args: {
  pluginConfig: WeaveConfig
  hooks: CreatedHooks
  tools: ToolsRecord
  configHandler: ConfigHandler
  agents: Record<string, AgentConfig>
  client?: PluginContext["client"]
}): PluginInterface {
  const { pluginConfig, hooks, tools, configHandler, agents, client } = args

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
      const input = _input as {
        sessionID?: string
        model?: { limit?: { context?: number } }
      }
      const sessionId = input.sessionID ?? ""
      const maxTokens = input.model?.limit?.context ?? 0
      if (sessionId && maxTokens > 0) {
        setContextLimit(sessionId, maxTokens)
        log("[context-window] Captured context limit", { sessionId, maxTokens })
      }
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

      // Clean up token state when session ends
      if (event.type === "session.deleted") {
        const evt = event as { type: string; properties: { info: { id: string } } }
        clearTokenSession(evt.properties.info.id)
      }

      // Context window monitoring: process assistant message token usage
      if (event.type === "message.updated" && hooks.checkContextWindow) {
        const evt = event as {
          type: string
          properties: {
            info: {
              role?: string
              sessionID?: string
              tokens?: { input?: number }
            }
          }
        }
        const info = evt.properties?.info
        if (info?.role === "assistant" && info.sessionID) {
          const inputTokens = info.tokens?.input ?? 0
          if (inputTokens > 0) {
            updateUsage(info.sessionID, inputTokens)
            const tokenState = getTokenState(info.sessionID)
            if (tokenState && tokenState.maxTokens > 0) {
              const result = hooks.checkContextWindow({
                usedTokens: tokenState.usedTokens,
                maxTokens: tokenState.maxTokens,
                sessionId: info.sessionID,
              })
              if (result.action !== "none") {
                log("[context-window] Threshold crossed", {
                  sessionId: info.sessionID,
                  action: result.action,
                  usagePct: result.usagePct,
                })
              }
            }
          }
        }
      }

      // Work continuation: nudge idle sessions with active plans
      if (hooks.workContinuation && event.type === "session.idle") {
        const evt = event as { type: string; properties: { sessionID: string } }
        const sessionId = evt.properties?.sessionID ?? ""
        if (sessionId) {
          const result = hooks.workContinuation(sessionId)
          if (result.continuationPrompt && client) {
            try {
              await client.session.promptAsync({
                path: { id: sessionId },
                body: {
                  ...(result.switchAgent ? { agent: getAgentDisplayName(result.switchAgent) } : {}),
                  parts: [
                    { type: "text" as const, text: result.continuationPrompt },
                  ],
                },
              })
              log("[work-continuation] Injected continuation prompt", { sessionId })
            } catch (err) {
              log("[work-continuation] Failed to inject continuation", { sessionId, error: String(err) })
            }
          } else if (result.continuationPrompt) {
            // client not available — log for diagnostics
            log("[work-continuation] continuationPrompt available but no client", { sessionId })
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

      // Log delegation starts when the task tool is invoked
      if (input.tool === "task" && args) {
        const agentArg =
          (args.subagent_type as string | undefined) ??
          (args.description as string | undefined) ??
          "unknown"
        logDelegation({
          phase: "start",
          agent: agentArg,
          sessionId: input.sessionID,
          toolCallId: input.callID,
        })
      }
    },

    "tool.execute.after": async (input, _output) => {
      // Log delegation completions when the task tool finishes
      if (input.tool === "task") {
        const inputArgs = (input as Record<string, unknown>).args as Record<string, unknown> | undefined
        const agentArg =
          (inputArgs?.subagent_type as string | undefined) ??
          (inputArgs?.description as string | undefined) ??
          "unknown"
        logDelegation({
          phase: "complete",
          agent: agentArg,
          sessionId: input.sessionID,
          toolCallId: input.callID,
        })
      }

      // Verification reminder: fire when an edit targets a plan file (.weave/plans/*.md)
      if (input.tool === "edit" && hooks.verificationReminder) {
        const inputArgs = (input as Record<string, unknown>).args as Record<string, unknown> | undefined
        const filePath =
          (inputArgs?.filePath as string | undefined) ??
          (inputArgs?.file_path as string | undefined) ??
          ""
        const isPlanFile = filePath.includes(".weave/plans/") && filePath.endsWith(".md")
        if (isPlanFile) {
          const result = hooks.verificationReminder({})
          log("[verification-reminder] Fired after plan file edit", {
            filePath,
            sessionId: input.sessionID,
            hasPrompt: result.verificationPrompt !== null,
          })
        }
      }

    },
  }
}
