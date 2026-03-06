import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { arch } from "os"
import type { ProjectFingerprint, DetectedStack } from "./types"
import { writeFingerprint, readFingerprint } from "./storage"
import { log } from "../../shared/log"
import { getWeaveVersion } from "../../shared/version"

/** Marker files that indicate specific technologies */
const STACK_MARKERS: Array<{
  name: string
  files: string[]
  confidence: "high" | "medium"
  evidence: (found: string) => string
}> = [
  {
    name: "typescript",
    files: ["tsconfig.json", "tsconfig.build.json"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "bun",
    files: ["bun.lockb", "bunfig.toml"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "node",
    files: ["package.json"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "npm",
    files: ["package-lock.json"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "yarn",
    files: ["yarn.lock"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "pnpm",
    files: ["pnpm-lock.yaml"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "react",
    // Detection handled specially below via package.json dependency parsing
    files: [],
    confidence: "medium",
    evidence: () => "react in package.json dependencies",
  },
  {
    name: "next",
    files: ["next.config.js", "next.config.ts", "next.config.mjs"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "python",
    files: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "go",
    files: ["go.mod"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "rust",
    files: ["Cargo.toml"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "dotnet",
    files: ["global.json", "Directory.Build.props", "Directory.Packages.props"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
  {
    name: "docker",
    files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],
    confidence: "high",
    evidence: (f) => `${f} exists`,
  },
]

/** Monorepo indicator files/dirs */
const MONOREPO_MARKERS = [
  "lerna.json",
  "nx.json",
  "turbo.json",
  "pnpm-workspace.yaml",
  "rush.json",
]

/**
 * Detect the technology stack of a project by scanning for marker files.
 * This is a fast, synchronous scan — suitable for fire-and-forget use.
 */
export function detectStack(directory: string): DetectedStack[] {
  const detected: DetectedStack[] = []

  for (const marker of STACK_MARKERS) {
    // Check marker files
    for (const file of marker.files) {
      if (existsSync(join(directory, file))) {
        detected.push({
          name: marker.name,
          confidence: marker.confidence,
          evidence: marker.evidence(file),
        })
        break // one match is enough per stack entry
      }
    }
  }

  // Check for React in package.json dependencies
  try {
    const pkgPath = join(directory, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps.react) {
        detected.push({
          name: "react",
          confidence: "medium",
          evidence: "react in package.json dependencies",
        })
      }
    }
  } catch {
    // ignore parse errors
  }

  // Check for .NET projects by scanning for .csproj/.fsproj/.sln files
  if (!detected.some((d) => d.name === "dotnet")) {
    try {
      const entries = readdirSync(directory)
      const dotnetFile = entries.find(
        (e) => e.endsWith(".csproj") || e.endsWith(".fsproj") || e.endsWith(".sln"),
      )
      if (dotnetFile) {
        detected.push({
          name: "dotnet",
          confidence: "high",
          evidence: `${dotnetFile} found`,
        })
      }
    } catch {
      // ignore read errors
    }
  }

  // Deduplicate by name (keep first — highest confidence match wins)
  const seen = new Set<string>()
  return detected.filter((entry) => {
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })
}

/**
 * Detect the package manager used by the project.
 */
export function detectPackageManager(directory: string): string | undefined {
  if (existsSync(join(directory, "bun.lockb"))) return "bun"
  if (existsSync(join(directory, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(directory, "yarn.lock"))) return "yarn"
  if (existsSync(join(directory, "package-lock.json"))) return "npm"
  if (existsSync(join(directory, "package.json"))) return "npm" // fallback
  return undefined
}

/**
 * Detect whether the project is a monorepo.
 */
export function detectMonorepo(directory: string): boolean {
  for (const marker of MONOREPO_MARKERS) {
    if (existsSync(join(directory, marker))) return true
  }
  // Check package.json for workspaces field
  try {
    const pkgPath = join(directory, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.workspaces) return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * Detect the primary language of the project.
 */
export function detectPrimaryLanguage(stack: DetectedStack[]): string | undefined {
  const languages = ["typescript", "python", "go", "rust", "dotnet"]
  for (const lang of languages) {
    if (stack.some((s) => s.name === lang)) return lang
  }
  // Fallback: if node is detected but not typescript, it's javascript
  if (stack.some((s) => s.name === "node")) return "javascript"
  return undefined
}

/**
 * Generate a complete project fingerprint.
 */
export function generateFingerprint(directory: string): ProjectFingerprint {
  const stack = detectStack(directory)
  return {
    generatedAt: new Date().toISOString(),
    stack,
    isMonorepo: detectMonorepo(directory),
    packageManager: detectPackageManager(directory),
    primaryLanguage: detectPrimaryLanguage(stack),
    os: process.platform,
    arch: arch(),
    weaveVersion: getWeaveVersion(),
  }
}

/**
 * Generate and persist a project fingerprint.
 * Fire-and-forget: errors are logged but never thrown.
 */
export function fingerprintProject(directory: string): ProjectFingerprint | null {
  try {
    const fingerprint = generateFingerprint(directory)
    writeFingerprint(directory, fingerprint)
    log("[analytics] Project fingerprinted", {
      stack: fingerprint.stack.map((s) => s.name),
      primaryLanguage: fingerprint.primaryLanguage,
      packageManager: fingerprint.packageManager,
    })
    return fingerprint
  } catch (err) {
    log("[analytics] Fingerprinting failed (non-fatal)", { error: String(err) })
    return null
  }
}

/**
 * Get the cached fingerprint, or generate a new one if missing or stale.
 * Regenerates if the cached fingerprint was generated by a different Weave version.
 * Fire-and-forget: errors are logged but never thrown.
 */
export function getOrCreateFingerprint(directory: string): ProjectFingerprint | null {
  try {
    const existing = readFingerprint(directory)
    if (existing) {
      const currentVersion = getWeaveVersion()
      if (existing.weaveVersion === currentVersion) {
        return existing
      }
      log("[analytics] Fingerprint version mismatch — regenerating", {
        cached: existing.weaveVersion ?? "none",
        current: currentVersion,
      })
    }
    return fingerprintProject(directory)
  } catch (err) {
    log("[analytics] getOrCreateFingerprint failed (non-fatal)", { error: String(err) })
    return null
  }
}
