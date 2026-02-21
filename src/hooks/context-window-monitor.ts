import { log } from "../shared/log"

export interface ContextWindowState {
  usedTokens: number
  maxTokens: number
  sessionId: string
}

export interface ContextWindowThresholds {
  warningPct: number
  criticalPct: number
}

export type ContextWindowAction = "none" | "warn" | "recover"

export interface ContextWindowCheckResult {
  action: ContextWindowAction
  usagePct: number
  message?: string
}

export function checkContextWindow(
  state: ContextWindowState,
  thresholds: ContextWindowThresholds = { warningPct: 0.8, criticalPct: 0.95 },
): ContextWindowCheckResult {
  const usagePct = state.maxTokens > 0 ? state.usedTokens / state.maxTokens : 0

  if (usagePct >= thresholds.criticalPct) {
    const message = buildRecoveryMessage(state, usagePct)
    log(`[context-window] CRITICAL ${(usagePct * 100).toFixed(1)}% used in session ${state.sessionId}`)
    return { action: "recover", usagePct, message }
  }

  if (usagePct >= thresholds.warningPct) {
    log(`[context-window] WARNING ${(usagePct * 100).toFixed(1)}% used in session ${state.sessionId}`)
    return { action: "warn", usagePct, message: buildWarningMessage(usagePct) }
  }

  return { action: "none", usagePct }
}

function buildWarningMessage(usagePct: number): string {
  const pct = (usagePct * 100).toFixed(0)
  return `⚠️ Context window at ${pct}%. Consider wrapping up the current task or spawning a background agent for remaining work.

Update the sidebar: use todowrite to create or update a todo (in_progress, high priority): "Context: ${pct}% — wrap up soon"`
}

function buildRecoveryMessage(state: ContextWindowState, usagePct: number): string {
  const pct = (usagePct * 100).toFixed(0)
  return `🚨 Context window at ${pct}% (${state.usedTokens}/${state.maxTokens} tokens).

IMMEDIATE ACTION REQUIRED:
1. Save your current progress and findings to a notepad or file
2. Summarize completed work and remaining tasks
3. If work remains: spawn a background agent or ask the user to continue in a new session
4. Do NOT attempt large new tasks — wrap up gracefully

Update the sidebar: use todowrite to create a todo (in_progress, high priority): "CONTEXT ${pct}% — save & stop"`
}

export function createContextWindowMonitor(thresholds?: ContextWindowThresholds) {
  return {
    check: (state: ContextWindowState) => checkContextWindow(state, thresholds),
  }
}
