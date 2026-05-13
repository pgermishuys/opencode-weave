import { clearTokenSession } from "../../hooks"
import { createPolicyResult, type PolicyResult } from "../../domain/policy/policy-result"
import type { ReviewerPlan } from "../../agents/review-resolver"
import type { RuntimeEffect } from "../../runtime/opencode/effects"
import { runIdleCycle } from "../orchestration/idle-cycle-service"
import { createExecutionLeaseFsStore } from "../../infrastructure/fs/execution-lease-fs-store"
import { projectExecutionTransition } from "../../domain/session/execution-lease"
import type {
  RuntimeAssistantMessageInput,
  RuntimeBeforeCompactionInput,
  RuntimeCompactionInput,
  RuntimeSessionDeletedInput,
  RuntimeSessionIdleInput,
} from "./runtime-policy"
import { createCompactionSessionPolicy } from "./compaction-session-policy"
import { createContextWindowSessionPolicy } from "./context-window-session-policy"
import { createPostExecutionReviewerFanOutSessionPolicy } from "./post-execution-reviewer-fanout-session-policy"
import { createTodoSessionPolicy } from "./todo-session-policy"
import { createVerificationSessionPolicy } from "./verification-session-policy"

export interface SessionPolicy {
  onAssistantMessage(input: RuntimeAssistantMessageInput): PolicyResult<RuntimeEffect> | Promise<PolicyResult<RuntimeEffect>>
  onSessionIdle(input: RuntimeSessionIdleInput): PolicyResult<RuntimeEffect> | Promise<PolicyResult<RuntimeEffect>>
  onSessionDeleted(input: RuntimeSessionDeletedInput): PolicyResult<RuntimeEffect> | Promise<PolicyResult<RuntimeEffect>>
  beforeCompaction?(input: RuntimeBeforeCompactionInput): void | Promise<void>
  onCompaction(input: RuntimeCompactionInput): PolicyResult<RuntimeEffect> | Promise<PolicyResult<RuntimeEffect>>
}

export function createHookBackedSessionPolicy(args?: {
  reviewerResolver?: {
    forBaseAgent(baseAgent: "weft" | "warp", scope: "direct" | "post-execution"): ReviewerPlan
  }
  todoContinuationEnforcer?: {
    checkAndFinalize: (sessionId: string) => Promise<void>
    clearSession: (sessionId: string) => void
  } | null
  compactionPreserver?: {
    capture: (sessionId: string) => Promise<void>
    restore: (sessionId: string) => Promise<void>
    clearSession: (sessionId: string) => void
  } | null
}): SessionPolicy {
  const executionLeaseRepository = createExecutionLeaseFsStore()
  const contextWindowPolicy = createContextWindowSessionPolicy()
  const todoPolicy = createTodoSessionPolicy(args?.todoContinuationEnforcer ?? null)
  const postExecutionReviewerFanOutPolicy = createPostExecutionReviewerFanOutSessionPolicy({
    reviewerResolver: args?.reviewerResolver,
  })
  const verificationPolicy = createVerificationSessionPolicy()
  const compactionPolicy = createCompactionSessionPolicy(args?.compactionPreserver ?? null)

  return {
    onAssistantMessage(input) {
      contextWindowPolicy.onAssistantMessage(input)
      return createPolicyResult<RuntimeEffect>()
    },
    async onSessionIdle(input) {
      const idleEffects = await runIdleCycle({
          sessionId: input.sessionId,
          directory: input.directory,
          hooks: input.hooks,
          lastAssistantMessage: input.lastAssistantMessage,
          lastUserMessage: input.lastUserMessage,
          todoContinuationEnforcer: args?.todoContinuationEnforcer ?? null,
        })
      const postExecutionReviewerResult = postExecutionReviewerFanOutPolicy.onSessionIdle(input)
      const postExecutionReviewerEffects = postExecutionReviewerResult instanceof Promise
        ? await postExecutionReviewerResult
        : postExecutionReviewerResult
      const verificationResult = verificationPolicy.onSessionIdle(input)
      const verificationEffects = verificationResult instanceof Promise
        ? await verificationResult
        : verificationResult

      return createPolicyResult([
        ...idleEffects,
        ...postExecutionReviewerEffects.effects,
        ...verificationEffects.effects,
      ])
    },
    onSessionDeleted(input) {
      clearTokenSession(input.sessionId)
      todoPolicy.onSessionDeleted(input)
      compactionPolicy.onSessionDeleted?.(input.sessionId)

      if (input.directory) {
        const projection = projectExecutionTransition({
          event: "delete_session",
          sessionId: input.sessionId,
          currentLease: executionLeaseRepository.readExecutionLease(input.directory),
          currentSessionRuntime: executionLeaseRepository.readSessionRuntime(input.directory, input.sessionId),
        })

        if (projection.lease) {
          executionLeaseRepository.writeExecutionLease(input.directory, projection.lease)
        } else {
          executionLeaseRepository.clearExecutionLease(input.directory)
        }
        executionLeaseRepository.clearSessionRuntime(input.directory, input.sessionId)
      }

      return createPolicyResult<RuntimeEffect>()
    },
    async beforeCompaction(input) {
      await compactionPolicy.beforeCompaction(input)
    },
    onCompaction(input) {
      return compactionPolicy.onCompaction(input)
    },
  }
}
