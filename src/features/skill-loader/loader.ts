import * as path from 'path'
import * as os from 'os'
import type { LoadedSkill, SkillDiscoveryResult } from './types'
import { scanDirectory } from './discovery'
import { mergeSkills } from './merger'
import { createBuiltinSkills } from './builtin-skills'

export interface LoadSkillsOptions {
  directory?: string
  disabledSkills?: string[]
}

export function loadSkills(options: LoadSkillsOptions = {}): SkillDiscoveryResult {
  const { directory, disabledSkills = [] } = options
  const projectDir = path.join(directory ?? process.cwd(), '.opencode', 'skills')
  const userDir = path.join(os.homedir(), '.config', 'opencode', 'weave-opencode', 'skills')
  const projectSkills = scanDirectory({ directory: projectDir, scope: 'project' })
  const userSkills = scanDirectory({ directory: userDir, scope: 'user' })
  const builtinSkills = createBuiltinSkills()
  const all: LoadedSkill[] = [...projectSkills, ...userSkills, ...builtinSkills]
  const merged = mergeSkills(all)
  if (disabledSkills.length === 0) return { skills: merged }
  const disabledSet = new Set(disabledSkills)
  return { skills: merged.filter((s) => !disabledSet.has(s.name)) }
}