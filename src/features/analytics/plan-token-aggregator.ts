import type { MetricsTokenUsage } from "./types"
import { zeroTokenUsage } from "./types"
import { readSessionSummaries } from "./storage"

/**
 * Aggregate token usage for a plan by summing across matching session summaries.
 *
 * Reads all session summaries, filters to those whose `sessionId` is in `sessionIds`,
 * and sums their `tokenUsage` fields. Sessions without `tokenUsage` contribute zeros
 * (backward compatibility).
 *
 * Maps from session TokenUsage (inputTokens/outputTokens) to MetricsTokenUsage (input/output).
 */
export function aggregateTokensForPlan(directory: string, sessionIds: string[]): MetricsTokenUsage {
  const summaries = readSessionSummaries(directory)
  const sessionIdSet = new Set(sessionIds)
  const total = zeroTokenUsage()

  for (const summary of summaries) {
    if (!sessionIdSet.has(summary.sessionId)) continue

    if (summary.tokenUsage) {
      total.input += summary.tokenUsage.inputTokens
      total.output += summary.tokenUsage.outputTokens
      total.reasoning += summary.tokenUsage.reasoningTokens
      total.cacheRead += summary.tokenUsage.cacheReadTokens
      total.cacheWrite += summary.tokenUsage.cacheWriteTokens
    }
  }

  return total
}
