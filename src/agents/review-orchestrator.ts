import type { PluginContext } from "../plugin/types"
import type { ReviewerPlan } from "./review-resolver"

export interface ReviewResult {
  model: string
  output: string
  success: boolean
  error?: string
}

export interface RunAdditionalReviewersInput {
  reviewers: ReviewerEntry[]
  prompt: string
  client: PluginContext["client"]
}

export interface ReviewerEntry {
  agentName: string
  model: string
}

export interface CollateReviewsInput {
  agentName: string
  primaryModel: string
  primaryOutput: string
  additionalResults: ReviewResult[]
  originalContext: string
  client: PluginContext["client"]
}

export interface BuildFailureWarningInput {
  totalAdditional: number
  failedCount: number
  failedResults?: ReviewResult[]
}

type ReviewClient = {
  session: {
    create(input?: Record<string, unknown>): Promise<unknown>
    prompt(input: Record<string, unknown>): Promise<unknown>
  }
}

export async function runAdditionalReviewers(input: RunAdditionalReviewersInput): Promise<ReviewResult[]> {
  const { reviewers, prompt, client } = input
  const reviewClient = client as unknown as ReviewClient

  const settledResults = await Promise.allSettled(
    reviewers.map((reviewer) => runSingleReviewer({ reviewer, prompt, client: reviewClient })),
  )

  return settledResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value
    }

    return {
      model: reviewers[index]?.model ?? "unknown",
      output: "",
      success: false,
      error: toErrorMessage(result.reason),
    }
  })
}

export async function collateReviews(input: CollateReviewsInput): Promise<string> {
  const { agentName, primaryModel, primaryOutput, additionalResults, originalContext, client } = input
  const reviewClient = client as unknown as ReviewClient
  const sessionId = await createEphemeralSession(reviewClient, "review-collation")
  const prompt = buildCollationPrompt({
    primaryModel,
    primaryOutput,
    additionalResults,
    originalContext,
  })

  const response = await reviewClient.session.prompt(buildPromptRequest({
    sessionId,
    agentName,
    model: primaryModel,
    prompt,
  }))

  const output = extractOutputText(unwrapResponseData(response))
  if (!output) {
    throw new Error("Primary model did not return collated review output")
  }

  return output
}

export function buildFailureWarning(input: BuildFailureWarningInput): string {
  const { totalAdditional, failedCount } = input
  const details = formatFailureDetails(input.failedResults)

  if (totalAdditional > 0 && failedCount >= totalAdditional) {
    const headline = `⚠️ All ${totalAdditional} additional review models failed. Showing primary model review only.`
    return details ? `${headline}\n\nFailed reviewers:\n${details}` : headline
  }

  const headline = `⚠️ ${failedCount} of ${totalAdditional} additional review models did not respond. Results based on ${totalAdditional - failedCount + 1} models (including primary).`
  return details ? `${headline}\n\nFailed reviewers:\n${details}` : headline
}

export async function runReviewerFanOut(input: {
  plan: ReviewerPlan
  capturedPrimaryOutput?: string
  promptText: string
  originalContext: string
  client: PluginContext["client"]
}): Promise<{ output: string; failureWarning: string | null; ran: string[] }> {
  const { plan, capturedPrimaryOutput, promptText, originalContext, client } = input

  if (plan.kind === "disabled") {
    return { output: "", failureWarning: null, ran: [] }
  }

  if (plan.kind === "primary-only") {
    if (plan.scope === "direct") {
      if (capturedPrimaryOutput === undefined) {
        return { output: "", failureWarning: null, ran: [] }
      }

      return {
        output: capturedPrimaryOutput,
        failureWarning: null,
        ran: [plan.primary.agentName],
      }
    }

    const [primaryResult] = await runAdditionalReviewers({
      reviewers: [{ agentName: plan.primary.agentName, model: plan.primary.model }],
      prompt: promptText,
      client,
    })

    if (!primaryResult?.success) {
      return { output: "", failureWarning: null, ran: [] }
    }

    return {
      output: primaryResult.output,
      failureWarning: null,
      ran: [plan.primary.agentName],
    }
  }

  const variantEntries: ReviewerEntry[] = plan.variants.map((variant) => ({
    agentName: variant.key,
    model: variant.model,
  }))

  if (plan.scope === "direct") {
    if (capturedPrimaryOutput === undefined) {
      return { output: "", failureWarning: null, ran: [] }
    }

    const additionalResults = await runAdditionalReviewers({
      reviewers: variantEntries,
      prompt: promptText,
      client,
    })

    const failedAdditional = additionalResults.filter((result) => !result.success)
    const successfulAdditionalRan = additionalResults
      .map((result, index) => (result.success ? variantEntries[index]?.agentName : null))
      .filter((name): name is string => typeof name === "string")
    const failureWarning = failedAdditional.length > 0
      ? buildFailureWarning({
        totalAdditional: variantEntries.length,
        failedCount: failedAdditional.length,
        failedResults: failedAdditional,
      })
      : null

    if (variantEntries.length > 0 && failedAdditional.length >= variantEntries.length) {
      return {
        output: capturedPrimaryOutput,
        failureWarning,
        ran: [plan.primary.agentName],
      }
    }

    const collated = await collateReviews({
      agentName: plan.primary.agentName,
      primaryModel: plan.primary.model,
      primaryOutput: capturedPrimaryOutput,
      additionalResults,
      originalContext,
      client,
    })

    return {
      output: failureWarning ? `${failureWarning}\n\n${collated}` : collated,
      failureWarning,
      ran: [
        plan.primary.agentName,
        ...successfulAdditionalRan,
      ],
    }
  }

  const allReviewers: ReviewerEntry[] = [
    { agentName: plan.primary.agentName, model: plan.primary.model },
    ...variantEntries,
  ]
  const reviewResults = await runAdditionalReviewers({
    reviewers: allReviewers,
    prompt: promptText,
    client,
  })

  const [primaryResult, ...additionalResults] = reviewResults
  const failedAdditional = additionalResults.filter((result) => !result.success)
  const successfulAdditionalRan = additionalResults
    .map((result, index) => (result.success ? variantEntries[index]?.agentName : null))
    .filter((name): name is string => typeof name === "string")
  const failureWarning = failedAdditional.length > 0
    ? buildFailureWarning({
      totalAdditional: variantEntries.length,
      failedCount: failedAdditional.length,
      failedResults: failedAdditional,
    })
    : null

  const allFailed = reviewResults.length > 0 && reviewResults.every((result) => !result.success)
  if (allFailed) {
    return {
      output: "",
      failureWarning,
      ran: [],
    }
  }

  if (primaryResult?.success && failedAdditional.length >= variantEntries.length) {
    return {
      output: primaryResult.output,
      failureWarning,
      ran: [plan.primary.agentName],
    }
  }

  if (!primaryResult?.success) {
    if (successfulAdditionalRan.length > 0) {
      const collated = await collateReviews({
        agentName: plan.primary.agentName,
        primaryModel: plan.primary.model,
        primaryOutput: "",
        additionalResults,
        originalContext,
        client,
      })

      return {
        output: failureWarning ? `${failureWarning}\n\n${collated}` : collated,
        failureWarning,
        ran: successfulAdditionalRan,
      }
    }

    return {
      output: "",
      failureWarning,
      ran: successfulAdditionalRan,
    }
  }

  const collated = await collateReviews({
    agentName: plan.primary.agentName,
    primaryModel: plan.primary.model,
    primaryOutput: primaryResult.output,
    additionalResults,
    originalContext,
    client,
  })

  return {
    output: failureWarning ? `${failureWarning}\n\n${collated}` : collated,
    failureWarning,
    ran: [
      plan.primary.agentName,
      ...successfulAdditionalRan,
    ],
  }
}

function formatFailureDetails(results: ReviewResult[] | undefined): string {
  const failures = results?.filter((result) => !result.success) ?? []
  return failures
    .map((result) => `- ${result.model}: ${result.error ?? "No response received."}`)
    .join("\n")
}

async function runSingleReviewer(input: {
  reviewer: ReviewerEntry
  prompt: string
  client: ReviewClient
}): Promise<ReviewResult> {
  const { reviewer, prompt, client } = input
  const { agentName, model } = reviewer
  const sessionId = await createEphemeralSession(client, `${agentName}-review-${sanitizeModelName(model)}`)

  const response = await client.session.prompt(buildPromptRequest({
    sessionId,
    agentName,
    model,
    prompt,
  }))

  const output = extractOutputText(unwrapResponseData(response))
  if (!output) {
    throw new Error(`Reviewer ${model} returned no output`)
  }

  return {
    model,
    output,
    success: true,
  }
}

async function createEphemeralSession(client: ReviewClient, title: string): Promise<string> {
  const response = await client.session.create({
    title,
    body: { title },
  })

  const sessionId = extractSessionId(unwrapResponseData(response))
  if (!sessionId) {
    throw new Error("Failed to create review session")
  }

  return sessionId
}

function buildPromptRequest(input: {
  sessionId: string
  agentName: string
  model: string
  prompt: string
}): Record<string, unknown> {
  const { sessionId, agentName, model, prompt } = input

  return {
    sessionID: sessionId,
    path: { id: sessionId, sessionID: sessionId },
    body: {
      ...(agentName ? { agent: agentName } : {}),
      model: toModelOverride(model),
      parts: [{ type: "text", text: prompt }],
    },
  }
}

function buildCollationPrompt(input: {
  primaryModel: string
  primaryOutput: string
  additionalResults: ReviewResult[]
  originalContext: string
}): string {
  const successfulReviews = input.additionalResults
    .filter((result) => result.success)
    .map((result) => `## Additional reviewer: ${result.model}\n\n${result.output.trim()}`)

  const failedReviews = input.additionalResults
    .filter((result) => !result.success)
    .map((result) => `- ${result.model}: ${result.error ?? "No response received."}`)

  return [
    "You are collating multiple AI review outputs into a single consolidated review.",
    "Merge overlapping findings, deduplicate repeated points, and preserve unique issues.",
    "Err toward inclusion: false negatives are intolerable, so keep plausible concerns unless clearly contradicted.",
    "Match the format and tone of the input reviews rather than inventing a new structure.",
    "",
    "## Original review context",
    input.originalContext.trim(),
    "",
    `## Primary reviewer: ${input.primaryModel}`,
    input.primaryOutput.trim(),
    "",
    ...(successfulReviews.length > 0
      ? ["## Additional reviewer outputs", "", successfulReviews.join("\n\n")]
      : ["## Additional reviewer outputs", "", "No successful additional reviewer outputs were available."]),
    "",
    "## Failed additional reviewers",
    failedReviews.length > 0 ? failedReviews.join("\n") : "- None",
    "",
    "Return only the final collated review.",
  ].join("\n")
}

function toModelOverride(model: string): { providerID: string; modelID: string } {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    throw new Error(`Model must be provider-qualified: ${model}`)
  }

  return {
    providerID: model.slice(0, separatorIndex),
    modelID: model.slice(separatorIndex + 1),
  }
}

function unwrapResponseData(response: unknown): unknown {
  if (!isRecord(response)) {
    return response
  }

  return "data" in response ? response.data : response
}

function extractSessionId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  const id = value.id
  return typeof id === "string" && id.length > 0 ? id : null
}

function extractOutputText(value: unknown): string {
  return firstNonEmptyString([
    readStringAtPath(value, ["output"]),
    readStringAtPath(value, ["result", "output"]),
    readStringAtPath(value, ["text"]),
    readStringAtPath(value, ["message", "text"]),
    readStringAtPath(value, ["lastAssistantMessage", "text"]),
    extractTextFromParts(readUnknownAtPath(value, ["parts"])),
    extractTextFromParts(readUnknownAtPath(value, ["message", "parts"])),
    extractTextFromParts(readUnknownAtPath(value, ["lastAssistantMessage", "parts"])),
    extractTextFromMessages(readUnknownAtPath(value, ["messages"])),
  ])
}

function extractTextFromMessages(value: unknown): string {
  if (!Array.isArray(value)) {
    return ""
  }

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const entry = value[index]
    const text = firstNonEmptyString([
      readStringAtPath(entry, ["text"]),
      extractTextFromParts(readUnknownAtPath(entry, ["parts"])),
      extractTextFromParts(readUnknownAtPath(entry, ["message", "parts"])),
    ])
    if (text) {
      return text
    }
  }

  return ""
}

function extractTextFromParts(value: unknown): string {
  if (!Array.isArray(value)) {
    return ""
  }

  const text = value
    .map((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
        return ""
      }
      return part.text.trim()
    })
    .filter((part): part is string => part.length > 0)
    .join("\n")

  return text
}

function readUnknownAtPath(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function readStringAtPath(value: unknown, path: string[]): string {
  const result = readUnknownAtPath(value, path)
  return typeof result === "string" ? result.trim() : ""
}

function firstNonEmptyString(values: string[]): string {
  return values.find((value) => value.length > 0) ?? ""
}

function sanitizeModelName(model: string): string {
  return model.replace(/[^a-zA-Z0-9_-]+/g, "-")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === "string" ? error : "Unknown error"
}
