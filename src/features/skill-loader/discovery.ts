import * as fs from "fs"
import * as path from "path"
import { log } from "../../shared/log"
import type { LoadedSkill, SkillMetadata, SkillScope } from "./types"

interface ParsedFrontmatter {
  metadata: SkillMetadata
  content: string
}

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = frontmatterRegex.exec(text)
  if (!match) {
    return { metadata: {}, content: text }
  }
  const yamlBlock = match[1]
  const body = match[2]
  const metadata: SkillMetadata = {}
  try {
    const lines = yamlBlock.split(/\r?\n/)
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const keyValueMatch = /^(\w[\w-]*):\s*(.*)$/.exec(line)
      if (!keyValueMatch) { i++; continue }
      const key = keyValueMatch[1]
      const rawValue = keyValueMatch[2].trim()
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        const items = rawValue.slice(1, -1).split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter((s) => s.length > 0)
        setMetadataField(metadata, key, items); i++; continue
      }
      if (rawValue === "") {
        const listItems: string[] = []; i++
        while (i < lines.length && /^\s+-\s+(.+)$/.test(lines[i])) {
          const itemMatch = /^\s+-\s+(.+)$/.exec(lines[i])
          if (itemMatch) { listItems.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, "")) }
          i++
        }
        if (listItems.length > 0) { setMetadataField(metadata, key, listItems) }
        continue
      }
      setMetadataField(metadata, key, rawValue.replace(/^['"]|['"]$/g, "")); i++
    }
  } catch (err) {
    log("Failed to parse YAML frontmatter", { error: String(err) })
    return { metadata: {}, content: text }
  }
  return { metadata, content: body }
}

function setMetadataField(metadata: SkillMetadata, key: string, value: string | string[]): void {
  switch (key) {
    case "name": if (typeof value === "string") metadata.name = value; break
    case "description": if (typeof value === "string") metadata.description = value; break
    case "model": if (typeof value === "string") metadata.model = value; break
    case "tools": metadata.tools = value; break
    default: break
  }
}

export interface ScanDirectoryOptions {
  directory: string
  scope: SkillScope
}

export function scanDirectory(options: ScanDirectoryOptions): LoadedSkill[] {
  const { directory, scope } = options
  if (!fs.existsSync(directory)) { return [] }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (err) {
    log("Failed to read skills directory", { directory, error: String(err) }); return []
  }
  const skills: LoadedSkill[] = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const skillFile = path.join(fullPath, "SKILL.md")
      if (fs.existsSync(skillFile)) {
        const skill = loadSkillFile(skillFile, scope)
        if (skill) skills.push(skill)
      }
      continue
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      const skill = loadSkillFile(fullPath, scope)
      if (skill) skills.push(skill)
    }
  }
  return skills
}

function loadSkillFile(filePath: string, scope: SkillScope): LoadedSkill | null {
  let text: string
  try {
    text = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    log("Failed to read skill file", { filePath, error: String(err) }); return null
  }
  const { metadata, content } = parseFrontmatter(text)
  if (!metadata.name) {
    log("Skill file missing name in frontmatter — skipping", { filePath }); return null
  }
  return { name: metadata.name, description: metadata.description ?? "", content, scope, path: filePath, model: metadata.model }
}
