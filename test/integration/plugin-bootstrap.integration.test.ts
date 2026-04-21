import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import WeavePlugin from "../../src/index"
import { resetNameVariants } from "../../src/agents/agent-builder"
import { ANALYTICS_DIR } from "../../src/features/analytics/types"
import { resetDisplayNames, getAgentDisplayName } from "../../src/shared/agent-display-names"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { makeMockCtx } from "../testkit/plugin-context"

describe("Integration: plugin bootstrap config", () => {
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-integration-plugin-bootstrap-")
    fixture.writeFile("package.json", JSON.stringify({ name: "test-proj", dependencies: {} }))
    fixture.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: {} }))
  })

  afterEach(() => {
    fixture.cleanup()
    resetDisplayNames()
    resetNameVariants()
  })

  it("analytics.enabled true does not create a fingerprint by default", async () => {
    fixture.writeProjectConfig({ analytics: { enabled: true } })
    await WeavePlugin(makeMockCtx(fixture.directory))

    expect(existsSync(join(fixture.directory, ANALYTICS_DIR, "fingerprint.json"))).toBe(false)
  })

  it("returns all 8 handlers and config produces all builtin agents", async () => {
    const plugin = await WeavePlugin(makeMockCtx(fixture.directory))

    const expectedKeys = [
      "tool",
      "config",
      "chat.message",
      "chat.params",
      "chat.headers",
      "event",
      "tool.execute.before",
      "tool.execute.after",
    ]

    for (const key of expectedKeys) {
      expect((plugin as Record<string, unknown>)[key]).toBeDefined()
    }

    const configObj: Record<string, unknown> = {}
    await (plugin.config as (config: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string }>
    expect(agents).toBeDefined()

    const builtinNames = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]
    for (const name of builtinNames) {
      expect(agents[getAgentDisplayName(name)]).toBeDefined()
    }

    const loomDisplayName = getAgentDisplayName("loom")
    expect(agents[loomDisplayName].prompt).toContain("<Role>")
    expect(configObj.default_agent).toBe(loomDisplayName)
  })

  it("analytics.enabled with use_fingerprint creates analytics artifacts", async () => {
    fixture.writeProjectConfig({ analytics: { enabled: true, use_fingerprint: true } })
    await WeavePlugin(makeMockCtx(fixture.directory))

    expect(existsSync(join(fixture.directory, ANALYTICS_DIR))).toBe(true)
    expect(existsSync(join(fixture.directory, ANALYTICS_DIR, "fingerprint.json"))).toBe(true)

    const fingerprint = JSON.parse(readFileSync(join(fixture.directory, ANALYTICS_DIR, "fingerprint.json"), "utf-8"))
    expect(Array.isArray(fingerprint.stack)).toBe(true)
    expect(fingerprint.primaryLanguage).toBeDefined()
    expect(fingerprint.packageManager).toBeDefined()
  })

  it("omitting analytics.enabled leaves analytics artifacts absent", async () => {
    fixture.writeProjectConfig({})
    await WeavePlugin(makeMockCtx(fixture.directory))

    expect(existsSync(join(fixture.directory, ANALYTICS_DIR))).toBe(false)
  })

  it("with no config file does not create analytics directory", async () => {
    await WeavePlugin(makeMockCtx(fixture.directory))
    expect(existsSync(join(fixture.directory, ANALYTICS_DIR))).toBe(false)
  })

  it("injects fingerprint context into the Loom prompt only when explicitly enabled", async () => {
    fixture.writeFile("bun.lockb", "")
    fixture.writeProjectConfig({ analytics: { enabled: true, use_fingerprint: true } })

    const plugin = await WeavePlugin(makeMockCtx(fixture.directory))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (config: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string }>
    const loomPrompt = agents[getAgentDisplayName("loom")].prompt ?? ""

    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")
    expect(loomPrompt).toContain("bun")
  })

  it("does not inject fingerprint context when use_fingerprint is false", async () => {
    fixture.writeFile("bun.lockb", "")
    fixture.writeProjectConfig({ analytics: { enabled: true } })

    const plugin = await WeavePlugin(makeMockCtx(fixture.directory))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (config: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string }>
    const loomPrompt = agents[getAgentDisplayName("loom")].prompt ?? ""

    expect(loomPrompt).not.toContain("<ProjectContext>")
  })

  it("generates shuttle-{category} agent and CategoryRouting in Tapestry prompt when categories configured", async () => {
    fixture.writeProjectConfig({
      categories: {
        frontend: {
          patterns: ["src/frontend/**"],
          model: "gpt-4o",
          prompt_append: "Focus on React.",
        },
      },
    })

    const plugin = await WeavePlugin(makeMockCtx(fixture.directory))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (config: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string }>
    expect(agents["shuttle-frontend"]).toBeDefined()

    const tapestryDisplayName = getAgentDisplayName("tapestry")
    const tapestryPrompt = agents[tapestryDisplayName]?.prompt ?? ""
    expect(tapestryPrompt).toContain("<CategoryRouting>")
    expect(tapestryPrompt).toContain("shuttle-frontend")
  })

  it("applies overrides, custom agents, disabled agents, and fingerprinted prompts together", async () => {
    fixture.writeFile("bun.lockb", "")
    fixture.writeProjectConfig({
      agents: { loom: { model: "override-test-model" } },
      custom_agents: {
        "my-specialist": {
          prompt: "I handle specialized tasks.",
          display_name: "My Specialist",
          category: "specialist",
          cost: "CHEAP",
        },
      },
      disabled_agents: ["spindle"],
      analytics: { enabled: true, use_fingerprint: true },
    })

    const plugin = await WeavePlugin(makeMockCtx(fixture.directory))
    const configObj: Record<string, unknown> = {}
    await (plugin.config as (config: Record<string, unknown>) => Promise<void>)(configObj)

    const agents = configObj.agent as Record<string, { prompt?: string; model?: string }>
    const loomDisplayName = getAgentDisplayName("loom")
    const loomPrompt = agents[loomDisplayName].prompt ?? ""

    expect(agents[loomDisplayName]).toBeDefined()
    expect(agents[loomDisplayName].model).toBe("override-test-model")
    expect(agents["My Specialist"]).toBeDefined()
    expect(agents["My Specialist"].prompt).toContain("specialized tasks")
    expect(agents[getAgentDisplayName("spindle")]).toBeUndefined()
    expect(agents[getAgentDisplayName("thread")]).toBeDefined()
    expect(agents[getAgentDisplayName("tapestry")]).toBeDefined()
    expect(loomPrompt).toContain("<ProjectContext>")
    expect(loomPrompt).toContain("typescript")
    expect(existsSync(join(fixture.directory, ANALYTICS_DIR))).toBe(true)
    expect(loomPrompt).not.toContain("spindle")
    expect(configObj.default_agent).toBe(loomDisplayName)
  })
})
