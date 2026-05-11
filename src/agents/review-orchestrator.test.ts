import { describe, it, expect, mock } from "bun:test"
import {
  buildFailureWarning,
  collateReviews,
  runAdditionalReviewers,
  runReviewerFanOut,
  type ReviewResult,
  type RunAdditionalReviewersInput,
} from "./review-orchestrator"
import type { ReviewerPlan } from "./review-resolver"

type MockClient = RunAdditionalReviewersInput["client"] & {
  session: {
    create: ReturnType<typeof mock>
    prompt: ReturnType<typeof mock>
  }
}

function makeClient(overrides?: Partial<MockClient["session"]>): MockClient {
  const session = {
    create: mock(async () => ({ data: { id: "session-1" } })),
    prompt: mock(async () => ({ data: { output: "Collated review" } })),
    ...overrides,
  }

  return { session } as MockClient
}

function makeCreateMock(...sessionIds: string[]) {
  let index = 0

  return mock(async () => ({ data: { id: sessionIds[index++] ?? `session-${index}` } }))
}

function reviewerEntries(models: string[], agentName = "loom") {
  return models.map((model) => ({ agentName, model }))
}

async function finalizeReview(input: {
  agentName: string
  primaryModel: string
  primaryOutput: string
  additionalResults: ReviewResult[]
  originalContext: string
  reviewModels: string[]
  client: RunAdditionalReviewersInput["client"]
}): Promise<string> {
  const failedCount = input.additionalResults.filter((result) => !result.success).length
  const allFailed = failedCount >= input.additionalResults.length

  if (allFailed) {
    return `${buildFailureWarning({ totalAdditional: input.reviewModels.length, failedCount })}\n\n${input.primaryOutput}`
  }

  const collated = await collateReviews({
    agentName: input.agentName,
    primaryModel: input.primaryModel,
    primaryOutput: input.primaryOutput,
    additionalResults: input.additionalResults,
    originalContext: input.originalContext,
    client: input.client,
  })
  const warning = failedCount > 0
    ? `${buildFailureWarning({ totalAdditional: input.reviewModels.length, failedCount })}\n\n`
    : ""

  return warning + collated
}

describe("runAdditionalReviewers", () => {
  it("uses each reviewer entry's agentName in prompt request body", async () => {
    const create = makeCreateMock("review-1", "review-2")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "review-1") {
        return { data: { output: "Review from agent A" } }
      }

      return { data: { output: "Review from agent B" } }
    })
    const client = makeClient({ create, prompt })

    const results = await runAdditionalReviewers({
      reviewers: [
        { agentName: "loom", model: "anthropic/claude-sonnet-4" },
        { agentName: "warp", model: "google/gemini-2.5-pro" },
      ],
      prompt: "Review this change",
      client,
    })

    expect(results).toEqual([
      { model: "anthropic/claude-sonnet-4", output: "Review from agent A", success: true },
      { model: "google/gemini-2.5-pro", output: "Review from agent B", success: true },
    ])

    const firstPrompt = prompt.mock.calls[0]?.[0] as { body?: { agent?: string } }
    const secondPrompt = prompt.mock.calls[1]?.[0] as { body?: { agent?: string } }

    expect(firstPrompt.body?.agent).toBe("loom")
    expect(secondPrompt.body?.agent).toBe("warp")
  })

  it("creates distinct session titles when reviewer entries use different agent names", async () => {
    const create = mock(async (input?: Record<string, unknown>) => {
      const title = (input?.title as string | undefined) ?? "session"
      return { data: { id: `session-${title}` } }
    })
    const client = makeClient({
      create,
      prompt: mock(async () => ({ data: { output: "ok" } })),
    })

    await runAdditionalReviewers({
      reviewers: [
        { agentName: "loom", model: "openai/gpt-4o" },
        { agentName: "warp", model: "openai/gpt-4o" },
      ],
      prompt: "Review this change",
      client,
    })

    expect(create).toHaveBeenCalledTimes(2)

    const firstTitle = create.mock.calls[0]?.[0]?.title
    const secondTitle = create.mock.calls[1]?.[0]?.title

    expect(firstTitle).toBe("loom-review-openai-gpt-4o")
    expect(secondTitle).toBe("warp-review-openai-gpt-4o")
    expect(firstTitle).not.toBe(secondTitle)
  })

  it("returns empty results immediately when reviewers is empty", async () => {
    const client = makeClient()

    const results = await runAdditionalReviewers({
      reviewers: [],
      prompt: "Review this change",
      client,
    })

    expect(results).toEqual([])
    expect(client.session.create).not.toHaveBeenCalled()
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  it("collects successful additional reviewer outputs for collation", async () => {
    const create = makeCreateMock("review-1", "review-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "review-1") {
        return { data: { output: "Secondary review A" } }
      }

      if (sessionId === "review-2") {
        return { data: { output: "Secondary review B" } }
      }

      return { data: { output: "Merged review from three models" } }
    })
    const client = makeClient({ create, prompt })

    const additionalResults = await runAdditionalReviewers({
      reviewers: reviewerEntries(["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"]),
      prompt: "Review this PR",
      client,
    })

    expect(additionalResults).toEqual([
      { model: "anthropic/claude-sonnet-4", output: "Secondary review A", success: true },
      { model: "google/gemini-2.5-pro", output: "Secondary review B", success: true },
    ])

    const finalOutput = await finalizeReview({
      agentName: "loom",
      primaryModel: "openai/gpt-4o",
      primaryOutput: "Primary review",
      additionalResults,
      originalContext: "Original review request",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
      client,
    })

    expect(finalOutput).toBe("Merged review from three models")
    expect(prompt).toHaveBeenCalledTimes(3)

    const collateRequest = prompt.mock.calls[2]?.[0] as {
      body?: { model?: { providerID: string; modelID: string }; parts?: Array<{ text?: string }> }
    }
    const promptText = collateRequest.body?.parts?.[0]?.text ?? ""

    expect(collateRequest.body?.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
    expect(promptText).toContain("## Primary reviewer: openai/gpt-4o")
    expect(promptText).toContain("Primary review")
    expect(promptText).toContain("## Additional reviewer: anthropic/claude-sonnet-4")
    expect(promptText).toContain("Secondary review A")
    expect(promptText).toContain("## Additional reviewer: google/gemini-2.5-pro")
    expect(promptText).toContain("Secondary review B")
    expect(promptText).toContain("## Failed additional reviewers")
    expect(promptText).toContain("- None")
  })

  it("returns successful outputs plus a prepended partial failure warning when one reviewer fails", async () => {
    const create = makeCreateMock("review-1", "review-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "review-1") {
        return { data: { output: "Secondary review A" } }
      }

      if (sessionId === "review-2") {
        throw new Error("secondary reviewer unavailable")
      }

      return { data: { output: "Merged review from two models" } }
    })
    const client = makeClient({ create, prompt })

    const additionalResults = await runAdditionalReviewers({
      reviewers: reviewerEntries(["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"]),
      prompt: "Review this PR",
      client,
    })

    expect(additionalResults).toEqual([
      { model: "anthropic/claude-sonnet-4", output: "Secondary review A", success: true },
      {
        model: "google/gemini-2.5-pro",
        output: "",
        success: false,
        error: "secondary reviewer unavailable",
      },
    ])

    const finalOutput = await finalizeReview({
      agentName: "loom",
      primaryModel: "openai/gpt-4o",
      primaryOutput: "Primary review",
      additionalResults,
      originalContext: "Original review request",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
      client,
    })

    expect(finalOutput).toBe(
      "⚠️ 1 of 2 additional review models did not respond. Results based on 2 models (including primary).\n\nMerged review from two models",
    )
    expect(prompt).toHaveBeenCalledTimes(3)

    const collateRequest = prompt.mock.calls[2]?.[0] as { body?: { parts?: Array<{ text?: string }> } }
    const promptText = collateRequest.body?.parts?.[0]?.text ?? ""

    expect(promptText).toContain("## Additional reviewer: anthropic/claude-sonnet-4")
    expect(promptText).toContain("Secondary review A")
    expect(promptText).not.toContain("## Additional reviewer: google/gemini-2.5-pro")
    expect(promptText).toContain("- google/gemini-2.5-pro: secondary reviewer unavailable")
  })

  it("returns the primary output with a total failure warning when all reviewers fail", async () => {
    const create = makeCreateMock("review-1", "review-2")
    const prompt = mock(async () => {
      throw new Error("reviewer offline")
    })
    const client = makeClient({ create, prompt })

    const additionalResults = await runAdditionalReviewers({
      reviewers: reviewerEntries(["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"]),
      prompt: "Review this PR",
      client,
    })

    expect(additionalResults).toEqual([
      { model: "anthropic/claude-sonnet-4", output: "", success: false, error: "reviewer offline" },
      { model: "google/gemini-2.5-pro", output: "", success: false, error: "reviewer offline" },
    ])

    const finalOutput = await finalizeReview({
      agentName: "loom",
      primaryModel: "openai/gpt-4o",
      primaryOutput: "Primary review only",
      additionalResults,
      originalContext: "Original review request",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
      client,
    })

    expect(finalOutput).toBe(
      "⚠️ All 2 additional review models failed. Showing primary model review only.\n\nPrimary review only",
    )
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it("treats a reviewer with no output as a failure", async () => {
    const create = makeCreateMock("review-1")
    const prompt = mock(async () => ({ data: { output: "" } }))
    const client = makeClient({ create, prompt })

    const [result] = await runAdditionalReviewers({
      reviewers: reviewerEntries(["anthropic/claude-sonnet-4"]),
      prompt: "Review this PR",
      client,
    })

    expect(result).toEqual({
      model: "anthropic/claude-sonnet-4",
      output: "",
      success: false,
      error: "Reviewer anthropic/claude-sonnet-4 returned no output",
    })
  })

  it("sends each reviewer's agentName in the prompt request body", async () => {
    const create = makeCreateMock("review-1", "review-2")
    const prompt = mock(async () => ({ data: { output: "Secondary review" } }))
    const client = makeClient({ create, prompt })

    await runAdditionalReviewers({
      reviewers: [
        { agentName: "loom", model: "anthropic/claude-sonnet-4" },
        { agentName: "weft", model: "google/gemini-2.5-pro" },
      ],
      prompt: "Review this PR",
      client,
    })

    const firstRequest = prompt.mock.calls[0]?.[0] as { body?: { agent?: string } }
    const secondRequest = prompt.mock.calls[1]?.[0] as { body?: { agent?: string } }

    expect(firstRequest.body?.agent).toBe("loom")
    expect(secondRequest.body?.agent).toBe("weft")
  })

  it("creates distinct session titles when reviewers use different agent names", async () => {
    const create = makeCreateMock("review-1", "review-2")
    const prompt = mock(async () => ({ data: { output: "Secondary review" } }))
    const client = makeClient({ create, prompt })

    await runAdditionalReviewers({
      reviewers: [
        { agentName: "loom", model: "anthropic/claude-sonnet-4" },
        { agentName: "weft", model: "anthropic/claude-sonnet-4" },
      ],
      prompt: "Review this PR",
      client,
    })

    const firstCreate = create.mock.calls[0]?.[0] as { title?: string }
    const secondCreate = create.mock.calls[1]?.[0] as { title?: string }

    expect(firstCreate.title).toBe("loom-review-anthropic-claude-sonnet-4")
    expect(secondCreate.title).toBe("weft-review-anthropic-claude-sonnet-4")
    expect(firstCreate.title).not.toBe(secondCreate.title)
  })

})

describe("runReviewerFanOut", () => {
  const promptText = "Please review this patch"
  const originalContext = "Review the code changes for correctness and risk"

  function fanOutPlan(scope: "direct" | "post-execution"): ReviewerPlan {
    return {
      kind: "fan-out",
      scope,
      baseAgent: "weft",
      primary: {
        agentName: "weft",
        label: "Weft",
        model: "openai/gpt-4o",
      },
      variants: [
        {
          baseAgent: "weft",
          key: "weft-review-anthropic-claude-sonnet-4",
          model: "anthropic/claude-sonnet-4",
          label: "weft @ anthropic/claude-sonnet-4",
        },
        {
          baseAgent: "weft",
          key: "weft-review-google-gemini-2-5-pro",
          model: "google/gemini-2.5-pro",
          label: "weft @ google/gemini-2.5-pro",
        },
      ],
      batch: { mode: "parallel", size: 3 },
    }
  }

  function primaryOnlyPlan(scope: "direct" | "post-execution"): ReviewerPlan {
    return {
      kind: "primary-only",
      scope,
      baseAgent: "weft",
      primary: {
        agentName: "weft",
        label: "Weft",
        model: "openai/gpt-4o",
      },
      reason: "no-variants",
    }
  }

  function disabledPlan(scope: "direct" | "post-execution"): ReviewerPlan {
    return {
      kind: "disabled",
      scope,
      baseAgent: "weft",
      reason: "agent-disabled",
    }
  }

  it("fan-out direct with captured primary creates variant sessions only and collates with captured primary", async () => {
    const capturedPrimaryOutput = "Captured primary output"
    const create = makeCreateMock("variant-1", "variant-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "variant-1") return { data: { output: "Variant output A" } }
      if (sessionId === "variant-2") return { data: { output: "Variant output B" } }
      return { data: { output: "Collated fan-out output" } }
    })
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: fanOutPlan("direct"),
      capturedPrimaryOutput,
      promptText,
      originalContext,
      client,
    })

    expect(result).toEqual({
      output: "Collated fan-out output",
      failureWarning: null,
      ran: [
        "weft",
        "weft-review-anthropic-claude-sonnet-4",
        "weft-review-google-gemini-2-5-pro",
      ],
    })
    expect(create).toHaveBeenCalledTimes(3)
    expect(prompt).toHaveBeenCalledTimes(3)

    const variantPrompt1 = (prompt.mock.calls[0]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    const variantPrompt2 = (prompt.mock.calls[1]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(variantPrompt1).toContain(promptText)
    expect(variantPrompt1).not.toContain(capturedPrimaryOutput)
    expect(variantPrompt2).toContain(promptText)
    expect(variantPrompt2).not.toContain(capturedPrimaryOutput)

    const collatePrompt = (prompt.mock.calls[2]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(collatePrompt).toContain("## Primary reviewer: openai/gpt-4o")
    expect(collatePrompt).toContain(capturedPrimaryOutput)
  })

  it("fan-out post-execution runs 1+N+1 calls and reviewers receive promptText", async () => {
    const create = makeCreateMock("primary-1", "variant-1", "variant-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "primary-1") return { data: { output: "Primary generated output" } }
      if (sessionId === "variant-1") return { data: { output: "Variant output A" } }
      if (sessionId === "variant-2") return { data: { output: "Variant output B" } }
      return { data: { output: "Collated post-execution output" } }
    })
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: fanOutPlan("post-execution"),
      promptText,
      originalContext,
      client,
    })

    expect(result.output).toBe("Collated post-execution output")
    expect(result.failureWarning).toBeNull()
    expect(result.ran).toEqual([
      "weft",
      "weft-review-anthropic-claude-sonnet-4",
      "weft-review-google-gemini-2-5-pro",
    ])
    expect(create).toHaveBeenCalledTimes(4)
    expect(prompt).toHaveBeenCalledTimes(4)

    const primaryPrompt = (prompt.mock.calls[0]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    const variantPrompt1 = (prompt.mock.calls[1]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    const variantPrompt2 = (prompt.mock.calls[2]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(primaryPrompt).toContain(promptText)
    expect(variantPrompt1).toContain(promptText)
    expect(variantPrompt2).toContain(promptText)
  })

  it("primary-only direct with captured output returns captured text without any session calls", async () => {
    const client = makeClient()

    const result = await runReviewerFanOut({
      plan: primaryOnlyPlan("direct"),
      capturedPrimaryOutput: "Primary captured review",
      promptText,
      originalContext,
      client,
    })

    expect(result).toEqual({
      output: "Primary captured review",
      failureWarning: null,
      ran: ["weft"],
    })
    expect(client.session.create).toHaveBeenCalledTimes(0)
    expect(client.session.prompt).toHaveBeenCalledTimes(0)
  })

  it("primary-only post-execution runs exactly one reviewer session and prompt with no collation", async () => {
    const create = makeCreateMock("primary-1")
    const prompt = mock(async () => ({ data: { output: "Primary output" } }))
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: primaryOnlyPlan("post-execution"),
      promptText,
      originalContext,
      client,
    })

    expect(result).toEqual({
      output: "Primary output",
      failureWarning: null,
      ran: ["weft"],
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)

    const requestPrompt = (prompt.mock.calls[0]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(requestPrompt).toContain(promptText)
  })

  it("disabled plan in either scope returns empty output with zero calls", async () => {
    const client = makeClient()

    const directResult = await runReviewerFanOut({
      plan: disabledPlan("direct"),
      capturedPrimaryOutput: "ignored",
      promptText,
      originalContext,
      client,
    })
    const postResult = await runReviewerFanOut({
      plan: disabledPlan("post-execution"),
      promptText,
      originalContext,
      client,
    })

    expect(directResult).toEqual({ output: "", failureWarning: null, ran: [] })
    expect(postResult).toEqual({ output: "", failureWarning: null, ran: [] })
    expect(client.session.create).toHaveBeenCalledTimes(0)
    expect(client.session.prompt).toHaveBeenCalledTimes(0)
  })

  it("fan-out direct with one failing variant sets warning and collates partial with captured primary", async () => {
    const capturedPrimaryOutput = "Captured direct primary"
    const create = makeCreateMock("variant-1", "variant-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "variant-1") return { data: { output: "Variant success" } }
      if (sessionId === "variant-2") throw new Error("variant down")
      return { data: { output: "Collated partial" } }
    })
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: fanOutPlan("direct"),
      capturedPrimaryOutput,
      promptText,
      originalContext,
      client,
    })

    expect(result.failureWarning).toBe(
      "⚠️ 1 of 2 additional review models did not respond. Results based on 2 models (including primary).\n\nFailed reviewers:\n- google/gemini-2.5-pro: variant down",
    )
    expect(result.output).toContain("Collated partial")
    const collatePrompt = (prompt.mock.calls[2]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(collatePrompt).toContain(capturedPrimaryOutput)
    expect(collatePrompt).toContain("## Additional reviewer: anthropic/claude-sonnet-4")
    expect(collatePrompt).not.toContain("## Additional reviewer: google/gemini-2.5-pro")
    expect(collatePrompt).toContain("- google/gemini-2.5-pro: variant down")
  })

  it("fan-out post-execution with failed primary and one successful variant still collates with warning", async () => {
    const create = makeCreateMock("primary-1", "variant-1", "variant-2", "collate-1")
    const prompt = mock(async (input: Record<string, unknown>) => {
      const sessionId = ((input.path as { id?: string } | undefined)?.id) ?? ""
      if (sessionId === "primary-1") throw new Error("primary failed")
      if (sessionId === "variant-1") return { data: { output: "Variant survives" } }
      if (sessionId === "variant-2") throw new Error("variant failed")
      return { data: { output: "Collated surviving variant" } }
    })
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: fanOutPlan("post-execution"),
      promptText,
      originalContext,
      client,
    })

    expect(result.failureWarning).toBe(
      "⚠️ 1 of 2 additional review models did not respond. Results based on 2 models (including primary).\n\nFailed reviewers:\n- google/gemini-2.5-pro: variant failed",
    )
    expect(result.output).toContain("Collated surviving variant")
    expect(result.ran).toEqual(["weft-review-anthropic-claude-sonnet-4"])
    expect(create).toHaveBeenCalledTimes(4)
    expect(prompt).toHaveBeenCalledTimes(4)

    const collatePrompt = (prompt.mock.calls[3]?.[0] as { body?: { parts?: Array<{ text?: string }> } }).body?.parts?.[0]?.text ?? ""
    expect(collatePrompt).toContain("## Additional reviewer: anthropic/claude-sonnet-4")
    expect(collatePrompt).toContain("Variant survives")
    expect(collatePrompt).toContain("- google/gemini-2.5-pro: variant failed")
  })

  it("fan-out post-execution with all failures returns empty output, warning, and no collation", async () => {
    const create = makeCreateMock("primary-1", "variant-1", "variant-2")
    const prompt = mock(async () => {
      throw new Error("offline")
    })
    const client = makeClient({ create, prompt })

    const result = await runReviewerFanOut({
      plan: fanOutPlan("post-execution"),
      promptText,
      originalContext,
      client,
    })

    expect(result).toEqual({
      output: "",
      failureWarning:
        "⚠️ All 2 additional review models failed. Showing primary model review only.\n\nFailed reviewers:\n- anthropic/claude-sonnet-4: offline\n- google/gemini-2.5-pro: offline",
      ran: [],
    })
    expect(create).toHaveBeenCalledTimes(3)
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  it("primary-only direct without captured output returns empty defensive result", async () => {
    const client = makeClient()

    const result = await runReviewerFanOut({
      plan: primaryOnlyPlan("direct"),
      promptText,
      originalContext,
      client,
    })

    expect(result).toEqual({ output: "", failureWarning: null, ran: [] })
    expect(client.session.create).toHaveBeenCalledTimes(0)
    expect(client.session.prompt).toHaveBeenCalledTimes(0)
  })
})

describe("buildFailureWarning", () => {
  it("returns the exact partial failure warning string", () => {
    expect(buildFailureWarning({ totalAdditional: 2, failedCount: 1 })).toBe(
      "⚠️ 1 of 2 additional review models did not respond. Results based on 2 models (including primary).",
    )
  })

  it("returns the exact total failure warning string", () => {
    expect(buildFailureWarning({ totalAdditional: 2, failedCount: 2 })).toBe(
      "⚠️ All 2 additional review models failed. Showing primary model review only.",
    )
  })
})
