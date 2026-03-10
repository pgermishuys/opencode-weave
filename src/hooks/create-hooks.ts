import type { WeaveConfig } from "../config/schema"
import { checkContextWindow } from "./context-window-monitor"
import type { ContextWindowThresholds } from "./context-window-monitor"
import { createWriteGuardState, createWriteGuard } from "./write-existing-file-guard"
import { getRulesForFile, shouldInjectRules } from "./rules-injector"
import { shouldApplyVariant, markApplied, markSessionCreated, clearSession } from "./first-message-variant"
import { processMessageForKeywords } from "./keyword-detector"
import { checkPatternWrite } from "./pattern-md-only"
import { handleStartWork } from "./start-work-hook"
import { checkContinuation } from "./work-continuation"
import { buildVerificationReminder } from "./verification-reminder"
import { handleRunWorkflow, checkWorkflowContinuation } from "../features/workflow"
import { handleWorkflowCommand } from "../features/workflow"

export type CreatedHooks = ReturnType<typeof createHooks>

export function createHooks(args: {
  pluginConfig: WeaveConfig
  isHookEnabled: (hookName: string) => boolean
  directory: string
  analyticsEnabled?: boolean
}) {
  const { pluginConfig, isHookEnabled, directory, analyticsEnabled = false } = args

  const writeGuardState = createWriteGuardState()
  const writeGuard = createWriteGuard(writeGuardState)

  const contextWindowThresholds: ContextWindowThresholds = {
    warningPct: pluginConfig.experimental?.context_window_warning_threshold ?? 0.8,
    criticalPct: pluginConfig.experimental?.context_window_critical_threshold ?? 0.95,
  }

  return {
    checkContextWindow: isHookEnabled("context-window-monitor")
      ? (state: Parameters<typeof checkContextWindow>[0]) =>
          checkContextWindow(state, contextWindowThresholds)
      : null,

    writeGuard: isHookEnabled("write-existing-file-guard") ? writeGuard : null,

    shouldInjectRules: isHookEnabled("rules-injector") ? shouldInjectRules : null,
    getRulesForFile: isHookEnabled("rules-injector") ? getRulesForFile : null,

    firstMessageVariant: isHookEnabled("first-message-variant")
      ? { shouldApplyVariant, markApplied, markSessionCreated, clearSession }
      : null,

    processMessageForKeywords: isHookEnabled("keyword-detector")
      ? processMessageForKeywords
      : null,

    patternMdOnly: isHookEnabled("pattern-md-only") ? checkPatternWrite : null,

    startWork: isHookEnabled("start-work")
      ? (promptText: string, sessionId: string) =>
          handleStartWork({ promptText, sessionId, directory })
      : null,

    workContinuation: isHookEnabled("work-continuation")
      ? (sessionId: string) => checkContinuation({ sessionId, directory })
      : null,

    workflowStart: isHookEnabled("workflow")
      ? (promptText: string, sessionId: string) =>
          handleRunWorkflow({ promptText, sessionId, directory })
      : null,

    workflowContinuation: isHookEnabled("workflow")
      ? (sessionId: string, lastAssistantMessage?: string, lastUserMessage?: string) =>
          checkWorkflowContinuation({ sessionId, directory, lastAssistantMessage, lastUserMessage })
      : null,

    workflowCommand: isHookEnabled("workflow")
      ? (message: string) => handleWorkflowCommand(message, directory)
      : null,

    verificationReminder: isHookEnabled("verification-reminder")
      ? buildVerificationReminder
      : null,

    analyticsEnabled,
  }
}
