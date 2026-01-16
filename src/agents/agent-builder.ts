import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentSource } from "./types"
import type { CategoriesConfig } from "../config/schema"
import { isFactory } from "./types"

export type ResolveSkillsFn = (skillNames: string[], disabledSkills?: Set<string>) => string

export type BuildAgentOptions = {
  categories?: CategoriesConfig
  disabledSkills?: Set<string>
  resolveSkills?: ResolveSkillsFn
}

type AgentConfigExtended = AgentConfig & {
  category?: string
  skills?: string[]
  variant?: string
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

  return base
}
