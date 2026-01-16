import { describe, it, expect } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import WeavePlugin from "./index"
import { createBuiltinAgents } from "./agents/builtin-agents"
import { ConfigHandler } from "./managers/config-handler"
import { WeaveConfigSchema } from "./config/schema"

const makeMockCtx = (directory: string): PluginInput =>
  ({
    directory,
    client: {},
    project: { root: directory },
    serverUrl: "http://localhost:3000",
  }) as unknown as PluginInput

const defaultConfig = WeaveConfigSchema.parse({})

describe("WeavePlugin integration", () => {
  it("plugin loads and returns all 8 handlers", async () => {
    const result = await WeavePlugin(makeMockCtx(process.cwd()))
    const keys = Object.keys(result)
    expect(keys).toContain("tool")
    expect(keys).toContain("config")
    expect(keys).toContain("chat.message")
    expect(keys).toContain("chat.params")
    expect(keys).toContain("chat.headers")
    expect(keys).toContain("event")
    expect(keys).toContain("tool.execute.before")
    expect(keys).toContain("tool.execute.after")
  })

  it("config handler registers all 6 agents", async () => {
    const agents = createBuiltinAgents()
    const handler = new ConfigHandler({ pluginConfig: defaultConfig, agents })
    const result = await handler.handle({ pluginConfig: defaultConfig, agents })

    expect(Object.keys(result.agents)).toContain("loom")
    expect(Object.keys(result.agents)).toContain("tapestry")
    expect(Object.keys(result.agents)).toContain("shuttle")
    expect(Object.keys(result.agents)).toContain("pattern")
    expect(Object.keys(result.agents)).toContain("thread")
    expect(Object.keys(result.agents)).toContain("spindle")

    for (const [, agent] of Object.entries(result.agents)) {
      expect(agent.model).toBeTruthy()
      expect(agent.prompt).toBeTruthy()
    }
  })

  it("config handler applies agent overrides", async () => {
    const overrideModel = "override-model-test"
    const config = WeaveConfigSchema.parse({
      agents: { loom: { model: overrideModel } },
    })
    const agents = createBuiltinAgents({ agentOverrides: config.agents })
    const handler = new ConfigHandler({ pluginConfig: config, agents })
    const result = await handler.handle({ pluginConfig: config, agents })

    expect(result.agents.loom.model).toBe(overrideModel)
  })

  it("tool permissions enforced per agent — thread and spindle are read-only", () => {
    const agents = createBuiltinAgents()
    const threadAgent = agents["thread"]
    const spindleAgent = agents["spindle"]
    const loomAgent = agents["loom"]

    expect(threadAgent).toBeDefined()
    expect(spindleAgent).toBeDefined()
    expect(loomAgent).toBeDefined()

    // Thread and spindle deny write tools (tools is Record<string, boolean>, false = denied)
    const threadTools = threadAgent.tools as Record<string, boolean> | undefined
    const spindleTools = spindleAgent.tools as Record<string, boolean> | undefined
    expect(threadTools?.write).toBe(false)
    expect(spindleTools?.write).toBe(false)
    expect(threadTools?.edit).toBe(false)
    expect(spindleTools?.edit).toBe(false)
  })

  it("disabled agent excluded from config handler output", async () => {
    const config = WeaveConfigSchema.parse({ disabled_agents: ["spindle"] })
    const agents = createBuiltinAgents({ disabledAgents: ["spindle"] })
    const handler = new ConfigHandler({ pluginConfig: config, agents })
    const result = await handler.handle({ pluginConfig: config, agents })

    expect(Object.keys(result.agents)).not.toContain("spindle")
    expect(Object.keys(result.agents)).toContain("loom")
    expect(Object.keys(result.agents)).toHaveLength(5)
  })

  it("disabled hook not created — context-window-monitor disabled", async () => {
    const config = WeaveConfigSchema.parse({ disabled_hooks: ["context-window-monitor"] })
    const { createHooks } = await import("./hooks/create-hooks")
    const hooks = createHooks({
      pluginConfig: config,
      isHookEnabled: (name) => !["context-window-monitor"].includes(name),
    })

    expect(hooks.checkContextWindow).toBeNull()
    // Other hooks should still be enabled
    expect(hooks.writeGuard).not.toBeNull()
  })
})
