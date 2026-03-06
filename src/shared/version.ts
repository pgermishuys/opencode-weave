import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

let cachedVersion: string | undefined

/**
 * Returns the current Weave package version from package.json.
 * Cached after first read. Falls back to "0.0.0" if reading fails.
 */
export function getWeaveVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url))
    // Try ../../package.json (dev: src/shared/) then ../package.json (dist/)
    for (const rel of ["../../package.json", "../package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(join(thisDir, rel), "utf-8"))
        if (pkg.name === "@opencode_weave/weave" && typeof pkg.version === "string") {
          const version: string = pkg.version
          cachedVersion = version
          return version
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* fallback */
  }
  cachedVersion = "0.0.0"
  return cachedVersion
}
