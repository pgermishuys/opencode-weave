import { describe, it, expect } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { ConfigHandler } from "./config-handler"
import type { ConfigPipelineInput, ConfigPipelineOutput } from "./config-handler"

const makeAgents = (): Record<string, AgentConfig> => ({
  loom: { model: "claude-opus-4", instructions: "main orchestrator" },
  tapestry: { model: "claude-sonnet-4", instructions: "specialist" },
  pattern: { model: "gpt-4o", instructions: "fast exploration" },
  thread: { model: "gemini-pro", instructions: "advisor" },
})

describe("ConfigHandler", () => {
  it("runs all 6 phases and returns output with correct shape", async () => {
    const handler = new ConfigHandler({
      pluginConfig: {},
    })

    const result = await handler.handle({
      pluginConfig: {},
      agents: makeAgents(),
      availableTools: ["read", "write", "bash"],
    })

    expect(result).toHaveProperty("agents")
    expect(result).toHaveProperty("tools")
    expect(result).toHaveProperty("mcps")
    expect(result).toHaveProperty("commands")
    expect(typeof result.agents).toBe("object")
    expect(Array.isArray(result.tools)).toBe(true)
    expect(typeof result.mcps).toBe("object")
    expect(typeof result.commands).toBe("object")
  })

  it("merges agent overrides from pluginConfig.agents", async () => {
    const handler = new ConfigHandler({
      pluginConfig: {
        agents: {
          loom: { model: "gpt-5" },
        },
      },
    })

    const input: ConfigPipelineInput = {
      pluginConfig: {
        agents: {
          loom: { model: "gpt-5" },
        },
      },
      agents: makeAgents(),
      availableTools: [],
    }

    const result: ConfigPipelineOutput = await handler.handle(input)

    expect(result.agents["loom"]?.model).toBe("gpt-5")
    // Other fields from the builtin agent are preserved
    expect(result.agents["loom"]?.instructions).toBe("main orchestrator")
    // Agents without overrides are unchanged
    expect(result.agents["tapestry"]?.model).toBe("claude-sonnet-4")
  })

  it("excludes disabled agents from output", async () => {
    const handler = new ConfigHandler({
      pluginConfig: {
        disabled_agents: ["pattern", "thread"],
      },
    })

    const result = await handler.handle({
      pluginConfig: {
        disabled_agents: ["pattern", "thread"],
      },
      agents: makeAgents(),
      availableTools: [],
    })

    expect(result.agents["loom"]).toBeDefined()
    expect(result.agents["tapestry"]).toBeDefined()
    expect(result.agents["pattern"]).toBeUndefined()
    expect(result.agents["thread"]).toBeUndefined()
  })

  it("excludes disabled tools from output tools", async () => {
    const handler = new ConfigHandler({
      pluginConfig: {
        disabled_tools: ["bash", "write"],
      },
    })

    const result = await handler.handle({
      pluginConfig: {
        disabled_tools: ["bash", "write"],
      },
      agents: {},
      availableTools: ["read", "write", "bash", "glob"],
    })

    expect(result.tools).toContain("read")
    expect(result.tools).toContain("glob")
    expect(result.tools).not.toContain("bash")
    expect(result.tools).not.toContain("write")
  })

  it("handles empty pluginConfig without crashing and returns valid defaults", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const result = await handler.handle({
      pluginConfig: {},
    })

    expect(result.agents).toEqual({})
    expect(result.tools).toEqual([])
    expect(result.mcps).toEqual({})
    expect(result.commands).toEqual({})
  })

  it("returns empty MCPs and commands for v1", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const result = await handler.handle({
      pluginConfig: {},
      agents: makeAgents(),
      availableTools: ["read"],
    })

    expect(Object.keys(result.mcps)).toHaveLength(0)
    expect(Object.keys(result.commands)).toHaveLength(0)
  })
})
