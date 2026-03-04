import { readFileSync, existsSync } from "fs"
import { resolve, isAbsolute, normalize } from "path"

/**
 * Load a prompt from a file path. Supports .md and .txt files.
 * Paths are sandboxed to basePath (or cwd) — traversal outside is rejected.
 *
 * @param promptFilePath - Path to the prompt file (relative to basePath; absolute paths are rejected)
 * @param basePath - Base directory for resolving relative paths (defaults to cwd)
 * @returns The file contents as a string, or null if the file doesn't exist or path escapes the sandbox
 */
export function loadPromptFile(promptFilePath: string, basePath?: string): string | null {
  // Reject absolute paths — prompt files must be relative to the project
  if (isAbsolute(promptFilePath)) {
    return null
  }

  const base = resolve(basePath ?? process.cwd())
  const resolvedPath = normalize(resolve(base, promptFilePath))

  // Ensure the resolved path stays within the base directory (prevent traversal)
  if (!resolvedPath.startsWith(base + "/") && resolvedPath !== base) {
    return null
  }

  if (!existsSync(resolvedPath)) {
    return null
  }

  return readFileSync(resolvedPath, "utf-8").trim()
}
