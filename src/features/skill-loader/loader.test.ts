import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import type { LoadedSkill } from "./types"

// Mock discovery module before importing loader
import * as discovery from "./discovery"
const scanDirectorySpy = spyOn(discovery, "scanDirectory")

import { loadSkills } from "./loader"

const SERVER_URL = "http://localhost:1234"
const DIRECTORY = "/some/project"

const mockFetch = mock(async (_url: string) => ({
  ok: true,
  status: 200,
  json: async () => [] as unknown[],
}))

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch
  scanDirectorySpy.mockReturnValue([])
})

afterEach(() => {
  mockFetch.mockClear()
  scanDirectorySpy.mockClear()
})

describe("loadSkills", () => {
  it("returns empty skills array when both API and filesystem return no skills", async () => {
    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(0)
  })

  it("returns skills from the OpenCode API response", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          name: "git-master",
          description: "Git expertise",
          location: "/home/user/.config/opencode/skills/git-master",
          content: "You are a git expert.",
        },
        {
          name: "playwright",
          description: "Browser testing",
          location: "/project/.opencode/skills/playwright",
          content: "Use Playwright for browser tests.",
        },
      ],
    }))
    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(2)
    expect(result.skills.find((s) => s.name === "git-master")).toBeDefined()
    expect(result.skills.find((s) => s.name === "playwright")).toBeDefined()
  })

  it("filters out disabled skills", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: "skill-a", description: "A", location: "/path/skill-a", content: "Content A" },
        { name: "skill-b", description: "B", location: "/path/skill-b", content: "Content B" },
        { name: "skill-c", description: "C", location: "/path/skill-c", content: "Content C" },
      ],
    }))
    const result = await loadSkills({
      serverUrl: SERVER_URL,
      directory: DIRECTORY,
      disabledSkills: ["skill-b"],
    })
    expect(result.skills.find((s) => s.name === "skill-a")).toBeDefined()
    expect(result.skills.find((s) => s.name === "skill-b")).toBeUndefined()
    expect(result.skills.find((s) => s.name === "skill-c")).toBeDefined()
  })

  it("returns empty array on fetch error", async () => {
    mockFetch.mockImplementationOnce(async () => { throw new Error("connection refused") })
    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(0)
  })

  it("returns empty array when endpoint returns non-OK status", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 404,
      json: async () => null,
    }))
    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(0)
  })

  it("defaults directory to process.cwd() when not provided", async () => {
    let capturedUrl = ""
    mockFetch.mockImplementationOnce(async (url: string) => {
      capturedUrl = url
      return { ok: true, status: 200, json: async () => [] }
    })
    await loadSkills({ serverUrl: SERVER_URL })
    expect(capturedUrl).toContain(encodeURIComponent(process.cwd()))
  })

  it("returns SkillDiscoveryResult with skills array", async () => {
    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(typeof result).toBe("object")
    expect(result !== null).toBe(true)
    expect(Array.isArray(result.skills)).toBe(true)
  })

  // --- Filesystem fallback tests ---

  it("scans both user and project skill directories", async () => {
    await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(scanDirectorySpy).toHaveBeenCalledTimes(2)
    // First call: user-level
    const userCall = scanDirectorySpy.mock.calls[0][0] as { directory: string; scope: string }
    expect(userCall.directory).toContain(".config/opencode/skills")
    expect(userCall.scope).toBe("user")
    // Second call: project-level
    const projectCall = scanDirectorySpy.mock.calls[1][0] as { directory: string; scope: string }
    expect(projectCall.directory).toContain(".opencode")
    expect(projectCall.scope).toBe("project")
  })

  it("returns filesystem skills when API returns nothing", async () => {
    const fsSkill: LoadedSkill = {
      name: "build-verification",
      description: "Enforce build verification",
      content: "Run builds before shipping.",
      scope: "user",
      path: "/home/user/.config/opencode/skills/build-verification/SKILL.md",
    }
    // Both scans return the same skill — mergeSkillSources deduplicates by name
    scanDirectorySpy.mockReturnValue([fsSkill])

    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(1) // deduplicated: same name from both scans
    expect(result.skills.find((s) => s.name === "build-verification")).toBeDefined()
  })

  it("returns filesystem skills when API errors", async () => {
    mockFetch.mockImplementationOnce(async () => { throw new Error("connection refused") })
    const fsSkill: LoadedSkill = {
      name: "build-verification",
      description: "Enforce build verification",
      content: "Run builds before shipping.",
      scope: "user",
      path: "/home/user/.config/opencode/skills/build-verification/SKILL.md",
    }
    // Only return for user scope, empty for project
    scanDirectorySpy.mockImplementation((opts: { directory: string; scope: string }) => {
      if (opts.scope === "user") return [fsSkill]
      return []
    })

    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].name).toBe("build-verification")
  })

  it("API skills take precedence over filesystem skills with same name", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: "shared-skill", description: "From API", location: "/api/path", content: "API content" },
      ],
    }))
    const fsSkill: LoadedSkill = {
      name: "shared-skill",
      description: "From filesystem",
      content: "FS content",
      scope: "user",
      path: "/fs/path",
    }
    scanDirectorySpy.mockImplementation((opts: { directory: string; scope: string }) => {
      if (opts.scope === "user") return [fsSkill]
      return []
    })

    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].description).toBe("From API")
    expect(result.skills[0].content).toBe("API content")
  })

  it("merges unique skills from both API and filesystem", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: "api-skill", description: "API only", location: "/api/path", content: "API content" },
      ],
    }))
    const fsSkill: LoadedSkill = {
      name: "fs-skill",
      description: "FS only",
      content: "FS content",
      scope: "user",
      path: "/fs/path",
    }
    scanDirectorySpy.mockImplementation((opts: { directory: string; scope: string }) => {
      if (opts.scope === "user") return [fsSkill]
      return []
    })

    const result = await loadSkills({ serverUrl: SERVER_URL, directory: DIRECTORY })
    expect(result.skills).toHaveLength(2)
    expect(result.skills.find((s) => s.name === "api-skill")).toBeDefined()
    expect(result.skills.find((s) => s.name === "fs-skill")).toBeDefined()
  })

  it("filters disabled skills from merged results", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: "api-skill", description: "API", location: "/api/path", content: "API content" },
      ],
    }))
    const fsSkill: LoadedSkill = {
      name: "fs-skill",
      description: "FS",
      content: "FS content",
      scope: "user",
      path: "/fs/path",
    }
    scanDirectorySpy.mockImplementation((opts: { directory: string; scope: string }) => {
      if (opts.scope === "user") return [fsSkill]
      return []
    })

    const result = await loadSkills({
      serverUrl: SERVER_URL,
      directory: DIRECTORY,
      disabledSkills: ["fs-skill"],
    })
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].name).toBe("api-skill")
  })
})
