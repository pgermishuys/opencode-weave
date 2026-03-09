import { readFileSync } from "fs"

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

/**
 * Extract and clean a file path from a raw **Files** value fragment.
 * Returns null if the fragment looks like prose rather than a path.
 *
 * Adapted from validation.ts extractFilePath — duplicated here to avoid
 * coupling analytics to the work-state validation internals.
 */
function extractFilePath(raw: string): string | null {
  let cleaned = raw
    .replace(/^\s*(create|modify|new:|add)\s+/i, "")
    .replace(/\(new\)/gi, "")
    .trim()

  const firstToken = cleaned.split(/\s+/)[0]
  if (
    firstToken &&
    (firstToken.includes("/") ||
      firstToken.endsWith(".ts") ||
      firstToken.endsWith(".js") ||
      firstToken.endsWith(".json") ||
      firstToken.endsWith(".md"))
  ) {
    cleaned = firstToken
  } else if (!cleaned.includes("/")) {
    return null
  }

  return cleaned || null
}

/**
 * Extract all planned file paths from a plan's `## TODOs` section.
 *
 * Parses `**Files**:` lines, splits on commas, strips `(new)` / `Create` prefixes,
 * deduplicates, and returns normalized relative paths.
 */
export function extractPlannedFiles(planPath: string): string[] {
  let content: string
  try {
    content = readFileSync(planPath, "utf-8")
  } catch {
    return []
  }

  const todosSection = extractSection(content, "## TODOs")
  if (todosSection === null) return []

  const files = new Set<string>()
  const lines = todosSection.split("\n")

  for (const line of lines) {
    const filesMatch = /^\s*\*\*Files\*\*:?\s*(.+)$/.exec(line)
    if (!filesMatch) continue

    const rawValue = filesMatch[1].trim()
    const parts = rawValue.split(",")

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      const filePath = extractFilePath(trimmed)
      if (filePath) {
        files.add(filePath)
      }
    }
  }

  return Array.from(files)
}
