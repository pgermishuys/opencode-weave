import { describe, it, expect } from "bun:test"
import { createToolRegistry } from "./registry"
import { WeaveConfigSchema } from "../config/schema"

describe("createToolRegistry", () => {
  const baseConfig = WeaveConfigSchema.parse({})

  it("includes all tools when none are disabled", () => {
    const result = createToolRegistry({
      availableTools: ["read", "write", "task"],
      config: baseConfig,
      agentRestrictions: {},
    })
    expect(result.filteredTools).toEqual(["read", "write", "task"])
  })

  it("excludes globally disabled tools", () => {
    const config = WeaveConfigSchema.parse({ disabled_tools: ["write"] })
    const result = createToolRegistry({
      availableTools: ["read", "write", "task"],
      config,
      agentRestrictions: {},
    })
    expect(result.filteredTools).not.toContain("write")
    expect(result.filteredTools).toContain("read")
  })

  it("taskSystemEnabled is true when task not disabled", () => {
    const result = createToolRegistry({
      availableTools: ["read", "task"],
      config: baseConfig,
      agentRestrictions: {},
    })
    expect(result.taskSystemEnabled).toBe(true)
  })

  it("taskSystemEnabled is false when task is disabled", () => {
    const config = WeaveConfigSchema.parse({ disabled_tools: ["task"] })
    const result = createToolRegistry({
      availableTools: ["read", "task"],
      config,
      agentRestrictions: {},
    })
    expect(result.taskSystemEnabled).toBe(false)
  })

  it("permissions from registry enforce per-agent deny lists", () => {
    const result = createToolRegistry({
      availableTools: ["read", "write"],
      config: baseConfig,
      agentRestrictions: { thread: { write: false } },
    })
    expect(result.permissions.isToolAllowed("thread", "write")).toBe(false)
    expect(result.permissions.isToolAllowed("thread", "read")).toBe(true)
    expect(result.permissions.isToolAllowed("loom", "write")).toBe(true)
  })
})
