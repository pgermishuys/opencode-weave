import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentSource } from "./types"
import type { CategoriesConfig } from "../config/schema"
import { isFactory } from "./types"

export type ResolveSkillsFn = (skillNames: string[], disabledSkills?: Set<string>) => string

export type BuildAgentOptions = {
  categories?: CategoriesConfig
  disabledSkills?: Set<string>
  resolveSkills?: ResolveSkillsFn
  disabledAgents?: Set<string>
}

type AgentConfigExtended = AgentConfig & {
  category?: string
  skills?: string[]
  variant?: string
}

/**
 * Map from agent config key (lowercase) to display name variants that
 * might appear in prompt text. Used by stripDisabledAgentReferences to
 * remove lines that mention disabled agents.
 *
 * Exported for test cleanup — tests that call addBuiltinNameVariant
 * must restore original arrays in afterEach to avoid state pollution.
 */
export const AGENT_NAME_VARIANTS: Record<string, string[]> = {
  thread: ["thread", "Thread"],
  spindle: ["spindle", "Spindle"],
  weft: ["weft", "Weft"],
  warp: ["warp", "Warp"],
  pattern: ["pattern", "Pattern"],
  shuttle: ["shuttle", "Shuttle"],
  loom: ["loom", "Loom"],
  tapestry: ["tapestry", "Tapestry"],
}

/**
 * Register name variants for a custom agent so that
 * `stripDisabledAgentReferences` can strip its references from prompts.
 * Does not override existing (builtin) entries.
 */
export function registerAgentNameVariants(name: string, variants?: string[]): void {
  if (AGENT_NAME_VARIANTS[name]) return // don't override builtins
  const titleCase = name.charAt(0).toUpperCase() + name.slice(1)
  AGENT_NAME_VARIANTS[name] = variants ?? [name, titleCase]
}

/**
 * Add additional name variants for a builtin agent.
 * Used when a user sets a custom display_name — the custom name
 * must be included in variants so stripDisabledAgentReferences
 * can match it when the agent is disabled.
 * No-op if the config key has no existing variant entry or the variant is already present.
 */
export function addBuiltinNameVariant(configKey: string, variant: string): void {
  const existing = AGENT_NAME_VARIANTS[configKey]
  if (existing && !existing.includes(variant)) {
    existing.push(variant)
  }
}

/**
 * Remove lines from a prompt that reference disabled agents.
 * Only strips lines where an agent name appears as a standalone concept
 * (e.g. "Use thread (codebase explorer)"), not incidental word matches.
 * Uses word-boundary matching to avoid false positives.
 */
export function stripDisabledAgentReferences(prompt: string, disabled: Set<string>): string {
  if (disabled.size === 0) return prompt

  // Build a set of all name variants to look for
  const disabledVariants: string[] = []
  for (const name of disabled) {
    const variants = AGENT_NAME_VARIANTS[name]
    if (variants) {
      disabledVariants.push(...variants)
    }
  }
  if (disabledVariants.length === 0) return prompt

  // Build a regex that matches any line containing a disabled agent name.
  // Uses (?<!\w) and (?!\w) instead of \b to support Unicode/CJK display names
  // while still avoiding false positives like "pattern" matching "patterns".
  const pattern = new RegExp(
    `(?<!\\w)(${disabledVariants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?!\\w)`,
  )

  const lines = prompt.split("\n")
  const filtered = lines.filter((line) => !pattern.test(line))
  return filtered.join("\n")
}

export function buildAgent(source: AgentSource, model: string, options?: BuildAgentOptions): AgentConfig {
  const base: AgentConfigExtended = isFactory(source) ? source(model) : { ...source }

  if (base.category && options?.categories) {
    const categoryConfig = options.categories[base.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
      if (base.variant === undefined && categoryConfig.variant !== undefined) {
        base.variant = categoryConfig.variant
      }
    }
  }

  if (base.skills?.length && options?.resolveSkills) {
    const skillContent = options.resolveSkills(base.skills, options.disabledSkills)
    if (skillContent) {
      base.prompt = skillContent + (base.prompt ? "\n\n" + base.prompt : "")
    }
  }

  // Strip references to disabled agents from the prompt
  if (options?.disabledAgents && options.disabledAgents.size > 0 && base.prompt) {
    base.prompt = stripDisabledAgentReferences(base.prompt, options.disabledAgents)
  }

  return base
}
