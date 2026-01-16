import type { WeaveConfig } from "../config/schema"
import { checkContextWindow } from "./context-window-monitor"
import type { ContextWindowThresholds } from "./context-window-monitor"
import { createWriteGuardState, createWriteGuard } from "./write-existing-file-guard"
import { getRulesForFile, shouldInjectRules } from "./rules-injector"
import { shouldApplyVariant, markApplied, markSessionCreated, clearSession } from "./first-message-variant"
import { processMessageForKeywords } from "./keyword-detector"

export type CreatedHooks = ReturnType<typeof createHooks>

export function createHooks(args: {
  pluginConfig: WeaveConfig
  isHookEnabled: (hookName: string) => boolean
}) {
  const { isHookEnabled } = args

  const writeGuardState = createWriteGuardState()
  const writeGuard = createWriteGuard(writeGuardState)

  const contextWindowThresholds: ContextWindowThresholds = {
    warningPct: 0.8,
    criticalPct: 0.95,
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
  }
}
