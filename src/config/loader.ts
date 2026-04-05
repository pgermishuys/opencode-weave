import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { parse } from "jsonc-parser"
import type { ZodIssue } from "zod"
import { WeaveConfigSchema, type WeaveConfig } from "./schema"
import type { DeepPartial } from "../shared/types"
import { mergeConfigs } from "./merge"
import { warn, error as logError, debug } from "../shared/log"

// ── Diagnostics ────────────────────────────────────────────────────

export interface ConfigDiagnostic {
  level: "warn" | "error"
  section: string
  message: string
  /** Individual field-level issues within the section */
  fields?: Array<{ path: string; message: string }>
}

export interface ConfigLoadResult {
  config: WeaveConfig
  /** Config files that were found and loaded (may be empty) */
  loadedFiles: string[]
  /** Validation diagnostics — empty when config is fully valid */
  diagnostics: ConfigDiagnostic[]
}

/**
 * Module-level store for the most recent config load result.
 * Read by /weave-health to surface diagnostics in the TUI.
 */
let lastLoadResult: ConfigLoadResult | null = null

/** Retrieve the most recent config load result (for /weave-health command). */
export function getLastConfigLoadResult(): ConfigLoadResult | null {
  return lastLoadResult
}

function readJsoncFile(filePath: string): DeepPartial<WeaveConfig> {
  try {
    const text = readFileSync(filePath, "utf-8")
    const errors: { error: number; offset: number; length: number }[] = []
    const parsed = parse(text, errors) as DeepPartial<WeaveConfig> | null
    if (errors.length > 0) {
      warn(`JSONC parse warnings in ${filePath}: ${errors.length} issue(s)`)
    }
    return parsed ?? {}
  } catch (e) {
    logError(`Failed to read config file ${filePath}`, e)
    return {}
  }
}

function detectConfigFile(basePath: string): string | null {
  const jsoncPath = basePath + ".jsonc"
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = basePath + ".json"
  if (existsSync(jsonPath)) return jsonPath
  return null
}

export function loadWeaveConfig(
  directory: string,
  _ctx?: unknown,
  _homeDir?: string,
): WeaveConfig {
  const userBasePath = join(_homeDir ?? homedir(), ".config", "opencode", "weave-opencode")
  const projectBasePath = join(directory, ".opencode", "weave-opencode")

  const userConfigPath = detectConfigFile(userBasePath)
  const projectConfigPath = detectConfigFile(projectBasePath)

  debug("Loading Weave config", {
    userConfig: userConfigPath ?? "(none)",
    projectConfig: projectConfigPath ?? "(none)",
  })

  const loadedFiles: string[] = []
  if (userConfigPath) loadedFiles.push(userConfigPath)
  if (projectConfigPath) loadedFiles.push(projectConfigPath)

  const userRaw: DeepPartial<WeaveConfig> = userConfigPath
    ? readJsoncFile(userConfigPath)
    : {}

  const projectRaw: DeepPartial<WeaveConfig> = projectConfigPath
    ? readJsoncFile(projectConfigPath)
    : {}

  const merged = mergeConfigs(userRaw, projectRaw)

  const result = WeaveConfigSchema.safeParse(merged)
  if (!result.success) {
    // Progressive recovery: strip failing top-level sections rather than
    // nuking the entire config.  This prevents an invalid custom_agents
    // entry from wiping out valid builtin agent overrides (see #30).
    const recovery = recoverValidSections(merged, result.error.issues)
    if (recovery) {
      lastLoadResult = { config: recovery.config, loadedFiles, diagnostics: recovery.diagnostics }
      return recovery.config
    }

    // Unrecoverable — fall back to empty defaults
    const diagnostics: ConfigDiagnostic[] = [{
      level: "error",
      section: "(root)",
      message: "Config validation failed entirely — using defaults",
      fields: result.error.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    }]
    logError(
      "WeaveConfig validation errors — using defaults. Fix the issues below and restart.",
      result.error.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    )
    const fallback = WeaveConfigSchema.parse({})
    lastLoadResult = { config: fallback, loadedFiles, diagnostics }
    return fallback
  }

  debug("Weave config loaded successfully", {
    hasAgentOverrides: !!result.data.agents && Object.keys(result.data.agents).length > 0,
    disabledAgents: result.data.disabled_agents ?? [],
    customAgents: result.data.custom_agents ? Object.keys(result.data.custom_agents) : [],
    logLevel: result.data.log_level ?? "(default)",
    analyticsEnabled: result.data.analytics?.enabled ?? false,
  })

  lastLoadResult = { config: result.data, loadedFiles, diagnostics: [] }
  return result.data
}

/**
 * Attempt to recover a valid config by stripping top-level sections that
 * contain validation errors.  This avoids the "nuclear option" where a
 * single invalid field (e.g. a typo inside custom_agents) causes the
 * entire config — including valid builtin agent overrides — to be replaced
 * with empty defaults.
 *
 * Returns the recovered config and diagnostics, or null if recovery failed.
 */
function recoverValidSections(
  merged: DeepPartial<WeaveConfig>,
  issues: ZodIssue[],
): { config: WeaveConfig; diagnostics: ConfigDiagnostic[] } | null {
  // Identify unique top-level keys that have validation errors.
  // Each ZodIssue.path starts with the top-level config key.
  const failingKeys = new Set<string>()
  for (const issue of issues) {
    if (issue.path.length > 0) {
      failingKeys.add(String(issue.path[0]))
    }
  }

  if (failingKeys.size === 0) return null

  // Build diagnostics and log each failing section with its specific
  // validation errors so the user knows exactly what to fix.
  const diagnostics: ConfigDiagnostic[] = []
  for (const key of failingKeys) {
    const sectionIssues = issues.filter(
      (i) => i.path.length > 0 && String(i.path[0]) === key,
    )
    const fields = sectionIssues.map((i) => ({
      path: i.path.slice(1).join("."),
      message: i.message,
    }))
    const details = fields.map((f) =>
      f.path ? `  → ${f.path}: ${f.message}` : `  → ${f.message}`,
    )
    diagnostics.push({
      level: "warn",
      section: key,
      message: `Section "${key}" was dropped due to validation errors`,
      fields,
    })
    warn(
      `Config section "${key}" has validation errors and was dropped:\n${details.join("\n")}\n  Remaining config sections are preserved. Fix the errors above and restart.`,
    )
  }

  // Strip the failing sections from a shallow copy of the merged config
  const stripped = { ...merged } as Record<string, unknown>
  for (const key of failingKeys) {
    delete stripped[key]
  }

  const retry = WeaveConfigSchema.safeParse(stripped)
  if (retry.success) {
    debug("Config recovery succeeded", {
      droppedSections: [...failingKeys],
      hasAgentOverrides: !!retry.data.agents && Object.keys(retry.data.agents).length > 0,
      customAgents: retry.data.custom_agents ? Object.keys(retry.data.custom_agents) : [],
    })
    return { config: retry.data, diagnostics }
  }

  // Recovery failed — caller will fall back to empty defaults
  return null
}
