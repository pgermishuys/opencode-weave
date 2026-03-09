import type { SessionSummary, Suggestion } from "./types"
import { readSessionSummaries } from "./storage"

/**
 * Minimum number of sessions before generating suggestions.
 * Too few sessions → noisy/unreliable suggestions.
 */
const MIN_SESSIONS_FOR_SUGGESTIONS = 3

/**
 * Generate suggestions based on session history.
 * Analyzes tool usage patterns, delegation frequency, and workflow patterns.
 */
export function generateSuggestions(summaries: SessionSummary[]): Suggestion[] {
  if (summaries.length < MIN_SESSIONS_FOR_SUGGESTIONS) return []

  const suggestions: Suggestion[] = []

  suggestions.push(...analyzeToolUsage(summaries))
  suggestions.push(...analyzeDelegations(summaries))
  suggestions.push(...analyzeWorkflow(summaries))
  suggestions.push(...analyzeTokenUsage(summaries))

  return suggestions
}

/**
 * Generate suggestions from stored session summaries for a project.
 */
export function getSuggestionsForProject(directory: string): Suggestion[] {
  const summaries = readSessionSummaries(directory)
  return generateSuggestions(summaries)
}

/**
 * Analyze tool usage patterns across sessions.
 */
function analyzeToolUsage(summaries: SessionSummary[]): Suggestion[] {
  const suggestions: Suggestion[] = []
  const totalSessions = summaries.length

  // Aggregate tool usage across all sessions
  const toolTotals = new Map<string, number>()
  for (const summary of summaries) {
    for (const entry of summary.toolUsage) {
      toolTotals.set(entry.tool, (toolTotals.get(entry.tool) ?? 0) + entry.count)
    }
  }

  // Check for heavily used tools
  const avgToolCalls = summaries.reduce((s, x) => s + x.totalToolCalls, 0) / totalSessions
  if (avgToolCalls > 50) {
    suggestions.push({
      id: "high-tool-usage",
      text: `Average of ${Math.round(avgToolCalls)} tool calls per session — consider breaking complex tasks into smaller plans.`,
      category: "tool-usage",
      confidence: "medium",
    })
  }

  // Check if read is disproportionately high (>60% of all calls)
  const readCount = toolTotals.get("read") ?? 0
  const totalCalls = Array.from(toolTotals.values()).reduce((s, c) => s + c, 0)
  if (totalCalls > 0 && readCount / totalCalls > 0.6) {
    suggestions.push({
      id: "read-heavy",
      text: `Read operations make up ${Math.round((readCount / totalCalls) * 100)}% of tool calls — the agent may be re-reading files. Consider using grep/glob for targeted searches.`,
      category: "tool-usage",
      confidence: "medium",
    })
  }

  return suggestions
}

/**
 * Analyze delegation patterns across sessions.
 */
function analyzeDelegations(summaries: SessionSummary[]): Suggestion[] {
  const suggestions: Suggestion[] = []
  const totalSessions = summaries.length

  // Aggregate delegation counts by agent
  const agentTotals = new Map<string, number>()
  const agentDurations = new Map<string, number[]>()

  for (const summary of summaries) {
    for (const delegation of summary.delegations) {
      agentTotals.set(delegation.agent, (agentTotals.get(delegation.agent) ?? 0) + 1)
      if (delegation.durationMs !== undefined) {
        const durations = agentDurations.get(delegation.agent) ?? []
        durations.push(delegation.durationMs)
        agentDurations.set(delegation.agent, durations)
      }
    }
  }

  // Check for under-utilized delegation
  const avgDelegations = summaries.reduce((s, x) => s + x.totalDelegations, 0) / totalSessions
  if (avgDelegations < 1 && totalSessions >= 5) {
    suggestions.push({
      id: "low-delegation",
      text: "Sessions average less than 1 delegation — consider using sub-agents (thread, pattern, weft) for parallel exploration and code review.",
      category: "delegation",
      confidence: "medium",
    })
  }

  // Check for slow delegations (average >60s)
  for (const [agent, durations] of agentDurations) {
    if (durations.length >= 2) {
      const avgMs = durations.reduce((s, d) => s + d, 0) / durations.length
      if (avgMs > 60_000) {
        suggestions.push({
          id: `slow-delegation-${agent}`,
          text: `Delegations to "${agent}" average ${Math.round(avgMs / 1000)}s — consider more specific prompts to speed up sub-agent work.`,
          category: "delegation",
          confidence: "medium",
        })
      }
    }
  }

  return suggestions
}

/**
 * Analyze token usage patterns across sessions.
 * Only processes summaries that have tokenUsage data (guards for old entries).
 */
function analyzeTokenUsage(summaries: SessionSummary[]): Suggestion[] {
  const suggestions: Suggestion[] = []

  // Filter to summaries that have token data
  const withTokens = summaries.filter((s) => s.tokenUsage && s.tokenUsage.totalMessages > 0)
  if (withTokens.length < MIN_SESSIONS_FOR_SUGGESTIONS) return suggestions

  // Check for high average input tokens per session (>100k)
  const totalInputTokens = withTokens.reduce((sum, s) => sum + s.tokenUsage!.inputTokens, 0)
  const avgInputTokens = totalInputTokens / withTokens.length
  if (avgInputTokens > 100_000) {
    suggestions.push({
      id: "high-token-usage",
      text: `Average of ${Math.round(avgInputTokens).toLocaleString()} input tokens per session — consider breaking tasks into smaller sessions to reduce context size.`,
      category: "token-usage",
      confidence: "medium",
    })
  }

  // Check for low cache hit ratio (<30%)
  const totalCacheRead = withTokens.reduce((sum, s) => sum + s.tokenUsage!.cacheReadTokens, 0)
  if (totalInputTokens > 0 && totalCacheRead / totalInputTokens < 0.3) {
    suggestions.push({
      id: "low-cache-hit-ratio",
      text: `Cache hit ratio is ${Math.round((totalCacheRead / totalInputTokens) * 100)}% — consider prompt caching strategies to reduce token consumption.`,
      category: "token-usage",
      confidence: "low",
    })
  }

  return suggestions
}

/**
 * Analyze workflow patterns across sessions.
 */
function analyzeWorkflow(summaries: SessionSummary[]): Suggestion[] {
  const suggestions: Suggestion[] = []

  // Check for very short sessions (under 30s with tool calls) — might indicate errors
  const shortSessions = summaries.filter(
    (s) => s.durationMs < 30_000 && s.totalToolCalls > 0,
  )
  if (shortSessions.length > summaries.length * 0.3 && summaries.length >= 5) {
    suggestions.push({
      id: "many-short-sessions",
      text: `${Math.round((shortSessions.length / summaries.length) * 100)}% of sessions end in under 30 seconds — this may indicate frequent errors or interrupts.`,
      category: "workflow",
      confidence: "low",
    })
  }

  // Check for very long sessions (over 30 minutes)
  const longSessions = summaries.filter((s) => s.durationMs > 30 * 60 * 1000)
  if (longSessions.length > summaries.length * 0.3 && summaries.length >= 5) {
    suggestions.push({
      id: "many-long-sessions",
      text: `${Math.round((longSessions.length / summaries.length) * 100)}% of sessions exceed 30 minutes — consider breaking work into smaller, focused tasks.`,
      category: "workflow",
      confidence: "medium",
    })
  }

  return suggestions
}
