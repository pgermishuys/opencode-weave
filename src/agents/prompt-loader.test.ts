import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { loadPromptFile } from "./prompt-loader"

const TEST_DIR = join(process.cwd(), ".test-prompt-loader")

describe("loadPromptFile", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("rejects absolute paths", () => {
    const filePath = join(TEST_DIR, "prompt.md")
    writeFileSync(filePath, "You are a helpful assistant.")
    // Absolute paths are rejected for security — must be relative to basePath
    const result = loadPromptFile(filePath)
    expect(result).toBeNull()
  })

  it("loads a prompt from a relative path with basePath", () => {
    const filePath = join(TEST_DIR, "agent-prompt.md")
    writeFileSync(filePath, "Custom agent prompt content")
    const result = loadPromptFile("agent-prompt.md", TEST_DIR)
    expect(result).toBe("Custom agent prompt content")
  })

  it("returns null for non-existent file", () => {
    const result = loadPromptFile("does-not-exist.md", TEST_DIR)
    expect(result).toBeNull()
  })

  it("trims whitespace from loaded content", () => {
    const filePath = join(TEST_DIR, "whitespace.md")
    writeFileSync(filePath, "  prompt with whitespace  \n\n")
    const result = loadPromptFile("whitespace.md", TEST_DIR)
    expect(result).toBe("prompt with whitespace")
  })

  it("handles multiline markdown content", () => {
    const filePath = join(TEST_DIR, "multi.md")
    const content = "<Role>\nYou are a code reviewer.\n</Role>\n\n<Rules>\nBe thorough.\n</Rules>"
    writeFileSync(filePath, content)
    const result = loadPromptFile("multi.md", TEST_DIR)
    expect(result).toBe(content)
  })

  // Path traversal security tests
  it("rejects path traversal via ../", () => {
    const result = loadPromptFile("../../../etc/passwd", TEST_DIR)
    expect(result).toBeNull()
  })

  it("rejects path traversal via nested ../", () => {
    const result = loadPromptFile("subdir/../../.ssh/id_rsa", TEST_DIR)
    expect(result).toBeNull()
  })

  it("allows subdirectory paths within basePath", () => {
    const subDir = join(TEST_DIR, "prompts")
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, "agent.md"), "Sub-dir prompt.")
    const result = loadPromptFile("prompts/agent.md", TEST_DIR)
    expect(result).toBe("Sub-dir prompt.")
  })

  it("rejects path that resolves outside basePath despite starting relative", () => {
    // Even if the path looks relative, if it escapes the base dir it's rejected
    const result = loadPromptFile("./../outside.md", TEST_DIR)
    expect(result).toBeNull()
  })
})
