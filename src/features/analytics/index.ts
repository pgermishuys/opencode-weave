export type {
  ToolUsageEntry,
  DelegationEntry,
  SessionSummary,
  TokenUsage,
  MetricsTokenUsage,
  AdherenceReport,
  MetricsReport,
  QualityReport,
  SessionTokenBreakdown,
  DetectedStack,
  ProjectFingerprint,

  InFlightToolCall,
  TrackedSession,
} from "./types"
export {
  ANALYTICS_DIR,
  SESSION_SUMMARIES_FILE,
  FINGERPRINT_FILE,
  METRICS_REPORTS_FILE,
  MAX_METRICS_ENTRIES,
  zeroTokenUsage,
} from "./types"

export {
  ensureAnalyticsDir,
  appendSessionSummary,
  readSessionSummaries,
  writeFingerprint,
  readFingerprint,
  writeMetricsReport,
  readMetricsReports,
} from "./storage"

export {
  detectStack,
  detectPackageManager,
  detectMonorepo,
  detectPrimaryLanguage,
  generateFingerprint,
  fingerprintProject,
  getOrCreateFingerprint,
} from "./fingerprint"

export { SessionTracker, createSessionTracker } from "./session-tracker"


export { generateTokenReport, getTokenReport } from "./token-report"

export { formatMetricsMarkdown } from "./format-metrics"

export { generateMetricsReport } from "./generate-metrics-report"

export { extractPlannedFiles } from "./plan-parser"

export { getChangedFiles } from "./git-diff"

export { calculateAdherence } from "./adherence"

export { aggregateTokensForPlan, aggregateTokensDetailed } from "./plan-token-aggregator"
export type { DetailedTokenAggregation } from "./plan-token-aggregator"

export { calculateQualityScore, BASELINE_TOKENS_PER_TASK } from "./quality-score"

import { createSessionTracker } from "./session-tracker"
import type { SessionTracker } from "./session-tracker"
import type { ProjectFingerprint } from "./types"

/** Return value of createAnalytics — bundles tracker + fingerprint */
export interface Analytics {
  /** Session tracker instance — wire into tool.execute.before/after */
  tracker: SessionTracker
  /** Project fingerprint (may be null if detection fails) */
  fingerprint: ProjectFingerprint | null
}

/**
 * Create all analytics services for a project.
 * Instantiates the session tracker and uses the provided fingerprint (if any).
 * Fingerprint generation is the caller's responsibility — pass null to opt out.
 * This is the single entry point called from the plugin's main init.
 */
export function createAnalytics(directory: string, fingerprint: ProjectFingerprint | null): Analytics {
  const tracker = createSessionTracker(directory)
  return { tracker, fingerprint }
}
