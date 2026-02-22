/**
 * The 6 validation categories checked by validatePlan().
 */
export type ValidationCategory =
  | "structure"
  | "checkboxes"
  | "file-references"
  | "numbering"
  | "effort-estimate"
  | "verification"

/** Severity level for a validation issue. */
export type ValidationSeverity = "error" | "warning"

/**
 * A single validation issue found in a plan file.
 */
export interface ValidationIssue {
  severity: ValidationSeverity
  category: ValidationCategory
  message: string
}

/**
 * The result of validating a plan file.
 * `valid` is false if there are any blocking errors.
 */
export interface ValidationResult {
  /** False when there is at least one error (blocking). True when only warnings or clean. */
  valid: boolean
  /** Blocking issues — prevent /start-work from proceeding */
  errors: ValidationIssue[]
  /** Non-blocking issues — surfaced to user but don't block execution */
  warnings: ValidationIssue[]
}
