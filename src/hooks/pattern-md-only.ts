/**
 * Guard hook that prevents Pattern agent from writing non-.md files
 * or writing outside the .weave/ directory.
 */

export interface PatternWriteCheckResult {
  allowed: boolean
  reason?: string
}

const WRITE_TOOLS = new Set(["write", "edit"])
const WEAVE_DIR_SEGMENT = ".weave"

/**
 * Check whether a write/edit operation should be allowed for the given agent.
 * Only blocks writes from the "pattern" agent to non-.md files or files outside .weave/.
 */
export function checkPatternWrite(
  agentName: string,
  toolName: string,
  filePath: string,
): PatternWriteCheckResult {
  // Only guard Pattern agent
  if (agentName !== "pattern") {
    return { allowed: true }
  }

  // Only guard write/edit tools
  if (!WRITE_TOOLS.has(toolName)) {
    return { allowed: true }
  }

  // Normalize path separators for cross-platform
  const normalizedPath = filePath.replace(/\\/g, "/")

  // Must be inside .weave/ directory
  if (!normalizedPath.includes(`${WEAVE_DIR_SEGMENT}/`)) {
    return {
      allowed: false,
      reason: `Pattern agent can only write to .weave/ directory. Attempted: ${filePath}`,
    }
  }

  // Must be a .md file
  if (!normalizedPath.endsWith(".md")) {
    return {
      allowed: false,
      reason: `Pattern agent can only write .md files. Attempted: ${filePath}`,
    }
  }

  return { allowed: true }
}
