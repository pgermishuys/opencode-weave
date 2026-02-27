import { log } from "../../shared/log"
import type { LoadedSkill, SkillScope } from "./types"

interface OpenCodeSkill {
  name: string
  description: string
  location: string
  content: string
}

function deriveScope(location: string): SkillScope {
  if (location.includes(".opencode")) return "project"
  return "user"
}

export async function fetchSkillsFromOpenCode(
  serverUrl: string | URL,
  directory: string,
): Promise<LoadedSkill[]> {
  const base = serverUrl.toString().replace(/\/$/, "")
  const url = `${base}/skill?directory=${encodeURIComponent(directory)}`
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  } catch (err) {
    log("Failed to fetch skills from OpenCode — skills will not be loaded", { url, error: String(err) })
    return []
  }
  if (!response.ok) {
    log("OpenCode /skill endpoint returned non-OK status — skills will not be loaded", {
      url,
      status: response.status,
    })
    return []
  }
  let data: unknown
  try {
    data = await response.json()
  } catch (err) {
    log("Failed to parse skills response from OpenCode", { url, error: String(err) })
    return []
  }
  if (!Array.isArray(data)) {
    log("Unexpected skills response shape from OpenCode — expected array", { url })
    return []
  }
  const skills: LoadedSkill[] = []
  for (const item of data as OpenCodeSkill[]) {
    if (!item.name) continue
    skills.push({
      name: item.name,
      description: item.description ?? "",
      content: item.content ?? "",
      scope: deriveScope(item.location ?? ""),
      path: item.location,
    })
  }
  return skills
}
