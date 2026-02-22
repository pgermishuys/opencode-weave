import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import type { ValidationResult, ValidationIssue } from "./validation-types"
import { PLANS_DIR } from "./constants"

/**
 * Validates a plan file's structure and content before /start-work execution.
 *
 * @param planPath  Absolute path to the plan markdown file
 * @param projectDir  Absolute path to the project root (used for file-reference checks)
 * @returns ValidationResult with errors (blocking) and warnings (non-blocking)
 */
export function validatePlan(planPath: string, projectDir: string): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // Guard: planPath must resolve within the project's .weave/plans/ directory
  const resolvedPlanPath = resolve(planPath)
  const allowedDir = resolve(projectDir, PLANS_DIR)
  if (!resolvedPlanPath.startsWith(allowedDir + "/") && resolvedPlanPath !== allowedDir) {
    errors.push({
      severity: "error",
      category: "structure",
      message: `Plan path is outside the allowed directory (${PLANS_DIR}/): ${planPath}`,
    })
    return { valid: false, errors, warnings }
  }

  // Guard: plan file must exist
  if (!existsSync(resolvedPlanPath)) {
    errors.push({
      severity: "error",
      category: "structure",
      message: `Plan file not found: ${planPath}`,
    })
    return { valid: false, errors, warnings }
  }

  const content = readFileSync(resolvedPlanPath, "utf-8")

  // ─── 1. Structure validation ─────────────────────────────────────────────────
  validateStructure(content, errors, warnings)

  // ─── 2. Checkbox validation ──────────────────────────────────────────────────
  validateCheckboxes(content, errors, warnings)

  // ─── 3. File reference validation ───────────────────────────────────────────
  validateFileReferences(content, projectDir, warnings)

  // ─── 4. Numbering validation ─────────────────────────────────────────────────
  validateNumbering(content, errors, warnings)

  // ─── 5. Effort estimate validation ──────────────────────────────────────────
  validateEffortEstimate(content, warnings)

  // ─── 6. Verification section validation ─────────────────────────────────────
  validateVerificationSection(content, errors)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the text content of a top-level H2 section (## Heading).
 * Returns everything from the line after the heading up to (but not including)
 * the next `## ` heading, or end of file.
 */
function extractSection(content: string, heading: string): string | null {
  const lines = content.split("\n")
  let startIdx = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      startIdx = i + 1
      break
    }
  }

  if (startIdx === -1) return null

  const sectionLines: string[] = []
  for (let i = startIdx; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break
    sectionLines.push(lines[i])
  }

  return sectionLines.join("\n")
}

/** Check whether a section heading exists in the content */
function hasSection(content: string, heading: string): boolean {
  return content.split("\n").some((line) => line.trim() === heading)
}

// ─── 1. Structure ─────────────────────────────────────────────────────────────

function validateStructure(
  content: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  // Required sections → errors if missing
  const requiredSections: [string, string][] = [
    ["## TL;DR", "Missing required section: ## TL;DR"],
    ["## TODOs", "Missing required section: ## TODOs"],
    ["## Verification", "Missing required section: ## Verification"],
  ]

  for (const [heading, message] of requiredSections) {
    if (!hasSection(content, heading)) {
      errors.push({ severity: "error", category: "structure", message })
    }
  }

  // Optional sections → warnings if missing
  const optionalSections: [string, string][] = [
    ["## Context", "Missing optional section: ## Context"],
    ["## Objectives", "Missing optional section: ## Objectives"],
  ]

  for (const [heading, message] of optionalSections) {
    if (!hasSection(content, heading)) {
      warnings.push({ severity: "warning", category: "structure", message })
    }
  }
}

// ─── 2. Checkboxes ───────────────────────────────────────────────────────────

function validateCheckboxes(
  content: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const todosSection = extractSection(content, "## TODOs")
  if (todosSection === null) {
    // Already reported as a structural error — skip checkbox analysis
    return
  }

  // Any checkbox (checked or unchecked) in the TODOs section
  const checkboxPattern = /^- \[[ x]\] /m
  if (!checkboxPattern.test(todosSection)) {
    errors.push({
      severity: "error",
      category: "checkboxes",
      message: "## TODOs section contains no checkboxes (- [ ] or - [x])",
    })
    return
  }

  // Find each top-level TODO task line and the lines following it
  // A task line looks like:  - [ ] 1. Title  OR  - [x] 1. Title  OR  - [ ] Title
  const lines = todosSection.split("\n")
  let taskIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^- \[[ x]\] /.test(line)) {
      taskIndex++
      const taskLabel = `Task ${taskIndex}`

      // Collect the body lines (indented or blank) that follow this checkbox
      const bodyLines: string[] = []
      let j = i + 1
      while (j < lines.length && !/^- \[[ x]\] /.test(lines[j])) {
        bodyLines.push(lines[j])
        j++
      }

      const body = bodyLines.join("\n")

      // Check for sub-fields (with or without trailing colon)
      if (!(/\*\*What\*\*/.test(body))) {
        warnings.push({
          severity: "warning",
          category: "checkboxes",
          message: `${taskLabel} is missing **What** sub-field`,
        })
      }
      if (!(/\*\*Files\*\*/.test(body))) {
        warnings.push({
          severity: "warning",
          category: "checkboxes",
          message: `${taskLabel} is missing **Files** sub-field`,
        })
      }
      if (!(/\*\*Acceptance\*\*/.test(body))) {
        warnings.push({
          severity: "warning",
          category: "checkboxes",
          message: `${taskLabel} is missing **Acceptance** sub-field`,
        })
      }
    }
  }
}

// ─── 3. File references ───────────────────────────────────────────────────────

/** Patterns that indicate the file is being created (not required to exist yet) */
const NEW_FILE_INDICATORS = [
  /^\s*create\s+/i,
  /^\s*new:\s*/i,
  /\(new\)/i,
  /^\s*add\s+/i,
]

function isNewFile(rawPath: string): boolean {
  return NEW_FILE_INDICATORS.some((re) => re.test(rawPath))
}

/**
 * Extract and clean a file path from a raw **Files** value fragment.
 * Returns null if the fragment looks like prose rather than a path.
 */
function extractFilePath(raw: string): string | null {
  // Strip common leading verbs and markers
  let cleaned = raw
    .replace(/^\s*(create|modify|new:|add)\s+/i, "")
    .replace(/\(new\)/gi, "")
    .trim()

  // Remove inline descriptions after a space that don't look path-like
  // Keep only the first token if it contains a path separator
  const firstToken = cleaned.split(/\s+/)[0]
  if (firstToken && (firstToken.includes("/") || firstToken.endsWith(".ts") || firstToken.endsWith(".js") || firstToken.endsWith(".json") || firstToken.endsWith(".md"))) {
    cleaned = firstToken
  } else if (!cleaned.includes("/")) {
    // No path separator — not a file path fragment
    return null
  }

  return cleaned || null
}

function validateFileReferences(
  content: string,
  projectDir: string,
  warnings: ValidationIssue[]
): void {
  const todosSection = extractSection(content, "## TODOs")
  if (todosSection === null) return

  const lines = todosSection.split("\n")

  for (const line of lines) {
    // Match **Files**: value OR **Files** value (with or without colon)
    const filesMatch = /^\s*\*\*Files\*\*:?\s*(.+)$/.exec(line)
    if (!filesMatch) continue

    const rawValue = filesMatch[1].trim()
    // Files field may contain comma-separated paths or a single path
    const parts = rawValue.split(",")

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      const newFile = isNewFile(trimmed)
      const filePath = extractFilePath(trimmed)

      if (!filePath) continue
      if (newFile) continue

      // Security: reject absolute paths outright
      if (filePath.startsWith("/")) {
        warnings.push({
          severity: "warning",
          category: "file-references",
          message: `Absolute file path not allowed in plan references: ${filePath}`,
        })
        continue
      }

      // Resolve relative to project root and verify it stays within projectDir
      const resolvedProject = resolve(projectDir)
      const absolutePath = resolve(projectDir, filePath)
      if (!absolutePath.startsWith(resolvedProject + "/") && absolutePath !== resolvedProject) {
        warnings.push({
          severity: "warning",
          category: "file-references",
          message: `File reference escapes project directory (path traversal): ${filePath}`,
        })
        continue
      }

      if (!existsSync(absolutePath)) {
        warnings.push({
          severity: "warning",
          category: "file-references",
          message: `Referenced file does not exist (may be created by an earlier task): ${filePath}`,
        })
      }
    }
  }
}

// ─── 4. Numbering ─────────────────────────────────────────────────────────────

function validateNumbering(
  content: string,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const todosSection = extractSection(content, "## TODOs")
  if (todosSection === null) return

  const numbers: number[] = []
  const seen = new Set<number>()

  for (const line of todosSection.split("\n")) {
    // Match numbered task: - [ ] 1. or - [x] 1.
    const match = /^- \[[ x]\] (\d+)\./.exec(line)
    if (!match) continue

    const n = parseInt(match[1], 10)

    if (seen.has(n)) {
      errors.push({
        severity: "error",
        category: "numbering",
        message: `Duplicate task number: ${n}`,
      })
    } else {
      seen.add(n)
      numbers.push(n)
    }
  }

  if (numbers.length < 2) return // Nothing to sequence-check

  const sorted = [...numbers].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      warnings.push({
        severity: "warning",
        category: "numbering",
        message: `Gap in task numbering: expected ${sorted[i - 1] + 1} but found ${sorted[i]}`,
      })
    }
  }
}

// ─── 5. Effort estimate ───────────────────────────────────────────────────────

const VALID_EFFORT_VALUES = ["quick", "short", "medium", "large", "xl"]

function validateEffortEstimate(content: string, warnings: ValidationIssue[]): void {
  const tldrSection = extractSection(content, "## TL;DR")
  if (tldrSection === null) {
    // Already reported as structural error
    return
  }

  const effortMatch = /\*\*Estimated Effort\*\*:?\s*(.+)/i.exec(tldrSection)
  if (!effortMatch) {
    warnings.push({
      severity: "warning",
      category: "effort-estimate",
      message: 'Missing **Estimated Effort** in ## TL;DR section',
    })
    return
  }

  const value = effortMatch[1].trim().toLowerCase()
  if (!VALID_EFFORT_VALUES.includes(value)) {
    warnings.push({
      severity: "warning",
      category: "effort-estimate",
      message: `Invalid effort estimate value: "${effortMatch[1].trim()}". Expected one of: Quick, Short, Medium, Large, XL`,
    })
  }
}

// ─── 6. Verification section ──────────────────────────────────────────────────

function validateVerificationSection(content: string, errors: ValidationIssue[]): void {
  const verificationSection = extractSection(content, "## Verification")
  if (verificationSection === null) {
    // Already reported as structural error
    return
  }

  const hasCheckbox = /^- \[[ x]\] /m.test(verificationSection)
  if (!hasCheckbox) {
    errors.push({
      severity: "error",
      category: "verification",
      message: "## Verification section contains no checkboxes — at least one verifiable condition is required",
    })
  }
}
