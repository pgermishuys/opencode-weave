import { describe, it, expect } from "bun:test"
import { ConfigHandler } from "./managers/config-handler"
import { WeaveConfigSchema } from "./config/schema"

describe("config pipeline", () => {
  it("full config pipeline processes all phases", async () => {
    const pluginConfig = WeaveConfigSchema.parse({})
    const handler = new ConfigHandler({ pluginConfig })
    const result = await handler.handle({
      pluginConfig,
      agents: {},
      availableTools: ["read", "write", "edit"],
    })
    expect(result.agents).toBeDefined()
    expect(typeof result.agents).toBe("object")
    expect(result.tools).toBeDefined()
    expect(Array.isArray(result.tools)).toBe(true)
    expect(result.mcps).toBeDefined()
    expect(result.commands).toBeDefined()
  })

  it("config pipeline handles empty config", async () => {
    const pluginConfig = WeaveConfigSchema.parse({})
    const handler = new ConfigHandler({ pluginConfig })
    const result = await handler.handle({ pluginConfig })
    expect(typeof result.agents).toBe("object")
    expect(Array.isArray(result.tools)).toBe(true)
  })
})
