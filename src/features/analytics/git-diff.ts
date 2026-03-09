import { execFileSync } from "child_process"

const SHA_PATTERN = /^[0-9a-f]{4,40}$/i

/**
 * Get the list of files changed between a given SHA and HEAD.
 *
 * Uses `git diff --name-only fromSha..HEAD` and returns relative paths.
 * Returns an empty array on any error (non-git repo, invalid SHA, etc.).
 */
export function getChangedFiles(directory: string, fromSha: string): string[] {
  if (!SHA_PATTERN.test(fromSha)) {
    return []
  }

  try {
    const output = execFileSync("git", ["diff", "--name-only", `${fromSha}..HEAD`], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}
