import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadWeaveConfig } from "./loader"

function createTmpDir(): string {
  const dir = join(tmpdir(), `weave-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("loadWeaveConfig", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTmpDir()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("returns valid default config when no config files exist", () => {
    const config = loadWeaveConfig(testDir, undefined, testDir) // override home → no user config
    expect(config).toBeDefined()
    expect(typeof config).toBe("object")
    // All optional fields should be undefined or default
    expect(config.agents).toBeUndefined()
    expect(config.disabled_hooks).toBeUndefined()
  })

  it("loads project config from .opencode/weave-opencode.json", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({ agents: { loom: { model: "claude-opus-4" } } }),
    )
    const config = loadWeaveConfig(testDir)
    expect(config.agents?.loom?.model).toBe("claude-opus-4")
  })

  it("loads project config from .opencode/weave-opencode.jsonc (prefers .jsonc over .json)", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    // Both exist — .jsonc should win
    writeFileSync(
      join(opencodeDir, "weave-opencode.jsonc"),
      `{ // weave config\n"agents": { "loom": { "model": "claude-sonnet-4" } } }`,
    )
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({ agents: { loom: { model: "wrong-model" } } }),
    )
    const config = loadWeaveConfig(testDir)
    expect(config.agents?.loom?.model).toBe("claude-sonnet-4")
  })

  it("parses JSONC with comments without error", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    const jsoncContent = `{
      // This is a comment
      "disabled_hooks": ["context-window-monitor"], // trailing comment
      /* block comment */
      "tmux": { "enabled": true }
    }`
    writeFileSync(join(opencodeDir, "weave-opencode.jsonc"), jsoncContent)
    const config = loadWeaveConfig(testDir)
    expect(config.disabled_hooks).toContain("context-window-monitor")
    expect(config.tmux?.enabled).toBe(true)
  })

  it("returns defaults when config file has invalid content", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    // Invalid Zod content — temperature out of range
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({ agents: { loom: { temperature: 99 } } }),
    )
    // Should not throw — should log and return defaults
    const config = loadWeaveConfig(testDir)
    expect(config).toBeDefined()
  })

  it("handles missing .opencode directory gracefully", () => {
    // testDir exists but no .opencode inside
    expect(() => loadWeaveConfig(testDir)).not.toThrow()
    const config = loadWeaveConfig(testDir)
    expect(config).toBeDefined()
  })
})
