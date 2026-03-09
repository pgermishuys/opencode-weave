import type { MetricsReport, SessionSummary, MetricsTokenUsage } from "./types"

/**
 * Format a number with comma separators (e.g., 1234 → "1,234").
 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US")
}

/**
 * Format milliseconds as "Xm Ys" or "Xs" for short durations.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/**
 * Format an ISO date string as a short human-readable date.
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

/**
 * Format a single MetricsReport as a markdown section.
 */
function formatReport(report: MetricsReport): string {
  const lines: string[] = []
  const date = formatDate(report.generatedAt)

  lines.push(`#### 📊 ${report.planName} (${date})`)
  lines.push("")
  lines.push("| Metric | Value |")
  lines.push("|--------|-------|")
  lines.push(`| Coverage | ${Math.round(report.adherence.coverage * 100)}% |`)
  lines.push(`| Precision | ${Math.round(report.adherence.precision * 100)}% |`)
  lines.push(`| Sessions | ${report.sessionCount} |`)
  lines.push(`| Duration | ${formatDuration(report.durationMs)} |`)
  lines.push(`| Input Tokens | ${formatNumber(report.tokenUsage.input)} |`)
  lines.push(`| Output Tokens | ${formatNumber(report.tokenUsage.output)} |`)

  if (report.tokenUsage.reasoning > 0) {
    lines.push(`| Reasoning Tokens | ${formatNumber(report.tokenUsage.reasoning)} |`)
  }
  if (report.tokenUsage.cacheRead > 0 || report.tokenUsage.cacheWrite > 0) {
    lines.push(`| Cache Read | ${formatNumber(report.tokenUsage.cacheRead)} |`)
    lines.push(`| Cache Write | ${formatNumber(report.tokenUsage.cacheWrite)} |`)
  }

  if (report.adherence.unplannedChanges.length > 0) {
    lines.push("")
    lines.push(`**Unplanned Changes**: ${report.adherence.unplannedChanges.map((f) => `\`${f}\``).join(", ")}`)
  }

  if (report.adherence.missedFiles.length > 0) {
    lines.push("")
    lines.push(`**Missed Files**: ${report.adherence.missedFiles.map((f) => `\`${f}\``).join(", ")}`)
  }

  return lines.join("\n")
}

/**
 * Aggregate token usage from an array of SessionSummary entries.
 */
function aggregateSessionTokens(summaries: SessionSummary[]): MetricsTokenUsage {
  const total: MetricsTokenUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  for (const s of summaries) {
    if (s.tokenUsage) {
      total.input += s.tokenUsage.inputTokens
      total.output += s.tokenUsage.outputTokens
      total.reasoning += s.tokenUsage.reasoningTokens
      total.cacheRead += s.tokenUsage.cacheReadTokens
      total.cacheWrite += s.tokenUsage.cacheWriteTokens
    }
  }
  return total
}

/**
 * Compute aggregate tool usage from session summaries.
 * Returns top N tools sorted by count descending.
 */
function topTools(summaries: SessionSummary[], limit = 5): Array<{ tool: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const s of summaries) {
    for (const t of s.toolUsage) {
      counts[t.tool] = (counts[t.tool] ?? 0) + t.count
    }
  }
  return Object.entries(counts)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/**
 * Format metrics reports and session summaries into a markdown dashboard.
 *
 * @param reports - Array of MetricsReport from readMetricsReports()
 * @param summaries - Array of SessionSummary from readSessionSummaries()
 * @param args - Optional arguments: a plan name to filter, "all" for all reports, or empty for last 5
 * @returns Formatted markdown string
 */
export function formatMetricsMarkdown(
  reports: MetricsReport[],
  summaries: SessionSummary[],
  args?: string,
): string {
  // No data at all
  if (reports.length === 0 && summaries.length === 0) {
    return [
      "## Weave Metrics Dashboard",
      "",
      "No metrics data yet.",
      "",
      "To generate metrics:",
      "1. Enable analytics in `weave.json`: `{ \"analytics\": { \"enabled\": true } }`",
      "2. Create and complete a plan using Pattern and `/start-work`",
      "3. Metrics are generated automatically when a plan completes",
    ].join("\n")
  }

  const lines: string[] = ["## Weave Metrics Dashboard"]

  // Filter reports based on args
  let filteredReports = reports
  const trimmedArgs = args?.trim() ?? ""

  if (trimmedArgs && trimmedArgs !== "all") {
    // Filter by plan name (case-insensitive partial match)
    filteredReports = reports.filter((r) =>
      r.planName.toLowerCase().includes(trimmedArgs.toLowerCase()),
    )
  }

  // Apply limit: show last 5 unless "all" or filtering by name
  if (!trimmedArgs || trimmedArgs === "") {
    filteredReports = filteredReports.slice(-5)
  }

  // Plan metrics section
  if (filteredReports.length > 0) {
    lines.push("")
    lines.push("### Recent Plan Metrics")

    for (let i = 0; i < filteredReports.length; i++) {
      lines.push("")
      lines.push(formatReport(filteredReports[i]))
      if (i < filteredReports.length - 1) {
        lines.push("")
        lines.push("---")
      }
    }
  } else if (reports.length > 0 && trimmedArgs) {
    lines.push("")
    lines.push(`### Recent Plan Metrics`)
    lines.push("")
    lines.push(`No reports found matching "${trimmedArgs}".`)
  }

  // Aggregate session stats
  if (summaries.length > 0) {
    lines.push("")
    lines.push("---")
    lines.push("")
    lines.push("### Aggregate Session Stats")
    lines.push("")

    const totalTokens = aggregateSessionTokens(summaries)
    const avgDuration = summaries.reduce((sum, s) => sum + s.durationMs, 0) / summaries.length
    const tools = topTools(summaries)

    lines.push(`- **Sessions tracked**: ${summaries.length}`)
    lines.push(`- **Total input tokens**: ${formatNumber(totalTokens.input)}`)
    lines.push(`- **Total output tokens**: ${formatNumber(totalTokens.output)}`)
    lines.push(`- **Average session duration**: ${formatDuration(avgDuration)}`)

    if (tools.length > 0) {
      const toolStr = tools.map((t) => `${t.tool} (${formatNumber(t.count)})`).join(", ")
      lines.push(`- **Top tools**: ${toolStr}`)
    }
  }

  return lines.join("\n")
}
