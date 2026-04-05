import type { PluginInterface, ToolsRecord } from "./types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../config/schema"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { PluginContext } from "./types"
import type { SessionTracker } from "../features/analytics"
import { getAgentDisplayName } from "../shared/agent-display-names"
import { logDelegation, debug, info, warn, error } from "../shared/log"
import {
  setContextLimit,
  updateUsage,
  getState as getTokenState,
  clearTokenSession,
} from "../hooks"
import { pauseWork, readWorkState } from "../features/work-state"
import { getPlanProgress } from "../features/work-state/storage"
import { CONTINUATION_MARKER } from "../hooks/work-continuation"
import { WORKFLOW_CONTINUATION_MARKER } from "../features/workflow/hook"
import { createCompactionTodoPreserver } from "../hooks/compaction-todo-preserver"
import { createTodoContinuationEnforcer, FINALIZE_TODOS_MARKER } from "../hooks/todo-continuation-enforcer"
import { getActiveWorkflowInstance, pauseWorkflow } from "../features/workflow"
import { readSessionSummaries, readMetricsReports } from "../features/analytics/storage"
import { generateTokenReport } from "../features/analytics/token-report"
import { formatMetricsMarkdown } from "../features/analytics/format-metrics"
import { generateMetricsReport } from "../features/analytics/generate-metrics-report"
import { getLastConfigLoadResult } from "../config/loader"
import { generateHealthReport } from "../features/health-report"

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

  /**
   * Track assistant message text from message.part.updated events.
   * message.updated events do NOT carry message content — only metadata.
   * We accumulate the latest text per session for workflow completion detection.
   */
  const lastAssistantMessageText = new Map<string, string>()
  /** Track last user message text per session for user_confirm completion detection. */
  const lastUserMessageText = new Map<string, string>()

  // Hook 2: compaction todo preserver (stateful, needs client)
  const compactionPreserver =
    hooks.compactionTodoPreserverEnabled && client
      ? createCompactionTodoPreserver(client)
      : null

  // Hook 3: todo continuation enforcer (extracted from inline logic, needs client)
  const todoContinuationEnforcer =
    hooks.todoContinuationEnforcerEnabled && client
      ? createTodoContinuationEnforcer(client)
      : null

  return {
    tool: tools,

    config: async (config: Record<string, unknown>) => {
      const result = await configHandler.handle({
        pluginConfig,
        agents,
        availableTools: [],
      })
      // Merge Weave agents with any existing agents (e.g., user-defined .md/.json agents).
      // Spread existing first so user agents are preserved; Weave agents win on collision.
      const existingAgents = (config.agent ?? {}) as Record<string, unknown>
      if (Object.keys(existingAgents).length > 0) {
        debug("[config] Merging Weave agents over existing agents", {
          existingCount: Object.keys(existingAgents).length,
          weaveCount: Object.keys(result.agents).length,
          existingKeys: Object.keys(existingAgents),
        })
        const collisions = Object.keys(result.agents).filter(key => key in existingAgents)
        if (collisions.length > 0) {
          info("[config] Weave agents overriding user-defined agents with same name", {
            overriddenKeys: collisions,
          })
        }
      }
      config.agent = { ...existingAgents, ...result.agents }

      // Merge Weave commands with any existing commands (preserves user-defined commands).
      const existingCommands = (config.command ?? {}) as Record<string, unknown>
      config.command = { ...existingCommands, ...result.commands }

      // Set the default agent only if the user hasn't already configured one.
      if (result.defaultAgent && !config.default_agent) {
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

        // Skip start-work processing for /run-workflow commands — both templates use
        // <session-context> tags, but they are different commands with different agents.
        // Without this guard, startWork would try to match a plan name from the workflow
        // arguments, switch to Tapestry, and inject a "Plan Not Found" error.
        const isWorkflowCommand = promptText.includes("workflow engine will inject context")

        const result = isWorkflowCommand
          ? { contextInjection: null, switchAgent: null }
          : hooks.startWork(promptText, sessionID)

        // Switch agent by mutating output.message.agent (OpenCode reads this to route the message)
        if (result.switchAgent && message) {
          message.agent = getAgentDisplayName(result.switchAgent)
          debug("[start-work] Switching agent for plan execution", {
            sessionId: sessionID,
            agent: result.switchAgent,
            displayName: message.agent,
            hasContextInjection: !!result.contextInjection,
          })
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

      // /run-workflow command detection and workflow instance management
      if (hooks.workflowStart) {
        const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
        const message = (_output as Record<string, unknown>).message as
          | Record<string, unknown>
          | undefined

        const promptText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() ?? ""

        // Only handle if this looks like a /run-workflow command (has the template marker)
        if (promptText.includes("workflow engine will inject context")) {
          const result = hooks.workflowStart(promptText, sessionID)

          if (result.switchAgent && message) {
            message.agent = getAgentDisplayName(result.switchAgent)
            debug("[workflow] Switching agent for workflow execution", {
              sessionId: sessionID,
              agent: result.switchAgent,
              displayName: message.agent,
            })
          }

          if (result.contextInjection && parts) {
            const idx = parts.findIndex((p) => p.type === "text" && p.text)
            if (idx >= 0 && parts[idx].text) {
              parts[idx].text += `\n\n---\n${result.contextInjection}`
            } else {
              parts.push({ type: "text", text: result.contextInjection })
            }
          }
        }
      }

      // Track user message text per session for workflow completion detection (user_confirm).
      // IMPORTANT: Only track genuine user messages — filter out system-injected prompts
      // (workflow continuation, work continuation, todo finalization) to prevent false
      // completion triggers (e.g., "continue" keyword in a continuation prompt).
      {
        const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
        const userText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() ?? ""
        if (userText && sessionID) {
          const isSystemInjected =
            userText.includes(WORKFLOW_CONTINUATION_MARKER) ||
            userText.includes(CONTINUATION_MARKER) ||
            userText.includes(FINALIZE_TODOS_MARKER) ||
            userText.includes("<command-instruction>")
          if (!isSystemInjected) {
            lastUserMessageText.set(sessionID, userText)
            // Re-arm todo finalization for real user messages
            if (todoContinuationEnforcer) {
              todoContinuationEnforcer.clearFinalized(sessionID)
            }
          }
        }
      }

      // Workflow control keywords: detect natural language commands during active workflows
      if (hooks.workflowCommand) {
        const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
        const message = (_output as Record<string, unknown>).message as
          | Record<string, unknown>
          | undefined

        const userText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() ?? ""

        if (userText) {
          const cmdResult = hooks.workflowCommand(userText)
          if (cmdResult.handled) {
            if (cmdResult.contextInjection && parts) {
              const idx = parts.findIndex((p) => p.type === "text" && p.text)
              if (idx >= 0 && parts[idx].text) {
                parts[idx].text += `\n\n---\n${cmdResult.contextInjection}`
              } else {
                parts.push({ type: "text", text: cmdResult.contextInjection })
              }
            }
            if (cmdResult.switchAgent && message) {
              message.agent = getAgentDisplayName(cmdResult.switchAgent)
              debug("[workflow] Switching agent via workflow command", {
                agent: cmdResult.switchAgent,
                displayName: message.agent,
              })
            }
          }
        }
      }

      // Auto-pause work when a user message arrives that is NOT a /start-work command,
      // NOT a continuation prompt injected by the work-continuation hook,
      // and NOT a workflow continuation prompt.
      // This breaks the infinite continuation loop that occurs when a user sends a
      // regular message while a plan is active — without this, session.idle fires
      // after every response and re-injects the "Continue working" prompt endlessly.
      if (directory) {
        const parts = _output.parts as Array<{ type: string; text?: string }> | undefined
        const promptText =
          parts
            ?.filter((p) => p.type === "text" && p.text)
            .map((p) => p.text)
            .join("\n")
            .trim() ?? ""

        const isStartWork = promptText.includes("<session-context>")
        const isContinuation = promptText.includes(CONTINUATION_MARKER)
        const isWorkflowContinuation = promptText.includes(WORKFLOW_CONTINUATION_MARKER)
        const isTodoFinalize = promptText.includes(FINALIZE_TODOS_MARKER)
        const isActiveWorkflow = (() => {
          const wf = getActiveWorkflowInstance(directory)
          return wf != null && wf.status === "running"
        })()

        if (!isStartWork && !isContinuation && !isWorkflowContinuation && !isTodoFinalize && !isActiveWorkflow) {
          const state = readWorkState(directory)
          if (state && !state.paused) {
            pauseWork(directory)
            info("[work-continuation] Auto-paused: user message received during active plan", { sessionId: sessionID })
          }
        }
      }
    },

    "chat.params": async (_input, _output) => {
      const input = _input as {
        sessionID?: string
        agent?: string
        model?: { id?: string; limit?: { context?: number } }
      }
      const sessionId = input.sessionID ?? ""
      const maxTokens = input.model?.limit?.context ?? 0
      if (sessionId && maxTokens > 0) {
        setContextLimit(sessionId, maxTokens)
        debug("[context-window] Captured context limit", { sessionId, maxTokens })
      }

      // Analytics: capture agent name
      if (tracker && hooks.analyticsEnabled && sessionId && input.agent) {
        tracker.setAgentName(sessionId, input.agent)
      }

      // Analytics: capture model ID
      if (tracker && hooks.analyticsEnabled && sessionId && input.model?.id) {
        tracker.trackModel(sessionId, input.model.id)
      }
    },

    "chat.headers": async (_input, _output) => {
      // pass-through for v1
    },

    event: async (input) => {
      const { event } = input

      // Compaction todo preserver: forward events for restore/cleanup
      if (compactionPreserver) {
        await compactionPreserver.handleEvent(event as { type: string; properties?: unknown })
      }

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
        if (todoContinuationEnforcer) {
          todoContinuationEnforcer.clearSession(evt.properties.info.id)
        }

        // Analytics: finalize session summary
        if (tracker && hooks.analyticsEnabled) {
          try {
            tracker.endSession(evt.properties.info.id)
          } catch (err) {
            warn("[analytics] Failed to end session (non-fatal)", { error: String(err) })
          }

          // Generate metrics report if a plan just completed
          if (directory) {
            try {
              const state = readWorkState(directory)
              if (state) {
                const progress = getPlanProgress(state.active_plan)
                if (progress.isComplete) {
                  generateMetricsReport(directory, state)
                }
              }
            } catch (err) {
              warn("[analytics] Failed to generate metrics report on session end (non-fatal)", { error: String(err) })
            }
          }
        }
      }

      // Process assistant message token data from message.updated events
      if (event.type === "message.updated") {
        const evt = event as {
          type: string
          properties: {
            info: {
              role?: string
              sessionID?: string
              tokens?: {
                input?: number
                output?: number
                reasoning?: number
                cache?: { read?: number; write?: number }
              }
            }
          }
        }
        const info = evt.properties?.info
        if (info?.role === "assistant" && info.sessionID) {
          // Context window monitoring
          if (hooks.checkContextWindow) {
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
                  warn("[context-window] Threshold crossed", {
                    sessionId: info.sessionID,
                    action: result.action,
                    usagePct: result.usagePct,
                  })
                }
              }
            }
          }

          // Analytics: cost and token usage are tracked in the consolidated block below
        }
      }

      // Analytics: capture cost and token usage from assistant messages
      if (event.type === "message.updated" && tracker && hooks.analyticsEnabled) {
        const evt = event as {
          type: string
          properties: {
            info: {
              role?: string
              sessionID?: string
              cost?: number
              tokens?: {
                input?: number
                output?: number
                reasoning?: number
                cache?: { read?: number; write?: number }
              }
            }
          }
        }
        const info = evt.properties?.info
        if (info?.role === "assistant" && info.sessionID) {
          if (typeof info.cost === "number" && info.cost > 0) {
            tracker.trackCost(info.sessionID, info.cost)
          }
          if (info.tokens) {
            tracker.trackTokenUsage(info.sessionID, {
              input: info.tokens.input ?? 0,
              output: info.tokens.output ?? 0,
              reasoning: info.tokens.reasoning ?? 0,
              cacheRead: info.tokens.cache?.read ?? 0,
              cacheWrite: info.tokens.cache?.write ?? 0,
            })
          }
        }
      }

      // Detect user-initiated interrupts via TUI command and persist to work state
      if (event.type === "tui.command.execute") {
        const evt = event as { type: string; properties: { command: string } }
        if (evt.properties?.command === "session.interrupt") {
          pauseWork(directory)
          info("[work-continuation] User interrupt detected — work paused")

          // Also pause any active workflow
          if (directory) {
            const activeWorkflow = getActiveWorkflowInstance(directory)
            if (activeWorkflow && activeWorkflow.status === "running") {
              pauseWorkflow(directory, "User interrupt")
              info("[workflow] User interrupt detected — workflow paused")
            }
          }
        }
      }

      // Track assistant message text from message.part.updated events.
      // message.updated does NOT carry message content — only metadata (tokens, cost).
      // We need the text for workflow completion detection (review_verdict, agent_signal).
      if (event.type === "message.part.updated") {
        const evt = event as {
          type: string
          properties: { part: { type: string; sessionID: string; messageID: string; text?: string } }
        }
        const part = evt.properties?.part
        if (part?.type === "text" && part.sessionID && part.text) {
          lastAssistantMessageText.set(part.sessionID, part.text)
        }
      }

      // Workflow continuation: check active workflow instance on session.idle.
      // This MUST run BEFORE work-continuation to prevent double-prompting.
      // If a workflow instance is active, it owns the idle loop.
      let continuationFired = false
      if (hooks.workflowContinuation && event.type === "session.idle") {
        const evt = event as { type: string; properties: { sessionID: string } }
        const sessionId = evt.properties?.sessionID ?? ""
        if (sessionId && directory) {
          const activeWorkflow = getActiveWorkflowInstance(directory)
          if (activeWorkflow && activeWorkflow.status === "running") {
            const lastMsg = lastAssistantMessageText.get(sessionId) ?? undefined
            const lastUserMsg = lastUserMessageText.get(sessionId) ?? undefined
            const result = hooks.workflowContinuation(sessionId, lastMsg, lastUserMsg)
            if (result.continuationPrompt && client) {
              try {
                await client.session.promptAsync({
                  path: { id: sessionId },
                  body: {
                    parts: [{ type: "text", text: result.continuationPrompt }],
                    ...(result.switchAgent
                      ? { agent: getAgentDisplayName(result.switchAgent) }
                      : {}),
                  },
                })
                debug("[workflow] Injected workflow continuation prompt", {
                  sessionId,
                  agent: result.switchAgent,
                })
              } catch (err) {
                error("[workflow] Failed to inject workflow continuation", { sessionId, error: String(err) })
              }
              return // Workflow owns the idle loop — skip work-continuation and todo finalization
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
                  parts: [{ type: "text", text: result.continuationPrompt }],
                },
              })
                debug("[work-continuation] Injected continuation prompt", { sessionId })
                continuationFired = true
              } catch (err) {
                error("[work-continuation] Failed to inject continuation", { sessionId, error: String(err) })
              }
            } else if (result.continuationPrompt) {
              // client not available — log for diagnostics
              debug("[work-continuation] continuationPrompt available but no client", { sessionId })
          }
        }
      }

      // Todo finalization safety net: when session goes truly idle (no continuation fired),
      // delegate to the todo-continuation-enforcer hook (or no-op if hook is disabled).
      if (event.type === "session.idle" && todoContinuationEnforcer && !continuationFired) {
        const evt = event as { type: string; properties: { sessionID: string } }
        const sessionId = evt.properties?.sessionID ?? ""
        if (sessionId) {
          await todoContinuationEnforcer.checkAndFinalize(sessionId)
        }
      }
    },

    "tool.execute.before": async (input, _output) => {
      const toolArgs = _output.args as Record<string, unknown> | null | undefined
      const filePath =
        (toolArgs?.file_path as string | undefined) ??
        (toolArgs?.path as string | undefined) ??
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
      if (input.tool === "task" && toolArgs) {
        const agentArg =
          (toolArgs.subagent_type as string | undefined) ??
          (toolArgs.description as string | undefined) ??
          "unknown"
        logDelegation({
          phase: "start",
          agent: agentArg,
          sessionId: input.sessionID,
          toolCallId: input.callID,
        })
      }

      // Analytics: track tool execution start
      if (tracker && hooks.analyticsEnabled) {
        const agentArg = input.tool === "task" && toolArgs
          ? ((toolArgs.subagent_type as string | undefined) ??
             (toolArgs.description as string | undefined) ??
             "unknown")
          : undefined
        tracker.trackToolStart(input.sessionID, input.tool, input.callID, agentArg)
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

      // Analytics: track tool execution end
      if (tracker && hooks.analyticsEnabled) {
        const inputArgs = (input as Record<string, unknown>).args as Record<string, unknown> | undefined
        const agentArg = input.tool === "task" && inputArgs
          ? ((inputArgs.subagent_type as string | undefined) ??
             (inputArgs.description as string | undefined) ??
             "unknown")
          : undefined
        tracker.trackToolEnd(input.sessionID, input.tool, input.callID, agentArg)
      }
    },

    "command.execute.before": async (input, output) => {
      const { command, arguments: args } = input as { command: string; sessionID: string; arguments: string }
      const parts = (output as { parts: Array<{ type: string; text: string }> }).parts

      if (command === "token-report") {
        const summaries = readSessionSummaries(directory)
        const reportText = generateTokenReport(summaries)
        parts.push({ type: "text", text: reportText })
      }

      if (command === "metrics") {
        if (!hooks.analyticsEnabled) {
          parts.push({
            type: "text",
            text: "Analytics is not enabled. To enable it, set `\"analytics\": { \"enabled\": true }` in your `weave.json`.",
          })
          return
        }
        const reports = readMetricsReports(directory)
        const summaries = readSessionSummaries(directory)
        const metricsMarkdown = formatMetricsMarkdown(reports, summaries, args)
        parts.push({ type: "text", text: metricsMarkdown })
      }

      if (command === "weave-health") {
        const loadResult = getLastConfigLoadResult()
        const reportText = generateHealthReport(loadResult, agents)
        parts.push({ type: "text", text: reportText })
      }
    },

    // Hook 1: override TodoWrite description with anti-obliteration language
    "tool.definition": async (input, output) => {
      if (hooks.todoDescriptionOverride) {
        hooks.todoDescriptionOverride(
          input as { toolID: string },
          output as { description: string; parameters?: unknown },
        )
      }
    },

    // Hook 2 (capture): snapshot todos before compaction starts
    "experimental.session.compacting": async (input) => {
      if (compactionPreserver) {
        const typedInput = input as { sessionID?: string }
        const sessionID = typedInput.sessionID ?? ""
        if (sessionID) {
          await compactionPreserver.capture(sessionID)
        }
      }
    },
  }
}
