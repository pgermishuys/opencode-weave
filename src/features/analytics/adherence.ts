import type { AdherenceReport } from "./types"

/**
 * Normalize a file path for comparison: lowercase, trim, strip leading `./`.
 */
function normalizePath(p: string): string {
  return p.trim().toLowerCase().replace(/^\.\//, "")
}

/**
 * Calculate plan adherence by comparing planned vs actual file changes.
 *
 * - **coverage**: fraction of planned files that were actually changed (0-1).
 *   If no files were planned, coverage = 1 (vacuously complete).
 * - **precision**: fraction of actual changes that were planned (0-1).
 *   If no files were changed, precision = 1 (vacuously precise).
 */
export function calculateAdherence(
  plannedFiles: string[],
  actualFiles: string[],
): AdherenceReport {
  const plannedNorm = new Set(plannedFiles.map(normalizePath))
  const actualNorm = new Set(actualFiles.map(normalizePath))

  const plannedFilesChanged: string[] = []
  const missedFiles: string[] = []
  const unplannedChanges: string[] = []

  // Check planned files against actual
  for (const planned of plannedFiles) {
    if (actualNorm.has(normalizePath(planned))) {
      plannedFilesChanged.push(planned)
    } else {
      missedFiles.push(planned)
    }
  }

  // Check actual files against planned
  for (const actual of actualFiles) {
    if (!plannedNorm.has(normalizePath(actual))) {
      unplannedChanges.push(actual)
    }
  }

  const totalPlannedFiles = plannedFiles.length
  const totalActualFiles = actualFiles.length

  // Vacuous truth: if nothing was planned, coverage is 1
  const coverage = totalPlannedFiles === 0 ? 1 : plannedFilesChanged.length / totalPlannedFiles
  // Vacuous truth: if nothing changed, precision is 1
  const precision = totalActualFiles === 0 ? 1 : plannedFilesChanged.length / totalActualFiles

  return {
    coverage,
    precision,
    plannedFilesChanged,
    unplannedChanges,
    missedFiles,
    totalPlannedFiles,
    totalActualFiles,
  }
}
