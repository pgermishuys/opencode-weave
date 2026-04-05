import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadWeaveConfig } from "./loader"

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "weave-loader-test-"))
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

  // Regression tests for issue #30:
  // Invalid custom_agents should NOT nuke valid builtin agent overrides.

  it("preserves valid agent overrides when custom_agents has validation errors (#30)", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        agents: { loom: { model: "my-custom-model" } },
        custom_agents: {
          "my-agent": { mode: "INVALID_MODE_VALUE" },
        },
      }),
    )
    const config = loadWeaveConfig(testDir)
    // The valid agents section should be preserved (not reset to defaults)
    expect(config.agents?.loom?.model).toBe("my-custom-model")
    // The invalid custom_agents section should be dropped
    expect(config.custom_agents).toBeUndefined()
  })

  it("preserves disabled_agents when custom_agents is invalid (#30)", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        disabled_agents: ["warp"],
        custom_agents: {
          "bad-agent": { category: "NOT_A_VALID_CATEGORY" },
        },
      }),
    )
    const config = loadWeaveConfig(testDir)
    expect(config.disabled_agents).toContain("warp")
    expect(config.custom_agents).toBeUndefined()
  })

  it("loads valid custom_agents normally when they pass validation", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        agents: { loom: { model: "my-model" } },
        custom_agents: {
          "my-reviewer": {
            prompt: "You are a code reviewer.",
            model: "test-model/v1",
            mode: "subagent",
            description: "Code review agent",
          },
        },
      }),
    )
    const config = loadWeaveConfig(testDir)
    // Both sections should be preserved
    expect(config.agents?.loom?.model).toBe("my-model")
    expect(config.custom_agents?.["my-reviewer"]).toBeDefined()
    expect(config.custom_agents?.["my-reviewer"]?.prompt).toBe("You are a code reviewer.")
    expect(config.custom_agents?.["my-reviewer"]?.mode).toBe("subagent")
  })

  it("strips only the failing section when multiple sections exist (#30)", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        agents: { loom: { model: "preserved-model" } },
        disabled_hooks: ["context-window-monitor"],
        tmux: { enabled: true },
        custom_agents: {
          "broken": { cost: "SUPER_EXPENSIVE" },
        },
      }),
    )
    const config = loadWeaveConfig(testDir)
    // All valid sections should be preserved
    expect(config.agents?.loom?.model).toBe("preserved-model")
    expect(config.disabled_hooks).toContain("context-window-monitor")
    expect(config.tmux?.enabled).toBe(true)
    // Only custom_agents should be dropped
    expect(config.custom_agents).toBeUndefined()
  })

  it("logs actionable error details when custom_agents validation fails (#30)", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        custom_agents: {
          "my-agent": { mode: "INVALID_MODE" },
        },
      }),
    )

    // Capture console.error output (warn() uses console.error before client is set)
    const logged: string[] = []
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "))
    })

    loadWeaveConfig(testDir)

    spy.mockRestore()

    // The warning should contain the section name, the field path, and the Zod message
    const combined = logged.join("\n")
    expect(combined).toContain("custom_agents")
    expect(combined).toContain("my-agent.mode")
    // Zod enum errors describe the valid options
    expect(combined).toMatch(/Invalid option|Invalid enum value|expected one of/i)
  })

  it("handles missing .opencode directory gracefully", () => {
    // testDir exists but no .opencode inside
    expect(() => loadWeaveConfig(testDir)).not.toThrow()
    const config = loadWeaveConfig(testDir)
    expect(config).toBeDefined()
  })
})
