import type { WorkState } from "../work-state/types"
import type { MetricsReport } from "./types"
import { extractPlannedFiles } from "./plan-parser"
import { getChangedFiles } from "./git-diff"
import { calculateAdherence } from "./adherence"
import { aggregateTokensForPlan } from "./plan-token-aggregator"
import { writeMetricsReport, readSessionSummaries } from "./storage"
import { getPlanName } from "../work-state/storage"
import { log } from "../../shared/log"

/**
 * Generate a Phase 1 metrics report for a completed plan.
 *
 * Orchestrates:
 * 1. Extract planned files from the plan markdown
 * 2. Get actual changed files via git diff (startSha..HEAD)
 * 3. Calculate adherence (coverage, precision)
 * 4. Aggregate token usage across all sessions for this plan
 * 5. Compute total duration from session summaries
 * 6. Write the report to metrics-reports.jsonl
 *
 * In Phase 1, `quality` and `gaps` are undefined.
 * Returns the report if successful, null on error.
 */
export function generateMetricsReport(
  directory: string,
  state: WorkState,
): MetricsReport | null {
  try {
    // 1. Extract planned files
    const plannedFiles = extractPlannedFiles(state.active_plan)

    // 2. Get actual changed files (requires start_sha)
    const actualFiles = state.start_sha
      ? getChangedFiles(directory, state.start_sha)
      : []

    // 3. Calculate adherence
    const adherence = calculateAdherence(plannedFiles, actualFiles)

    // 4. Aggregate token usage
    const tokenUsage = aggregateTokensForPlan(directory, state.session_ids)

    // 5. Compute duration from session summaries
    const summaries = readSessionSummaries(directory)
    const matchingSummaries = summaries.filter((s) =>
      state.session_ids.includes(s.sessionId),
    )
    const durationMs = matchingSummaries.reduce(
      (sum, s) => sum + s.durationMs,
      0,
    )

    // 6. Build the report
    const report: MetricsReport = {
      planName: getPlanName(state.active_plan),
      generatedAt: new Date().toISOString(),
      adherence,
      quality: undefined,
      gaps: undefined,
      tokenUsage,
      durationMs,
      sessionCount: state.session_ids.length,
      startSha: state.start_sha,
      sessionIds: [...state.session_ids],
    }

    // 7. Write to storage
    const written = writeMetricsReport(directory, report)
    if (!written) {
      log("[analytics] Failed to write metrics report (non-fatal)")
      return null
    }

    log("[analytics] Metrics report generated", {
      plan: report.planName,
      coverage: adherence.coverage,
      precision: adherence.precision,
    })

    return report
  } catch (err) {
    log("[analytics] Failed to generate metrics report (non-fatal)", {
      error: String(err),
    })
    return null
  }
}
