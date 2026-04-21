import type { AgentConfig } from "@opencode-ai/sdk"
import type { WeaveConfig } from "../../config/schema"
import type { ConfigHandler } from "../../managers/config-handler"
import type { CreatedHooks } from "../../hooks/create-hooks"
import type { PluginContext, ToolsRecord } from "../../plugin/types"
import type { SessionTracker } from "../../features/analytics"
import { pauseWork } from "../../features/work-state"
import { applyRuntimeEffects } from "./apply-effects"
import { routeCommandExecuteBefore } from "../../application/commands/command-router"
import { routeRuntimeEvent, handlePauseExecutionEffect } from "./event-router"
import { logDelegation, debug, info } from "../../shared/log"
import { setContextLimit } from "../../hooks"
import type { RuntimeEffect } from "./effects"
import { createRuntimeLifecyclePolicySurface } from "../../application/orchestration/session-runtime"
import type { RuntimePolicyFlags } from "../../application/orchestration/session-runtime"
import { createExecutionLeaseFsStore } from "../../infrastructure/fs/execution-lease-fs-store"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { projectExecutionTransition } from "../../domain/session/execution-lease"
import { createTrustedMessageState } from "./trusted-message-state"
import type { BuiltinCommandEnvelopeName } from "./protocol"
import { buildEnabledAgentKeys } from "./enabled-agent-keys"

export function createPluginAdapter(args: {
  pluginConfig: WeaveConfig
  hooks: CreatedHooks
  tools: ToolsRecord
  configHandler: ConfigHandler
  agents: Record<string, AgentConfig>
  client?: PluginContext["client"]
  directory?: string
  tracker?: SessionTracker
}) {
  const { pluginConfig, hooks, configHandler, agents, client, directory = "", tracker } = args
  const trustedMessageState = createTrustedMessageState()
  const trackedClient = client ? wrapClientWithTrustedPromptTracking(client, trustedMessageState) : undefined
  const lifecyclePolicy = createRuntimeLifecyclePolicySurface({ hooks, client: trackedClient })
  const executionLeaseRepository = createExecutionLeaseFsStore()
  const enabledAgents = buildEnabledAgentKeys(pluginConfig)

  const lastAssistantMessageText = new Map<string, string>()
  const lastUserMessageText = new Map<string, string>()

  const policyFlags: RuntimePolicyFlags = {
    contextWindowThresholds: hooks.contextWindowThresholds,
    rulesInjectorEnabled: hooks.rulesInjectorEnabled,
    patternMdOnlyEnabled: hooks.patternMdOnlyEnabled,
    verificationReminderEnabled: hooks.verificationReminderEnabled,
    todoDescriptionOverrideEnabled: hooks.todoDescriptionOverrideEnabled,
    todoContinuationEnforcerEnabled: hooks.todoContinuationEnforcerEnabled,
  }

  return {
    config: async (config: Record<string, unknown>) => {
      const result = await configHandler.handle({
        pluginConfig,
        agents,
        availableTools: [],
      })
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

      const existingCommands = (config.command ?? {}) as Record<string, unknown>
      config.command = { ...existingCommands, ...result.commands }

      if (result.defaultAgent && !config.default_agent) {
        config.default_agent = result.defaultAgent
      }
    },

    handleChatMessage: async (input: { sessionID: string }, output: { message?: Record<string, unknown>; parts?: Array<{ type: string; text?: string }> }) => {
      const { sessionID } = input

      if (hooks.firstMessageVariant && hooks.firstMessageVariant.shouldApplyVariant(sessionID)) {
        hooks.firstMessageVariant.markApplied(sessionID)
      }

      hooks.processMessageForKeywords?.("", sessionID)

      const parts = output.parts
      if (parts) {
        const timestamp = new Date().toISOString()
        for (const part of parts) {
          if (part.type === "text" && part.text) {
            part.text = part.text.replace(/\$SESSION_ID/g, sessionID).replace(/\$TIMESTAMP/g, timestamp)
          }
        }
      }

      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() ?? ""

      const parsedEnvelope = trustedMessageState.consumeTrustedEnvelope(sessionID, promptText)
      if (parsedEnvelope?.kind !== "builtin-command") {
        trustedMessageState.clearPendingBuiltin(sessionID)
      }

      const effects: RuntimeEffect[] = [
        ...(await lifecyclePolicy.onChatMessage({
          directory,
          sessionId: sessionID,
          promptText,
          parsedEnvelope,
          hooks: {
            ...policyFlags,
            startWork: hooks.startWork,
            workflowStart: hooks.workflowStart,
            workflowCommand: hooks.workflowCommand,
            continuation: hooks.continuation,
          },
        })),
      ]

      if (promptText && sessionID) {
        const isSystemInjected = parsedEnvelope !== null
        if (!isSystemInjected) {
          lastUserMessageText.set(sessionID, promptText)
        }
      }

      await applyRuntimeEffects({
        effects,
        output,
        client: trackedClient,
        tracker,
        pausePlan: directory ? () => {
          pauseWork(directory)
          info("[work-continuation] Auto-paused: user message received during active plan", { sessionId: sessionID })
        } : undefined,
      })
    },

    handleChatParams: async (input: { sessionID?: string; agent?: string; model?: { id?: string; limit?: { context?: number } } }) => {
      const sessionId = input.sessionID ?? ""
      const observedAgent = input.agent ? getAgentConfigKey(input.agent) : null
      const maxTokens = input.model?.limit?.context ?? 0
      if (sessionId && maxTokens > 0) {
        setContextLimit(sessionId, maxTokens)
        debug("[context-window] Captured context limit", { sessionId, maxTokens })
      }

      if (directory && sessionId && observedAgent) {
        const projection = projectExecutionTransition({
          event: "observe_ad_hoc_agent",
          sessionId,
          foregroundAgent: observedAgent,
          currentLease: executionLeaseRepository.readExecutionLease(directory),
          currentSessionRuntime: executionLeaseRepository.readSessionRuntime(directory, sessionId),
        })

        if (projection.sessionRuntime) {
          executionLeaseRepository.writeSessionRuntime(directory, projection.sessionRuntime)
        }
      }

      const effects: RuntimeEffect[] = []
      if (tracker && hooks.analyticsEnabled && sessionId && input.agent) {
        effects.push({ type: "trackAnalytics", event: { kind: "setAgentName", sessionId, agent: input.agent } } as const)
      }
      if (tracker && hooks.analyticsEnabled && sessionId && input.model?.id) {
        effects.push({ type: "trackAnalytics", event: { kind: "trackModel", sessionId, modelId: input.model.id } } as const)
      }
      await applyRuntimeEffects({ effects, tracker })
    },

    handleEvent: async (input: { event: { type: string; properties?: unknown } }) => {
      const deletedSessionId = getDeletedSessionId(input.event)
      if (deletedSessionId) {
        trustedMessageState.clearSession(deletedSessionId)
        lastUserMessageText.delete(deletedSessionId)
        lastAssistantMessageText.delete(deletedSessionId)
      }

      const effects = await routeRuntimeEvent({
        event: input.event,
        directory,
        hooks,
        client: trackedClient,
        tracker,
        state: { lastAssistantMessageText, lastUserMessageText },
        lifecyclePolicy,
        enabledAgents,
      })

      await applyRuntimeEffects({
        effects,
        client: trackedClient,
        tracker,
        pauseWorkflow: directory ? () => handlePauseExecutionEffect({
          effectReason: "User interrupt",
          directory,
          sessionId: effects.find((effect) => effect.type === "pauseExecution")?.sessionId,
          target: effects.find((effect) => effect.type === "pauseExecution")?.target,
        }) : undefined,
        pausePlan: directory ? () => handlePauseExecutionEffect({
          effectReason: "User interrupt",
          directory,
          sessionId: effects.find((effect) => effect.type === "pauseExecution")?.sessionId,
          target: effects.find((effect) => effect.type === "pauseExecution")?.target,
        }) : undefined,
      })
    },

    handleToolExecuteBefore: async (input: { sessionID: string; tool: string; callID: string; agent?: string }, output: { args?: Record<string, unknown> | null }) => {
      const toolArgs = output.args as Record<string, unknown> | null | undefined

      if (input.tool === "task" && toolArgs) {
        const agentArg = (toolArgs.subagent_type as string | undefined) ?? (toolArgs.description as string | undefined) ?? "unknown"
        logDelegation({ phase: "start", agent: agentArg, sessionId: input.sessionID, toolCallId: input.callID })
      }

      const effects: RuntimeEffect[] = []
      effects.push(...(await lifecyclePolicy.beforeTool({
        directory,
        sessionId: input.sessionID,
        tool: input.tool,
        callId: input.callID,
        hooks: {
          ...policyFlags,
          writeGuard: hooks.writeGuard,
        },
        agent: input.agent,
        toolArgs,
      })))
      if (tracker && hooks.analyticsEnabled) {
        const agentArg = input.tool === "task" && toolArgs
          ? ((toolArgs.subagent_type as string | undefined) ?? (toolArgs.description as string | undefined) ?? "unknown")
          : undefined
        effects.push({ type: "trackAnalytics", event: { kind: "trackToolStart", sessionId: input.sessionID, tool: input.tool, callId: input.callID, agent: agentArg } } as const)
      }
      await applyRuntimeEffects({ effects, tracker })
    },

    handleToolExecuteAfter: async (input: { sessionID: string; tool: string; callID: string; args?: Record<string, unknown> }) => {
      if (input.tool === "task") {
        const inputArgs = input.args
        const agentArg = (inputArgs?.subagent_type as string | undefined) ?? (inputArgs?.description as string | undefined) ?? "unknown"
        logDelegation({ phase: "complete", agent: agentArg, sessionId: input.sessionID, toolCallId: input.callID })
      }

      const effects: RuntimeEffect[] = []
      effects.push(...(await lifecyclePolicy.afterTool({
        directory,
        sessionId: input.sessionID,
        tool: input.tool,
        callId: input.callID,
        hooks: policyFlags,
        toolArgs: input.args,
      })))
      if (tracker && hooks.analyticsEnabled) {
        const inputArgs = input.args
        const agentArg = input.tool === "task"
          ? ((inputArgs?.subagent_type as string | undefined) ?? (inputArgs?.description as string | undefined) ?? "unknown")
          : undefined
        effects.push({ type: "trackAnalytics", event: { kind: "trackToolEnd", sessionId: input.sessionID, tool: input.tool, callId: input.callID, agent: agentArg } } as const)
      }
      await applyRuntimeEffects({ effects, tracker })
    },

    handleCommandExecuteBefore: async (input: { command: string; sessionID: string; arguments: string }, output: { parts: Array<{ type: string; text: string }> }) => {
      if (isBuiltinChatCommand(input.command)) {
        trustedMessageState.registerBuiltinCommand(input.sessionID, input.command, input.arguments)
      }

      const effects = routeCommandExecuteBefore({
        command: input.command,
        argumentsText: input.arguments,
        directory,
        hooks,
        agents,
      })

      await applyRuntimeEffects({ effects, output })
    },

    handleToolDefinition: async (input: { toolID: string }, output: { description: string; parameters?: unknown }) => {
      await lifecyclePolicy.onToolDefinition({
        toolId: input.toolID,
        hooks: policyFlags,
        output,
      })
    },

    handleSessionCompacting: async (input: { sessionID?: string }) => {
      const sessionID = input.sessionID ?? ""
      if (!sessionID) {
        return
      }

      await lifecyclePolicy.beforeCompaction({
        directory,
        sessionId: sessionID,
        hooks: policyFlags,
      })
    },
  }
}

function isBuiltinChatCommand(command: string): command is BuiltinCommandEnvelopeName {
  return command === "start-work"
    || command === "run-workflow"
    || command === "metrics"
    || command === "token-report"
    || command === "weave-health"
}

function wrapClientWithTrustedPromptTracking(
  client: PluginContext["client"],
  trustedMessageState: ReturnType<typeof createTrustedMessageState>,
): PluginContext["client"] {
  return {
    ...client,
    session: Object.assign({}, client.session, {
      promptAsync: (input: Parameters<typeof client.session.promptAsync>[0]) => {
        const result = client.session.promptAsync(input)
        const text = extractPromptText(input.body)
        return result.then((value) => {
          if (text) {
            trustedMessageState.registerInjectedPrompt(input.path.id, text)
          }
          return value
        }) as typeof result
      },
    }),
  } as PluginContext["client"]
}

function extractPromptText(body: { parts: Array<{ type?: string; text?: string }> } | undefined): string | null {
  if (!body) {
    return null
  }

  const textParts = body.parts
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter((text) => text.length > 0) ?? []

  if (textParts.length === 0) {
    return null
  }

  return textParts.join("\n")
}

function getDeletedSessionId(event: { type: string; properties?: unknown }): string | null {
  if (event.type !== "session.deleted") {
    return null
  }

  const properties = event.properties as { sessionID?: string; sessionId?: string; info?: { id?: string } } | undefined
  return properties?.info?.id ?? properties?.sessionID ?? properties?.sessionId ?? null
}
