import { describe, it, expect, afterEach } from "bun:test"
import { parseFrontmatter, scanDirectory } from "./discovery"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("parseFrontmatter", () => {
  it("parses name, description and model from valid frontmatter", () => {
    const text = `---
name: git-master
description: MUST USE for ANY git operations
model: claude-opus-4
---
# Git Master

Instructions here.`

    const result = parseFrontmatter(text)

    expect(result.metadata.name).toBe("git-master")
    expect(result.metadata.description).toBe("MUST USE for ANY git operations")
    expect(result.metadata.model).toBe("claude-opus-4")
    expect(result.content).toContain("# Git Master")
    expect(result.content).toContain("Instructions here.")
  })

  it("returns full text as content and empty metadata when no frontmatter", () => {
    const text = "# Just a markdown file\n\nNo frontmatter here."

    const result = parseFrontmatter(text)

    expect(result.metadata).toEqual({})
    expect(result.content).toBe(text)
  })

  it("parses inline array tools: [a, b] to array", () => {
    const text = `---
name: my-skill
description: A skill
tools: [bash, read, write]
---
Content here.`

    const result = parseFrontmatter(text)

    expect(result.metadata.tools).toEqual(["bash", "read", "write"])
  })

  it("parses block list for tools correctly", () => {
    const text = `---
name: playwright
description: Browser automation
tools:
  - bash
  - read
---
Playwright instructions.`

    const result = parseFrontmatter(text)

    expect(result.metadata.name).toBe("playwright")
    expect(result.metadata.tools).toEqual(["bash", "read"])
  })

  it("returns empty metadata for malformed frontmatter — graceful degradation", () => {
    // Missing closing ---
    const text = `---
name: broken-skill
Content without closing delimiter`

    const result = parseFrontmatter(text)

    expect(result.metadata).toEqual({})
    expect(result.content).toBe(text)
  })
})

describe("scanDirectory", () => {
  let tmpDir: string | null = null

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it("returns empty array for non-existent directory", () => {
    const result = scanDirectory({
      directory: path.join(os.tmpdir(), "weave-test-nonexistent-" + Date.now()),
      scope: "project",
    })

    expect(result).toEqual([])
  })

  it("discovers SKILL.md in root of directory", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-scan-root-"))

    fs.writeFileSync(
      path.join(tmpDir, "SKILL.md"),
      `---
name: root-skill
description: A root-level skill
---
Root skill content.`,
    )

    const results = scanDirectory({ directory: tmpDir, scope: "project" })

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe("root-skill")
    expect(results[0].scope).toBe("project")
    expect(results[0].content).toContain("Root skill content.")
  })

  it("discovers SKILL.md inside subdirectory", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-scan-sub-"))

    const skillDir = path.join(tmpDir, "my-skill")
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: A test skill
---
Skill content here.`,
    )

    const results = scanDirectory({ directory: tmpDir, scope: "user" })

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe("my-skill")
    expect(results[0].scope).toBe("user")
    expect(results[0].content).toContain("Skill content here.")
  })

  it("skips SKILL.md files missing a name in frontmatter", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weave-scan-noname-"))

    fs.writeFileSync(
      path.join(tmpDir, "SKILL.md"),
      `---
description: No name here
---
Content.`,
    )

    const results = scanDirectory({ directory: tmpDir, scope: "user" })

    expect(results).toHaveLength(0)
  })
})
