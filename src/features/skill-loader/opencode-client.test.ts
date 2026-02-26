import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { fetchSkillsFromOpenCode } from "./opencode-client"

const mockFetch = mock(async (_url: string) => ({
  ok: true,
  status: 200,
  json: async () => [] as unknown[],
}))

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  mockFetch.mockClear()
})

describe("fetchSkillsFromOpenCode", () => {
  it("returns empty array on fetch error", async () => {
    mockFetch.mockImplementationOnce(async () => { throw new Error("connection refused") })
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/some/dir")
    expect(result).toEqual([])
  })

  it("returns empty array when endpoint returns non-OK status", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 404,
      json: async () => null,
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/some/dir")
    expect(result).toEqual([])
  })

  it("returns empty array when response is not an array", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: "not an array" }),
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/some/dir")
    expect(result).toEqual([])
  })

  it("maps OpenCode skills to LoadedSkill array", async () => {
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
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/project")
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      name: "git-master",
      description: "Git expertise",
      content: "You are a git expert.",
      scope: "user",
      path: "/home/user/.config/opencode/skills/git-master",
    })
    expect(result[1]).toMatchObject({
      name: "playwright",
      description: "Browser testing",
      content: "Use Playwright for browser tests.",
      scope: "project",
      path: "/project/.opencode/skills/playwright",
    })
  })

  it("skips skills with no name", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { name: "", description: "no name", location: "/some/path", content: "stuff" },
        { name: "valid-skill", description: "valid", location: "/path", content: "content" },
      ],
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/dir")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("valid-skill")
  })

  it("derives project scope from location containing .opencode", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          name: "project-skill",
          description: "proj",
          location: "/workspace/.opencode/skills/project-skill",
          content: "content",
        },
      ],
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/workspace")
    expect(result[0].scope).toBe("project")
  })

  it("derives user scope from location not containing .opencode", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          name: "user-skill",
          description: "user",
          location: "/home/user/.config/opencode/skills/user-skill",
          content: "content",
        },
      ],
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/workspace")
    expect(result[0].scope).toBe("user")
  })

  it("builds the correct URL with encoded directory", async () => {
    let capturedUrl = ""
    mockFetch.mockImplementationOnce(async (url: string) => {
      capturedUrl = url
      return { ok: true, status: 200, json: async () => [] }
    })
    await fetchSkillsFromOpenCode("http://localhost:5678", "/my/project dir")
    expect(capturedUrl).toBe("http://localhost:5678/skill?directory=%2Fmy%2Fproject%20dir")
  })

  it("handles trailing slash in serverUrl", async () => {
    let capturedUrl = ""
    mockFetch.mockImplementationOnce(async (url: string) => {
      capturedUrl = url
      return { ok: true, status: 200, json: async () => [] }
    })
    await fetchSkillsFromOpenCode("http://localhost:5678/", "/dir")
    expect(capturedUrl).toBe("http://localhost:5678/skill?directory=%2Fdir")
  })

  it("returns empty array on invalid JSON", async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token") },
    }))
    const result = await fetchSkillsFromOpenCode("http://localhost:1234", "/dir")
    expect(result).toEqual([])
  })
})
