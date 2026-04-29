import { describe, it, expect, mock } from "bun:test"
import {
  buildFailureWarning,
  collateReviews,
  runAdditionalReviewers,
  type ReviewResult,
  type RunAdditionalReviewersInput,
} from "./review-orchestrator"

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
  it("returns empty results immediately when reviewModels is empty", async () => {
    const client = makeClient()

    const results = await runAdditionalReviewers({
      agentName: "loom",
      reviewModels: [],
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
      agentName: "loom",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
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
      agentName: "loom",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
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
      agentName: "loom",
      reviewModels: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
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
      agentName: "loom",
      reviewModels: ["anthropic/claude-sonnet-4"],
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
