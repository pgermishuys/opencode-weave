export type {
  RuntimePolicyFlags,
  RuntimeAssistantMessageInput,
  RuntimeAfterToolInput,
  RuntimeBeforeCompactionInput,
  RuntimeBeforeToolInput,
  RuntimeChatMessageInput,
  RuntimeCompactionInput,
  RuntimeSessionDeletedInput,
  RuntimeSessionIdleInput,
  RuntimeLifecyclePolicySurface,
  RuntimeToolDefinitionInput,
} from "../policy/runtime-policy"
import type { CreatedHooks } from "../../hooks/create-hooks"
import type { PluginContext } from "../../plugin/types"
import type { ReviewerPlan } from "../../agents/review-resolver"
import { createCompactionTodoPreserver } from "../../hooks/compaction-todo-preserver"
import { createTodoContinuationEnforcer } from "../../hooks/todo-continuation-enforcer"
import { createPolicyEngine } from "../policy/policy-engine"
import { createAutoPauseChatPolicy, createCommandChatPolicy, createTodoFinalizationChatPolicy } from "../policy/chat-policy"
import { createDirectReviewerFanOutSessionPolicy } from "../policy/direct-reviewer-fanout-session-policy"
import { createHookBackedSessionPolicy } from "../policy/session-policy"
import { createTodoDescriptionToolDefinitionPolicy } from "../policy/tool-definition-policy"
import { createHookBackedToolPolicy } from "../policy/tool-policy"

export function createRuntimeLifecyclePolicySurface(args: {
  hooks: CreatedHooks
  client?: PluginContext["client"]
  reviewerResolver?: {
    forBaseAgent(baseAgent: "weft" | "warp", scope: "direct" | "post-execution"): ReviewerPlan
  }
}
): import("../policy/runtime-policy").RuntimeLifecyclePolicySurface {
  const compactionPreserver =
    args.hooks.compactionTodoPreserverEnabled && args.client
      ? createCompactionTodoPreserver(args.client)
      : null

  const todoContinuationEnforcer =
    args.hooks.todoContinuationEnforcerEnabled && args.client
      ? createTodoContinuationEnforcer(args.client, {
          allowPromptFallback: args.hooks.continuation.idle.todo_prompt,
        })
      : null

  const directReviewerFanOutPolicy = args.reviewerResolver
    ? createDirectReviewerFanOutSessionPolicy({ reviewerResolver: args.reviewerResolver })
    : null

  return createPolicyEngine({
    chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy(todoContinuationEnforcer)],
    toolPolicies: [createHookBackedToolPolicy()],
    toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
    sessionPolicies: [
      createHookBackedSessionPolicy({ reviewerResolver: args.reviewerResolver, todoContinuationEnforcer, compactionPreserver }),
      ...(directReviewerFanOutPolicy ? [directReviewerFanOutPolicy] : []),
    ],
  })
}
