import * as fs from "fs"
import * as path from "path"
import { log } from "../shared/log"

const RULES_FILENAMES = ["AGENTS.md", ".rules", "CLAUDE.md"]

export function findRulesFile(directory: string): string | undefined {
  for (const filename of RULES_FILENAMES) {
    const candidate = path.join(directory, filename)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

export function loadRulesForDirectory(directory: string): string | undefined {
  const rulesFile = findRulesFile(directory)
  if (!rulesFile) return undefined
  try {
    const content = fs.readFileSync(rulesFile, "utf8")
    log(`[rules-injector] Loaded rules from ${rulesFile}`)
    return content
  } catch {
    log(`[rules-injector] Failed to read rules file: ${rulesFile}`)
    return undefined
  }
}

export function shouldInjectRules(toolName: string): boolean {
  return toolName === "read" || toolName === "write" || toolName === "edit"
}

export function getDirectoryFromFilePath(filePath: string): string {
  return path.dirname(path.resolve(filePath))
}

export function buildRulesInjection(rulesContent: string, directory: string): string {
  return `<rules source="${directory}">\n${rulesContent}\n</rules>`
}

export function getRulesForFile(filePath: string): string | undefined {
  const dir = getDirectoryFromFilePath(filePath)
  const content = loadRulesForDirectory(dir)
  if (!content) return undefined
  return buildRulesInjection(content, dir)
}
