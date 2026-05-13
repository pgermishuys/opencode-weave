import { describe, expect, it, mock } from "bun:test"
import type { ReviewerPlan } from "../../agents/review-resolver"
import { applyRuntimeEffects } from "./apply-effects"

function fanOutPlan(scope: "direct" | "post-execution"): ReviewerPlan {
  return {
    kind: "fan-out",
    scope,
    baseAgent: "weft",
    primary: { agentName: "weft", label: "Weft", model: "openai/gpt-4o" },
    variants: [
      { baseAgent: "weft", key: "weft.reviewer.1", model: "anthropic/claude-sonnet-4", label: "weft @ anthropic/claude-sonnet-4" },
      { baseAgent: "weft", key: "weft.reviewer.2", model: "google/gemini-2.5-pro", label: "weft @ google/gemini-2.5-pro" },
    ],
    batch: { mode: "parallel", size: 3 },
  }
}

function primaryOnlyPlan(scope: "direct" | "post-execution"): ReviewerPlan {
  return {
    kind: "primary-only",
    scope,
    baseAgent: "weft",
    primary: { agentName: "weft", label: "Weft", model: "openai/gpt-4o" },
    reason: "no-variants",
  }
}

function makeReviewerClient() {
  let sessionIndex = 0
  const createCalls: string[] = []
  const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text?: string }> } }> = []

  const client = {
    session: {
      create: mock(async (input?: { title?: string }) => {
        sessionIndex += 1
        createCalls.push(input?.title ?? "")
        return { data: { id: `review-session-${sessionIndex}` } }
      }),
      prompt: mock(async (input: { body?: { model?: { providerID?: string; modelID?: string }; parts?: Array<{ text?: string }> } }) => {
        const text = input.body?.parts?.[0]?.text ?? ""
        const provider = input.body?.model?.providerID ?? "unknown"
        const model = input.body?.model?.modelID ?? "unknown"

        if (text.includes("You are collating multiple AI review outputs into a single consolidated review.")) {
          return { data: { output: "collated output" } }
        }

        return { data: { output: `review:${provider}/${model}` } }
      }),
      promptAsync: mock(async (input: { path: { id: string }; body: { parts: Array<{ type: string; text?: string }> } }) => {
        promptAsyncCalls.push(input)
      }),
    },
  }

  return { client, createCalls, promptAsyncCalls }
}

describe("applyRuntimeEffects", () => {
  it("switches agent and appends prompt text", async () => {
    const output = {
      message: { agent: "Loom (Main Orchestrator)" },
      parts: [{ type: "text", text: "hello" }],
    }

    await applyRuntimeEffects({
      effects: [
        { type: "switchAgent", agent: "tapestry" },
        { type: "appendPromptText", text: "## Injected" },
      ],
      output,
    })

    expect(output.message.agent).toBe("Tapestry (Execution Orchestrator)")
    expect(output.parts[0].text).toContain("## Injected")
  })

  it("appends prompt text by creating a new text part when needed", async () => {
    const output = {
      message: { agent: "Loom (Main Orchestrator)" },
      parts: [{ type: "image" }],
    }

    await applyRuntimeEffects({
      effects: [{ type: "appendPromptText", text: "## Injected" }],
      output,
    })

    expect(output.parts).toEqual([
      { type: "image" },
      { type: "text", text: "## Injected" },
    ])
  })

  it("injects promptAsync through client", async () => {
    const calls: Array<{ path: { id: string }; body: unknown }> = []
    const client = {
      session: {
        promptAsync: async (input: { path: { id: string }; body: unknown }) => {
          calls.push(input)
        },
      },
    }

    await applyRuntimeEffects({
      effects: [{ type: "injectPromptAsync", sessionId: "s1", text: "continue", agent: "loom" }],
      client: client as never,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].path.id).toBe("s1")
  })

  it("restores agent identity without prompt text", async () => {
    const calls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text?: string }>; agent?: string } }> = []
    const client = {
      session: {
        promptAsync: async (input: { path: { id: string }; body: { parts: Array<{ type: string; text?: string }>; agent?: string } }) => {
          calls.push(input)
        },
      },
    }

    await applyRuntimeEffects({
      effects: [{ type: "restoreAgent", sessionId: "s2", agent: "loom" }],
      client: client as never,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].path.id).toBe("s2")
    expect(calls[0].body.agent).toBe("Loom (Main Orchestrator)")
    expect(calls[0].body.parts).toEqual([])
  })

  it("appends command output as a new text part", async () => {
    const output = { parts: [] as Array<{ type: string; text: string }> }

    await applyRuntimeEffects({
      effects: [{ type: "appendCommandOutput", text: "report" }],
      output,
    })

    expect(output.parts).toEqual([{ type: "text", text: "report" }])
  })

  it("runs reviewer fan-out in direct scope and creates variants + collation sessions", async () => {
    const { client } = makeReviewerClient()

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: fanOutPlan("direct"),
        capturedPrimaryOutput: "primary direct output",
        promptText: "review this",
        originalContext: "ctx",
        idempotencyKey: "k1",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
    })

    expect(client.session.create).toHaveBeenCalledTimes(3)
  })

  it("runs reviewer fan-out in post-execution scope and creates primary + variants + collation sessions", async () => {
    const { client } = makeReviewerClient()

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: fanOutPlan("post-execution"),
        promptText: "review this",
        originalContext: "ctx",
        idempotencyKey: "k2",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
    })

    expect(client.session.create).toHaveBeenCalledTimes(4)
  })

  it("runs primary-only in post-execution scope with exactly one session.create", async () => {
    const { client } = makeReviewerClient()

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: primaryOnlyPlan("post-execution"),
        promptText: "review this",
        originalContext: "ctx",
        idempotencyKey: "k3",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
    })

    expect(client.session.create).toHaveBeenCalledTimes(1)
  })

  it("runs primary-only in direct scope with zero session.create", async () => {
    const { client } = makeReviewerClient()

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: primaryOnlyPlan("direct"),
        capturedPrimaryOutput: "primary direct output",
        promptText: "review this",
        originalContext: "ctx",
        idempotencyKey: "k4",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
    })

    expect(client.session.create).toHaveBeenCalledTimes(0)
  })

  it("dedupes second runReviewerFanOut invocation by idempotency key", async () => {
    const { client } = makeReviewerClient()
    const effect = {
      type: "runReviewerFanOut" as const,
      sessionId: "origin-session",
      plan: fanOutPlan("post-execution"),
      promptText: "review this",
      originalContext: "ctx",
      idempotencyKey: "shared-key",
      delivery: { kind: "injectPromptAsync" as const },
    }

    await applyRuntimeEffects({ effects: [effect], client: client as never })
    await applyRuntimeEffects({ effects: [effect], client: client as never })

    expect(client.session.create).toHaveBeenCalledTimes(4)
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
  })

  it("does not suppress fan-out when prompt text contains sentinel", async () => {
    const { client } = makeReviewerClient()

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: fanOutPlan("post-execution"),
        promptText: "review this <!-- weave:reviewer-fanout --> now",
        originalContext: "ctx",
        idempotencyKey: "k-sentinel",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
    })

    expect(client.session.create).toHaveBeenCalledTimes(4)
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
  })

  it("delivers final reviewer output via session.promptAsync with sentinel header", async () => {
    const { client, promptAsyncCalls } = makeReviewerClient()
    const recorded: Array<{ sessionId: string; text: string; metadata?: { kind: string; nonce?: string } }> = []

    await applyRuntimeEffects({
      effects: [{
        type: "runReviewerFanOut",
        sessionId: "origin-session",
        plan: fanOutPlan("post-execution"),
        promptText: "review this",
        originalContext: "ctx",
        idempotencyKey: "k5",
        delivery: { kind: "injectPromptAsync" },
      }],
      client: client as never,
      recordInjectedPrompt: (sessionId, text, metadata) => {
        recorded.push({ sessionId, text, metadata: metadata as { kind: string; nonce?: string } | undefined })
      },
    })

    expect(client.session.promptAsync).toHaveBeenCalledTimes(1)
    expect(promptAsyncCalls[0]?.path.id).toBe("origin-session")
    expect(promptAsyncCalls[0]?.body.parts[0]?.text).toContain("<!-- weave:reviewer-fanout -->")
    expect(promptAsyncCalls[0]?.body.parts[0]?.text).toMatch(/nonce:[0-9a-f-]{36}/i)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.metadata?.kind).toBe("reviewer-fanout")
    expect(recorded[0]?.metadata?.nonce).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
