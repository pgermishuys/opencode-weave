import type { LoadedSkill, SkillScope } from './types'

const SCOPE_PRIORITY: Record<SkillScope, number> = { project: 3, user: 2, builtin: 1 }

export function mergeSkills(skills: LoadedSkill[]): LoadedSkill[] {
  const skillMap = new Map<string, LoadedSkill>()
  for (const skill of skills) {
    const existing = skillMap.get(skill.name)
    if (!existing || (SCOPE_PRIORITY[skill.scope] ?? 0) > (SCOPE_PRIORITY[existing.scope] ?? 0)) {
      skillMap.set(skill.name, skill)
    }
  }
  return Array.from(skillMap.values())
}