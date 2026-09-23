import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { getLastConfigLoadResult, loadWeaveConfig } from "./loader"
import { resolveContinuationConfig } from "./continuation"

// Captured by value: the spy below replaces the live `existsSync` binding.
const realExistsSync = fs.existsSync

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
    expect(resolveContinuationConfig(config.continuation)).toEqual({
      recovery: { compaction: true },
      idle: {
        enabled: false,
        work: false,
        workflow: false,
        todo_prompt: false,
      },
    })
  })

  it("resolves partial idle continuation blocks through the parent enabled flag", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        continuation: {
          idle: { enabled: true, workflow: false },
        },
      }),
    )

    const config = loadWeaveConfig(testDir)

    expect(resolveContinuationConfig(config.continuation)).toEqual({
      recovery: { compaction: true },
      idle: {
        enabled: true,
        work: true,
        workflow: false,
        todo_prompt: true,
      },
    })
  })

  it("lets explicit idle child overrides beat the parent enabled flag", () => {
    const opencodeDir = join(testDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(
      join(opencodeDir, "weave-opencode.json"),
      JSON.stringify({
        continuation: {
          recovery: { compaction: false },
          idle: { enabled: false, work: true, todo_prompt: true },
        },
      }),
    )

    const config = loadWeaveConfig(testDir)

    expect(resolveContinuationConfig(config.continuation)).toEqual({
      recovery: { compaction: false },
      idle: {
        enabled: false,
        work: true,
        workflow: false,
        todo_prompt: true,
      },
    })
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

describe("loadWeaveConfig with WEAVE_OPENCODE_CONFIG_DIR", () => {
  const ENV = "WEAVE_OPENCODE_CONFIG_DIR"
  const defaultUserConfigDir = join(homedir(), ".config", "opencode")
  let savedEnv: string | undefined
  let projectDir: string
  let overrideDir: string

  beforeEach(() => {
    savedEnv = process.env[ENV]
    projectDir = createTmpDir()
    overrideDir = createTmpDir()
  })

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[ENV]
    } else {
      process.env[ENV] = savedEnv
    }
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(overrideDir, { recursive: true, force: true })
  })

  function writeProjectConfig(content: object): void {
    const opencodeDir = join(projectDir, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(join(opencodeDir, "weave-opencode.json"), JSON.stringify(content))
  }

  function probedPaths(run: () => void): string[] {
    const probed: string[] = []
    const spy = spyOn(fs, "existsSync").mockImplementation(((path: fs.PathLike) => {
      probed.push(String(path))
      return realExistsSync(path)
    }) as typeof fs.existsSync)
    try {
      run()
    } finally {
      spy.mockRestore()
    }
    return probed
  }

  it("reads the user layer from the override directory", () => {
    const userConfigPath = join(overrideDir, "weave-opencode.jsonc")
    writeFileSync(userConfigPath, `{ // host-managed\n "disabled_agents": ["warp"] }`)
    process.env[ENV] = `  ${overrideDir}  `

    const config = loadWeaveConfig(projectDir)

    expect(config.disabled_agents).toEqual(["warp"])
    expect(getLastConfigLoadResult()?.loadedFiles).toEqual([userConfigPath])
  })

  it("leaves the user layer empty when the override directory has no config file", () => {
    process.env[ENV] = overrideDir

    let config: ReturnType<typeof loadWeaveConfig> | undefined
    const probed = probedPaths(() => {
      config = loadWeaveConfig(projectDir)
    })

    expect(config?.disabled_agents).toBeUndefined()
    expect(getLastConfigLoadResult()?.loadedFiles).toEqual([])
    expect(probed).toContain(join(overrideDir, "weave-opencode.jsonc"))
    expect(probed.filter((path) => path.startsWith(defaultUserConfigDir))).toEqual([])
  })

  it("uses the default location when the variable is blank", () => {
    process.env[ENV] = "   "
    writeFileSync(join(overrideDir, "weave-opencode.json"), JSON.stringify({ disabled_agents: ["warp"] }))

    const probed = probedPaths(() => loadWeaveConfig(projectDir))

    expect(probed).toContain(join(defaultUserConfigDir, "weave-opencode.jsonc"))
    expect(probed.filter((path) => path.startsWith(overrideDir))).toEqual([])
  })

  it("lets an explicit homeDir win over the variable", () => {
    writeFileSync(join(overrideDir, "weave-opencode.json"), JSON.stringify({ disabled_agents: ["warp"] }))
    process.env[ENV] = overrideDir

    const config = loadWeaveConfig(projectDir, undefined, projectDir)

    expect(config.disabled_agents).toBeUndefined()
    expect(getLastConfigLoadResult()?.loadedFiles).toEqual([])
  })

  it("still merges the project config on top of the override user config", () => {
    writeFileSync(
      join(overrideDir, "weave-opencode.json"),
      JSON.stringify({ log_level: "INFO", disabled_agents: ["warp"] }),
    )
    writeProjectConfig({ log_level: "DEBUG", disabled_agents: ["pattern"] })
    process.env[ENV] = overrideDir

    const config = loadWeaveConfig(projectDir)

    expect(config.log_level).toBe("DEBUG")
    expect(config.disabled_agents).toEqual(expect.arrayContaining(["warp", "pattern"]))
    expect(getLastConfigLoadResult()?.loadedFiles).toEqual([
      join(overrideDir, "weave-opencode.json"),
      join(projectDir, ".opencode", "weave-opencode.json"),
    ])
  })

  it("prefers .jsonc over .json in the override directory", () => {
    writeFileSync(join(overrideDir, "weave-opencode.json"), JSON.stringify({ disabled_agents: ["pattern"] }))
    writeFileSync(join(overrideDir, "weave-opencode.jsonc"), JSON.stringify({ disabled_agents: ["warp"] }))
    process.env[ENV] = overrideDir

    const config = loadWeaveConfig(projectDir)

    expect(config.disabled_agents).toEqual(["warp"])
    expect(getLastConfigLoadResult()?.loadedFiles).toEqual([join(overrideDir, "weave-opencode.jsonc")])
  })
})
