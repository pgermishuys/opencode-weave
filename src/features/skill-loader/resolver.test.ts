import { describe, it, expect } from 'bun:test'
import { resolveSkill, resolveMultipleSkills, createSkillResolver } from './resolver'
import type { LoadedSkill, SkillDiscoveryResult } from './types'

function makeSkill(name: string, content: string, scope: LoadedSkill['scope'] = 'builtin'): LoadedSkill {
  return { name, description: 'Desc ' + name, content, scope }
}

function makeResult(...skills: LoadedSkill[]): SkillDiscoveryResult {
  return { skills }
}

describe('resolveSkill', () => {
  it('returns empty string for empty result', () => {
    expect(resolveSkill('git-master', makeResult())).toBe('')
  })

  it('finds a skill by name and returns its content', () => {
    const result = makeResult(makeSkill('git-master', 'Git instructions'))
    expect(resolveSkill('git-master', result)).toBe('Git instructions')
  })

  it('returns empty string for unknown skill name', () => {
    expect(resolveSkill('playwright', makeResult(makeSkill('git-master', 'content')))).toBe('')
  })
})

describe('resolveMultipleSkills', () => {
  it('returns empty string for empty skill names', () => {
    expect(resolveMultipleSkills([], undefined, makeResult(makeSkill('git-master', 'Git content')))).toBe('')
  })

  it('returns empty string when no skills match', () => {
    expect(resolveMultipleSkills(['playwright'], undefined, makeResult(makeSkill('git-master', 'content')))).toBe('')
  })

  it('concatenates multiple skill contents with double newline', () => {
    const result = makeResult(makeSkill('skill-a', 'Content A'), makeSkill('skill-b', 'Content B'), makeSkill('skill-c', 'Content C'))
    expect(resolveMultipleSkills(['skill-a', 'skill-c'], undefined, result)).toBe('Content A\n\nContent C')
  })

  it('skips disabled skills', () => {
    const result = makeResult(makeSkill('skill-a', 'Content A'), makeSkill('skill-b', 'Content B'))
    expect(resolveMultipleSkills(['skill-a', 'skill-b'], new Set(['skill-b']), result)).toBe('Content A')
  })

  it('skips skills not found in result', () => {
    const result = makeResult(makeSkill('existing-skill', 'Existing content'))
    expect(resolveMultipleSkills(['existing-skill', 'missing-skill'], undefined, result)).toBe('Existing content')
  })

  it('returns single skill content without extra newlines', () => {
    expect(resolveMultipleSkills(['solo'], undefined, makeResult(makeSkill('solo', 'Solo content')))).toBe('Solo content')
  })
})

describe('createSkillResolver', () => {
  it('creates a function and resolves skills', () => {
    const result = makeResult(makeSkill('git-master', 'Git content'), makeSkill('playwright', 'Playwright content'))
    const fn = createSkillResolver(result)
    expect(typeof fn).toBe('function')
    expect(fn(['git-master'])).toBe('Git content')
  })

  it('respects disabledSkills parameter', () => {
    const result = makeResult(makeSkill('git-master', 'Git content'), makeSkill('playwright', 'Playwright content'))
    const fn = createSkillResolver(result)
    expect(fn(['git-master', 'playwright'], new Set(['playwright']))).toBe('Git content')
  })

  it('returns empty string when all requested skills are disabled', () => {
    const fn = createSkillResolver(makeResult(makeSkill('git-master', 'Git content')))
    expect(fn(['git-master'], new Set(['git-master']))).toBe('')
  })
})