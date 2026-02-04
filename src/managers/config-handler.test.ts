import { describe, it, expect } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { ConfigHandler } from "./config-handler"
import type { ConfigPipelineInput, ConfigPipelineOutput } from "./config-handler"
import { getAgentDisplayName } from "../shared/agent-display-names"
import { BUILTIN_COMMANDS } from "../features/builtin-commands"

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
    expect(result).toHaveProperty("defaultAgent")
    expect(typeof result.agents).toBe("object")
    expect(Array.isArray(result.tools)).toBe(true)
    expect(typeof result.mcps).toBe("object")
    expect(typeof result.commands).toBe("object")
  })

  it("remaps agent keys to display names", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const result = await handler.handle({
      pluginConfig: {},
      agents: makeAgents(),
      availableTools: [],
    })

    // Keys should be display names, not config keys
    expect(result.agents[getAgentDisplayName("loom")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("tapestry")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("pattern")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("thread")]).toBeDefined()
    // Primary agent original lowercase keys should not exist (they get remapped to display names)
    expect(result.agents["loom"]).toBeUndefined()
    expect(result.agents["tapestry"]).toBeUndefined()
    // Subagent keys stay as-is (display name === config key)
    expect(result.agents["pattern"]).toBeDefined()
    expect(result.agents["thread"]).toBeDefined()
  })

  it("sets defaultAgent to loom display name", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const result = await handler.handle({
      pluginConfig: {},
      agents: makeAgents(),
      availableTools: [],
    })

    expect(result.defaultAgent).toBe(getAgentDisplayName("loom"))
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

    const loomKey = getAgentDisplayName("loom")
    expect(result.agents[loomKey]?.model).toBe("gpt-5")
    // Other fields from the builtin agent are preserved
    expect(result.agents[loomKey]?.instructions).toBe("main orchestrator")
    // Agents without overrides are unchanged
    const tapestryKey = getAgentDisplayName("tapestry")
    expect(result.agents[tapestryKey]?.model).toBe("claude-sonnet-4")
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

    expect(result.agents[getAgentDisplayName("loom")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("tapestry")]).toBeDefined()
    expect(result.agents[getAgentDisplayName("pattern")]).toBeUndefined()
    expect(result.agents[getAgentDisplayName("thread")]).toBeUndefined()
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
    expect(result.commands).toEqual({ ...BUILTIN_COMMANDS })
  })

  it("returns empty MCPs and builtin commands", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const result = await handler.handle({
      pluginConfig: {},
      agents: makeAgents(),
      availableTools: ["read"],
    })

    expect(Object.keys(result.mcps)).toHaveLength(0)
    expect(Object.keys(result.commands)).toHaveLength(Object.keys(BUILTIN_COMMANDS).length)
  })

  it("preserves non-builtin agent keys as-is", async () => {
    const handler = new ConfigHandler({ pluginConfig: {} })

    const agents: Record<string, AgentConfig> = {
      ...makeAgents(),
      "custom-agent": { model: "custom-model", instructions: "custom" },
    }

    const result = await handler.handle({
      pluginConfig: {},
      agents,
      availableTools: [],
    })

    // Custom agent key not in AGENT_DISPLAY_NAMES should pass through unchanged
    expect(result.agents["custom-agent"]).toBeDefined()
    expect(result.agents["custom-agent"]?.model).toBe("custom-model")
  })
})
