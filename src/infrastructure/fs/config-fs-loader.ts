import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import type { ZodIssue } from "zod"
import { resolveContinuationConfig } from "../../config/continuation"
import { mergeConfigs } from "../../config/merge"
import { WeaveConfigSchema, type WeaveConfig } from "../../config/schema"
import { debug, error as logError, warn } from "../../shared/log"
import type { DeepPartial } from "../../shared/types"

/** Directory containing the user-level weave-opencode.json[c]; replaces ~/.config/opencode when set. */
export const USER_CONFIG_DIR_ENV = "WEAVE_OPENCODE_CONFIG_DIR"

export interface ConfigDiagnostic {
  level: "warn" | "error"
  section: string
  message: string
  fields?: Array<{ path: string; message: string }>
}

export interface ConfigLoadResult {
  config: WeaveConfig
  loadedFiles: string[]
  diagnostics: ConfigDiagnostic[]
}

export interface ConfigLoader {
  loadWeaveConfig(directory: string, ctx?: unknown, homeDir?: string): WeaveConfig
  getLastConfigLoadResult(): ConfigLoadResult | null
}

export function createConfigFsLoader(): ConfigLoader {
  let lastLoadResult: ConfigLoadResult | null = null

  function getLastConfigLoadResult(): ConfigLoadResult | null {
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
    } catch (error) {
      logError(`Failed to read config file ${filePath}`, error)
      return {}
    }
  }

  function detectConfigFile(basePath: string): string | null {
    const jsoncPath = `${basePath}.jsonc`
    if (existsSync(jsoncPath)) {
      return jsoncPath
    }
    const jsonPath = `${basePath}.json`
    if (existsSync(jsonPath)) {
      return jsonPath
    }
    return null
  }

  function recoverValidSections(
    merged: DeepPartial<WeaveConfig>,
    issues: ZodIssue[],
  ): { config: WeaveConfig; diagnostics: ConfigDiagnostic[] } | null {
    const failingKeys = new Set<string>()
    for (const issue of issues) {
      if (issue.path.length > 0) {
        failingKeys.add(String(issue.path[0]))
      }
    }

    if (failingKeys.size === 0) {
      return null
    }

    const diagnostics: ConfigDiagnostic[] = []
    for (const key of failingKeys) {
      const sectionIssues = issues.filter((issue) => issue.path.length > 0 && String(issue.path[0]) === key)
      const fields = sectionIssues.map((issue) => ({
        path: issue.path.slice(1).join("."),
        message: issue.message,
      }))
      const details = fields.map((field) => (field.path ? `  → ${field.path}: ${field.message}` : `  → ${field.message}`))

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

    return null
  }

  function resolveUserBasePath(homeDir?: string): string {
    // An explicit homeDir (tests) wins; otherwise a host can relocate the user layer via env.
    const overrideDir = homeDir === undefined ? process.env[USER_CONFIG_DIR_ENV]?.trim() : undefined
    if (overrideDir) {
      return join(overrideDir, "weave-opencode")
    }
    return join(homeDir ?? homedir(), ".config", "opencode", "weave-opencode")
  }

  function loadWeaveConfig(directory: string, _ctx?: unknown, homeDir?: string): WeaveConfig {
    const userBasePath = resolveUserBasePath(homeDir)
    const projectBasePath = join(directory, ".opencode", "weave-opencode")

    const userConfigPath = detectConfigFile(userBasePath)
    const projectConfigPath = detectConfigFile(projectBasePath)

    debug("Loading Weave config", {
      userConfig: userConfigPath ?? "(none)",
      projectConfig: projectConfigPath ?? "(none)",
    })

    const loadedFiles: string[] = []
    if (userConfigPath) {
      loadedFiles.push(userConfigPath)
    }
    if (projectConfigPath) {
      loadedFiles.push(projectConfigPath)
    }

    const merged = mergeConfigs(
      userConfigPath ? readJsoncFile(userConfigPath) : {},
      projectConfigPath ? readJsoncFile(projectConfigPath) : {},
    )

    const result = WeaveConfigSchema.safeParse(merged)
    if (!result.success) {
      const recovery = recoverValidSections(merged, result.error.issues)
      if (recovery) {
        lastLoadResult = { config: recovery.config, loadedFiles, diagnostics: recovery.diagnostics }
        return recovery.config
      }

      const diagnostics: ConfigDiagnostic[] = [{
        level: "error",
        section: "(root)",
        message: "Config validation failed entirely — using defaults",
        fields: result.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      }]
      logError(
        "WeaveConfig validation errors — using defaults. Fix the issues below and restart.",
        result.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
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
      continuation: resolveContinuationConfig(result.data.continuation),
    })

    lastLoadResult = { config: result.data, loadedFiles, diagnostics: [] }
    return result.data
  }

  return {
    loadWeaveConfig,
    getLastConfigLoadResult,
  }
}
