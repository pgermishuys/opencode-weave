export type SkillScope = "builtin" | "user" | "project"

export interface SkillMetadata {
  name?: string
  description?: string
  model?: string
  tools?: string | string[]
}

export interface LoadedSkill {
  name: string
  description: string
  content: string
  scope?: SkillScope
  path?: string
  model?: string
}

export interface SkillDiscoveryResult {
  skills: LoadedSkill[]
}
