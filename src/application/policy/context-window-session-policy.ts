import { getState as getTokenState, updateUsage } from "../../hooks"
import { createContextWindowMonitor } from "../../hooks/context-window-monitor"
import { warn } from "../../shared/log"
import { createPolicyResult, type PolicyResult } from "../../domain/policy/policy-result"
import type { RuntimeEffect } from "../../runtime/opencode/effects"
import type { RuntimeAssistantMessageInput } from "./runtime-policy"

export interface ContextWindowSessionPolicy {
  onAssistantMessage(input: RuntimeAssistantMessageInput): PolicyResult<RuntimeEffect>
}

export function createContextWindowSessionPolicy(): ContextWindowSessionPolicy {
  return {
    onAssistantMessage(input) {
      // Reserved for downstream collation policies; context-window policy remains token-based.
      void input.directory
      void input.foregroundAgent
      void input.assistantText
      void input.originalPromptText
      void input.messageId

      if (!input.hooks.contextWindowThresholds || input.inputTokens <= 0) {
        return createPolicyResult<RuntimeEffect>()
      }

      updateUsage(input.sessionId, input.inputTokens)
      const tokenState = getTokenState(input.sessionId)
      if (!tokenState || tokenState.maxTokens <= 0) {
        return createPolicyResult<RuntimeEffect>()
      }

      const result = createContextWindowMonitor(input.hooks.contextWindowThresholds).check({
        usedTokens: tokenState.usedTokens,
        maxTokens: tokenState.maxTokens,
        sessionId: input.sessionId,
      })

      if (result.action !== "none") {
        warn("[context-window] Threshold crossed", {
          sessionId: input.sessionId,
          action: result.action,
          usagePct: result.usagePct,
        })
      }

      return createPolicyResult<RuntimeEffect>()
    },
  }
}
