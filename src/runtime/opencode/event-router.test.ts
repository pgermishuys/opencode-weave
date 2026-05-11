import { describe, expect, it } from "bun:test"
import { routeRuntimeEvent, type EventRouterState } from "./event-router"
import type { RuntimeLifecyclePolicySurface } from "../../application/orchestration/session-runtime"
import type { CreatedHooks } from "../../hooks/create-hooks"
import { DEFAULT_CONTINUATION_CONFIG } from "../../config/continuation"

function makeHooks(overrides?: Partial<CreatedHooks>): CreatedHooks {
  return {
    contextWindowThresholds: null,
    rulesInjectorEnabled: false,
    writeGuard: null,
    firstMessageVariant: null,
    processMessageForKeywords: null,
    patternMdOnlyEnabled: false,
    startWork: null,
    workContinuation: null,
    workflowStart: null,
    workflowContinuation: null,
    workflowCommand: null,
    verificationReminderEnabled: false,
    analyticsEnabled: false,
    todoDescriptionOverrideEnabled: false,
    compactionTodoPreserverEnabled: false,
    todoContinuationEnforcerEnabled: false,
    compactionRecovery: null,
    continuation: DEFAULT_CONTINUATION_CONFIG,
    ...overrides,
  }
}

function makeLifecyclePolicy(
  overrides?: Partial<RuntimeLifecyclePolicySurface>,
): RuntimeLifecyclePolicySurface {
  return {
    onChatMessage: async () => [],
    beforeTool: async () => [],
    afterTool: async () => [],
    onToolDefinition: async () => undefined,
    onAssistantMessage: async () => [],
    onSessionIdle: async () => [],
    onSessionDeleted: async () => [],
    beforeCompaction: async () => undefined,
    onCompaction: async () => [],
    ...overrides,
  }
}

describe("routeRuntimeEvent", () => {
  it("passes assistantText and originalPromptText to onAssistantMessage", async () => {
    const state: EventRouterState = {
      lastAssistantMessageText: new Map([["sess-1", "latest assistant text"]]),
      lastUserMessageText: new Map([["sess-1", "latest user prompt"]]),
      lastUserMessageTrustedInjectedKind: new Map([["sess-1", "reviewer-fanout"]]),
    }
    const onAssistantMessageCalls: Array<Parameters<RuntimeLifecyclePolicySurface["onAssistantMessage"]>[0]> = []
    const lifecyclePolicy = makeLifecyclePolicy({
      onAssistantMessage: async (input) => {
        onAssistantMessageCalls.push(input)
        return []
      },
    })

    await routeRuntimeEvent({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-1",
            role: "assistant",
            sessionID: "sess-1",
            tokens: { input: 123 },
          },
        },
      },
      directory: "C:/workspace",
      hooks: makeHooks(),
      state,
      lifecyclePolicy,
    })

    expect(onAssistantMessageCalls).toHaveLength(1)
    expect(onAssistantMessageCalls[0]).toEqual(
      expect.objectContaining({
        directory: "C:/workspace",
        sessionId: "sess-1",
        inputTokens: 123,
        assistantText: "latest assistant text",
        originalPromptText: "latest user prompt",
        respondingToTrustedInjectedPromptKind: "reviewer-fanout",
        messageId: "msg-1",
      }),
    )
  })
})
