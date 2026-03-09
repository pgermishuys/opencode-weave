export type {
  ToolUsageEntry,
  DelegationEntry,
  SessionSummary,
  TokenUsage,
  DetectedStack,
  ProjectFingerprint,
  Suggestion,
  InFlightToolCall,
  TrackedSession,
} from "./types"
export { ANALYTICS_DIR, SESSION_SUMMARIES_FILE, FINGERPRINT_FILE } from "./types"

export {
  ensureAnalyticsDir,
  appendSessionSummary,
  readSessionSummaries,
  writeFingerprint,
  readFingerprint,
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

export { generateSuggestions, getSuggestionsForProject } from "./suggestions"

import { createSessionTracker } from "./session-tracker"
import { getOrCreateFingerprint } from "./fingerprint"
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
 * Instantiates the session tracker and optionally generates/loads the project fingerprint.
 * If a fingerprint is provided, it is reused; otherwise one is generated.
 * This is the single entry point called from the plugin's main init.
 */
export function createAnalytics(directory: string, fingerprint?: ProjectFingerprint | null): Analytics {
  const tracker = createSessionTracker(directory)
  const resolvedFingerprint = fingerprint ?? getOrCreateFingerprint(directory)
  return { tracker, fingerprint: resolvedFingerprint }
}
