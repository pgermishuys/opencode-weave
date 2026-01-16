export type SkillScope = "builtin" | "user" | "project"

export interface SkillMetadata {
  name?: string
  description?: string
  model?: string
  tools?: string | string[]
  mcp?: {
    name: string
    type: "stdio" | "http"
    command?: string
    args?: string[]
    url?: string
  }
}

export interface LoadedSkill {
  name: string
  description: string
  content: string
  scope: SkillScope
  path?: string
  model?: string
}

export interface SkillDiscoveryResult {
  skills: LoadedSkill[]
}
