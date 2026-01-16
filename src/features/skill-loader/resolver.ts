import type { SkillDiscoveryResult } from "./types"

export function resolveSkill(name: string, result: SkillDiscoveryResult): string {
  return result.skills.find((s) => s.name === name)?.content ?? ""
}

export function resolveMultipleSkills(
  skillNames: string[],
  disabledSkills?: Set<string>,
  discovered?: SkillDiscoveryResult,
): string {
  if (!discovered) return ""

  const parts: string[] = []
  for (const name of skillNames) {
    if (disabledSkills?.has(name)) continue
    const content = resolveSkill(name, discovered)
    if (content) { parts.push(content) }
  }
  return parts.join("\n\n")
}

export function createSkillResolver(
  discovered: SkillDiscoveryResult,
): (skillNames: string[], disabledSkills?: Set<string>) => string {
  return (skillNames: string[], disabledSkills?: Set<string>): string => {
    return resolveMultipleSkills(skillNames, disabledSkills, discovered)
  }
}

/** @deprecated Use createSkillResolver instead */
export const createResolveSkillsFn = createSkillResolver
