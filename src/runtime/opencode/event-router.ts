import { pauseWork, readWorkState } from "../../features/work-state"
import { getPlanProgress } from "../../features/work-state/storage"
import { generateMetricsReport } from "../../features/analytics/generate-metrics-report"
import { getActiveWorkflowInstance, pauseWorkflow } from "../../features/workflow"
import { getState as getTokenState } from "../../hooks"
import { info, warn } from "../../shared/log"
import type { CreatedHooks } from "../../hooks/create-hooks"
import type { PluginContext } from "../../plugin/types"
import type { SessionTracker } from "../../features/analytics"
import type { RuntimeEffect } from "./effects"
import type { RuntimeLifecyclePolicySurface } from "../../application/orchestration/session-runtime"
import type { RuntimePolicyFlags } from "../../application/orchestration/session-runtime"
import { doesSessionOwnExecution } from "../../application/orchestration/execution-coordinator"
import { createExecutionLeaseFsStore } from "../../infrastructure/fs/execution-lease-fs-store"
import type { TrustedInjectedPromptKind } from "./trusted-message-state"

export interface EventRouterState {
  lastAssistantMessageText: Map<string, string>
  lastUserMessageText: Map<string, string>
  lastUserMessageTrustedInjectedKind: Map<string, TrustedInjectedPromptKind | null>
}

const ExecutionLeaseRepository = createExecutionLeaseFsStore()

export async function routeRuntimeEvent(input: {
  event: { type: string; properties?: unknown }
  directory: string
  hooks: CreatedHooks
  enabledAgents?: ReadonlySet<string>
  client?: PluginContext["client"]
  tracker?: SessionTracker
  state: EventRouterState
  lifecyclePolicy: RuntimeLifecyclePolicySurface
}): Promise<RuntimeEffect[]> {
  const { event, directory, hooks, enabledAgents, client, tracker, state, lifecyclePolicy } = input
  const effects: RuntimeEffect[] = []
  const policyFlags: RuntimePolicyFlags = {
    contextWindowThresholds: hooks.contextWindowThresholds,
    rulesInjectorEnabled: hooks.rulesInjectorEnabled,
    patternMdOnlyEnabled: hooks.patternMdOnlyEnabled,
    verificationReminderEnabled: hooks.verificationReminderEnabled,
    todoDescriptionOverrideEnabled: hooks.todoDescriptionOverrideEnabled,
    todoContinuationEnforcerEnabled: hooks.todoContinuationEnforcerEnabled,
  }

  if (event.type === "session.compacted") {
    const evt = event as { type: string; properties?: { sessionID?: string; info?: { id?: string } } }
      const sessionId = evt.properties?.sessionID ?? evt.properties?.info?.id ?? ""
      if (sessionId) {
        effects.push(...(await lifecyclePolicy.onCompaction({
          directory,
          sessionId,
          hooks: {
            ...policyFlags,
            continuation: hooks.continuation,
            compactionRecovery: hooks.compactionRecovery,
          },
          enabledAgents,
        })))
      }
  }

  if (hooks.firstMessageVariant) {
    if (event.type === "session.created") {
      const evt = event as { type: string; properties: { info: { id: string } } }
      hooks.firstMessageVariant.markSessionCreated(evt.properties.info.id)
    }
    if (event.type === "session.deleted") {
      const evt = event as { type: string; properties?: { sessionID?: string; sessionId?: string; info?: { id?: string } } }
      const sessionId = evt.properties?.info?.id ?? evt.properties?.sessionID ?? evt.properties?.sessionId ?? ""
      if (sessionId) {
        hooks.firstMessageVariant.clearSession(sessionId)
      }
    }
  }

  if (event.type === "session.deleted") {
    const evt = event as { type: string; properties?: { sessionID?: string; sessionId?: string; info?: { id?: string } } }
    const sessionId = evt.properties?.info?.id ?? evt.properties?.sessionID ?? evt.properties?.sessionId ?? ""
    if (sessionId) {
      effects.push(...(await lifecyclePolicy.onSessionDeleted({
        directory,
        sessionId,
        hooks: policyFlags,
      })))

      if (tracker && hooks.analyticsEnabled) {
        tracker.endSession(sessionId)
        if (directory) {
          try {
            const workState = readWorkState(directory)
            if (workState) {
              const progress = getPlanProgress(workState.active_plan)
              if (progress.isComplete) {
                generateMetricsReport(directory, workState)
              }
            }
          } catch (err) {
            warn("[analytics] Failed to generate metrics report on session end (non-fatal)", { error: String(err) })
          }
        }
      }
    }
  }

  if (event.type === "message.updated") {
    const evt = event as {
      type: string
      properties: { info: { id?: string; role?: string; sessionID?: string; cost?: number; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } } }
    }
    const info = evt.properties?.info
    if (info?.role === "assistant" && info.sessionID) {
      const sessionRuntime = ExecutionLeaseRepository.readSessionRuntime(directory, info.sessionID)
      effects.push(...(await lifecyclePolicy.onAssistantMessage({
        directory,
        sessionId: info.sessionID,
        hooks: policyFlags,
        inputTokens: info.tokens?.input ?? 0,
        foregroundAgent: sessionRuntime?.foreground_agent,
        assistantText: state.lastAssistantMessageText.get(info.sessionID),
        originalPromptText: state.lastUserMessageText.get(info.sessionID),
        respondingToTrustedInjectedPromptKind: state.lastUserMessageTrustedInjectedKind.get(info.sessionID) ?? null,
        messageId: info.id,
      })))

      if (tracker && hooks.analyticsEnabled) {
        if (typeof info.cost === "number" && info.cost > 0) {
          effects.push({ type: "trackAnalytics", event: { kind: "trackCost", sessionId: info.sessionID, cost: info.cost } })
        }
        if (info.tokens) {
          effects.push({
            type: "trackAnalytics",
            event: {
              kind: "trackTokenUsage",
              sessionId: info.sessionID,
              usage: {
                input: info.tokens.input ?? 0,
                output: info.tokens.output ?? 0,
                reasoning: info.tokens.reasoning ?? 0,
                cacheRead: info.tokens.cache?.read ?? 0,
                cacheWrite: info.tokens.cache?.write ?? 0,
              },
            },
          })
        }
      }
    }
  }

  if (event.type === "tui.command.execute") {
    const evt = event as { type: string; properties: { command: string; sessionID?: string; sessionId?: string } }
    if (evt.properties?.command === "session.interrupt") {
      const sessionId = evt.properties.sessionID ?? evt.properties.sessionId ?? ""
      if (sessionId && doesSessionOwnExecution(directory, sessionId)) {
        effects.push({
          type: "pauseExecution",
          target: getOwnedExecutionTarget(directory, sessionId),
          reason: "User interrupt",
          sessionId,
        })
      }
    }
  }

  if (event.type === "message.part.updated") {
    const evt = event as { type: string; properties: { part: { type: string; sessionID: string; text?: string } } }
    const part = evt.properties?.part
    if (part?.type === "text" && part.sessionID && part.text) {
      state.lastAssistantMessageText.set(part.sessionID, part.text)
    }
  }

  if (event.type === "session.idle") {
    const evt = event as { type: string; properties: { sessionID: string } }
    const sessionId = evt.properties?.sessionID ?? ""
    if (sessionId) {
      effects.push(...(await lifecyclePolicy.onSessionIdle({
        sessionId,
        directory,
        hooks: {
          ...policyFlags,
          continuation: hooks.continuation,
          workContinuation: hooks.workContinuation,
          workflowContinuation: hooks.workflowContinuation,
        },
        lastAssistantMessage: state.lastAssistantMessageText.get(sessionId) ?? undefined,
        lastUserMessage: state.lastUserMessageText.get(sessionId) ?? undefined,
      })))
    }
  }

  return effects
}

export function handlePauseExecutionEffect(input: { effectReason: string; directory: string; sessionId?: string; target?: "plan" | "workflow" | "both" | "none" }): void {
  if (input.sessionId && !doesSessionOwnExecution(input.directory, input.sessionId)) {
    return
  }
  const target = input.target ?? (input.sessionId ? getOwnedExecutionTarget(input.directory, input.sessionId) : "none")
  if (target === "plan") {
    pauseWork(input.directory)
    info("[work-continuation] User interrupt detected — work paused")
    return
  }
  if (target === "workflow") {
    const activeWorkflow = getActiveWorkflowInstance(input.directory)
    if (activeWorkflow && activeWorkflow.status === "running") {
      pauseWorkflow(input.directory, input.effectReason)
      info("[workflow] User interrupt detected — workflow paused")
    }
  }
}

function getOwnedExecutionTarget(directory: string, sessionId: string): "plan" | "workflow" | "none" {
  const snapshot = ExecutionLeaseRepository.getExecutionSnapshot(directory)
  if (snapshot.sessionId !== sessionId) {
    return "none"
  }

  if (snapshot.owner === "plan") {
    return "plan"
  }
  if (snapshot.owner === "workflow") {
    return "workflow"
  }
  return "none"
}
