import { describe, expect, it } from "bun:test"
import { createDirectReviewerFanOutSessionPolicy } from "./direct-reviewer-fanout-session-policy"
import type { ReviewerPlan } from "../../agents/review-resolver"

function makeFanOutPlan(baseAgent: "weft" | "warp"): ReviewerPlan {
  return {
    kind: "fan-out",
    scope: "direct",
    baseAgent,
    primary: {
      agentName: baseAgent,
      label: baseAgent === "weft" ? "Weft" : "Warp",
      model: "primary-model",
    },
    variants: [
      {
        baseAgent,
        key: `${baseAgent}-v1`,
        model: "variant-model",
        label: `${baseAgent} @ variant-model`,
      },
    ],
    batch: { mode: "parallel", size: 2 },
  }
}

describe("createDirectReviewerFanOutSessionPolicy", () => {
  it("emits fan-out effect with original prompt and captured primary output", async () => {
    const plan = makeFanOutPlan("weft")
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => plan,
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-1",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      originalPromptText: "user original request",
      messageId: "msg-1",
    })

    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      type: "runReviewerFanOut",
      sessionId: "sess-1",
      plan,
      capturedPrimaryOutput: "assistant verdict",
      promptText: "user original request",
      originalContext: "user original request",
      idempotencyKey: "sess-1:msg-1",
      delivery: { kind: "injectPromptAsync" },
    })
    expect((result.effects[0] as { promptText: string }).promptText).not.toBe("assistant verdict")
  })

  it("emits zero effects for primary-only direct plan", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => ({
          kind: "primary-only",
          scope: "direct",
          baseAgent: "warp",
          primary: { agentName: "warp", label: "Warp", model: "model" },
          reason: "no-variants",
        }),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-2",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "warp",
      assistantText: "assistant verdict",
      originalPromptText: "user original request",
      messageId: "msg-2",
    })

    expect(result.effects).toEqual([])
  })

  it("emits zero effects for disabled plan", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => ({
          kind: "disabled",
          scope: "direct",
          baseAgent: "weft",
          reason: "agent-disabled",
        }),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-3",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      originalPromptText: "user original request",
      messageId: "msg-3",
    })

    expect(result.effects).toEqual([])
  })

  it("emits zero effects when originalPromptText is missing", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-4",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      messageId: "msg-4",
    })

    expect(result.effects).toEqual([])
  })

  it("still emits fan-out when assistant text includes reviewer fan-out sentinel", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-5",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "result <!-- weave:reviewer-fanout --> message",
      originalPromptText: "user original request",
      respondingToTrustedInjectedPromptKind: "generic",
      messageId: "msg-5",
    })

    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      type: "runReviewerFanOut",
      sessionId: "sess-5",
      idempotencyKey: "sess-5:msg-5",
    })
  })

  it("emits zero effects when responding to trusted reviewer-fanout injected prompt", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-8",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      originalPromptText: "runtime injected prompt",
      respondingToTrustedInjectedPromptKind: "reviewer-fanout",
      messageId: "msg-8",
    })

    expect(result.effects).toEqual([])
  })

  it("still emits fan-out when responding to trusted generic injected prompt", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-9",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      originalPromptText: "runtime injected generic prompt",
      respondingToTrustedInjectedPromptKind: "generic",
      messageId: "msg-9",
    })

    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      type: "runReviewerFanOut",
      sessionId: "sess-9",
      idempotencyKey: "sess-9:msg-9",
    })
  })

  it("emits zero effects when messageId is missing", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-7",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "weft",
      assistantText: "assistant verdict",
      originalPromptText: "user original request",
      messageId: "",
    })

    expect(result.effects).toEqual([])
  })

  it("emits zero effects for unknown foreground agent", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-6",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "thread",
      assistantText: "assistant verdict",
      originalPromptText: "user original request",
      messageId: "msg-6",
    })

    expect(result.effects).toEqual([])
  })

  it("falls back to explicit @weft mention when foreground agent is loom", async () => {
    const plan = makeFanOutPlan("weft")
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => plan,
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-10",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "loom",
      assistantText: "assistant verdict",
      originalPromptText: "Puedes probar con @weft el ultimo commit?",
      messageId: "msg-10",
    })

    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      type: "runReviewerFanOut",
      sessionId: "sess-10",
      plan,
      idempotencyKey: "sess-10:msg-10",
    })
  })

  it("falls back to explicit @warp mention when foreground agent is loom", async () => {
    const plan = makeFanOutPlan("warp")
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => plan,
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-11",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "loom",
      assistantText: "assistant verdict",
      originalPromptText: "Puedes probar con @warp el ultimo commit?",
      messageId: "msg-11",
    })

    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      type: "runReviewerFanOut",
      sessionId: "sess-11",
      plan,
      idempotencyKey: "sess-11:msg-11",
    })
  })

  it("does not treat natural-language weft text as explicit fallback when foreground agent is loom", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-12",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "loom",
      assistantText: "assistant verdict",
      originalPromptText: "Puedes probar con weft el ultimo commit?",
      messageId: "msg-12",
    })

    expect(result.effects).toEqual([])
  })

  it("does not fallback when both @weft and @warp mentions are present and foreground agent is not explicit reviewer", async () => {
    const policy = createDirectReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent: () => makeFanOutPlan("weft"),
      },
    })

    const result = await policy.onAssistantMessage({
      directory: "repo",
      sessionId: "sess-13",
      hooks: {
        contextWindowThresholds: null,
        rulesInjectorEnabled: false,
        patternMdOnlyEnabled: false,
        verificationReminderEnabled: false,
        todoDescriptionOverrideEnabled: false,
        todoContinuationEnforcerEnabled: false,
      },
      inputTokens: 100,
      foregroundAgent: "loom",
      assistantText: "assistant verdict",
      originalPromptText: "Compare @weft and @warp on this commit",
      messageId: "msg-13",
    })

    expect(result.effects).toEqual([])
  })
})
