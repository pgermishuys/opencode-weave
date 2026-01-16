import { describe, it, expect, afterEach } from 'bun:test'
import { loadSkills } from './loader'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('loadSkills', () => {
  let tmpDir: string | null = null

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('returns without throwing when directory does not exist', () => {
    const nonExistentDir = path.join(os.tmpdir(), 'weave-nonexistent-' + Date.now())
    expect(() => { loadSkills({ directory: nonExistentDir }) }).not.toThrow()
  })

  it('returns empty skills array when directory has no project skills', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-loader-empty-'))
    const result = loadSkills({ directory: tmpDir })
    const projectSkills = result.skills.filter((s) => s.scope === 'project')
    expect(projectSkills).toHaveLength(0)
  })

  it('loads skills from project directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-loader-'))
    const skillsDir = path.join(tmpDir, '.opencode', 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })
    const skillDir = path.join(skillsDir, 'test-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\n---\nTest skill content.',
    )
    const result = loadSkills({ directory: tmpDir })
    const found = result.skills.find((s) => s.name === 'test-skill')
    expect(found).toBeDefined()
    expect(found?.name).toBe('test-skill')
    expect(found?.scope).toBe('project')
  })

  it('filters out disabled skills', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-loader-disabled-'))
    const skillsDir = path.join(tmpDir, '.opencode', 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })
    for (const name of ['skill-a', 'skill-b', 'skill-c']) {
      const skillDir = path.join(skillsDir, name)
      fs.mkdirSync(skillDir)
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: ' + name + '\ndescription: Skill ' + name + '\n---\nContent.',
      )
    }
    const result = loadSkills({ directory: tmpDir, disabledSkills: ['skill-b'] })
    expect(result.skills.find((s) => s.name === 'skill-a')).toBeDefined()
    expect(result.skills.find((s) => s.name === 'skill-b')).toBeUndefined()
    expect(result.skills.find((s) => s.name === 'skill-c')).toBeDefined()
  })

  it('works without options', () => {
    expect(() => loadSkills()).not.toThrow()
  })
})

describe('mergeSkills integration (via loadSkills)', () => {
  let tmpDir: string | null = null

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('returns SkillDiscoveryResult with skills array', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-loader-merge-'))
    const result = loadSkills({ directory: tmpDir })
    expect(typeof result).toBe('object')
    expect(result !== null).toBe(true)
    expect(Array.isArray(result.skills)).toBe(true)
  })
})