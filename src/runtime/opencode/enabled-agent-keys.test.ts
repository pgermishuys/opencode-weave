import { describe, it, expect } from "bun:test"
import { buildEnabledAgentKeys } from "./enabled-agent-keys"
import type { WeaveConfig } from "../../config/schema"

const BUILTINS = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft", "warp"]

describe("buildEnabledAgentKeys", () => {
  it("includes all builtins by default", () => {
    const result = buildEnabledAgentKeys({})
    for (const name of BUILTINS) {
      expect(result.has(name)).toBe(true)
    }
  })

  it("excludes disabled builtins", () => {
    const result = buildEnabledAgentKeys({ disabled_agents: ["loom", "warp"] })
    expect(result.has("loom")).toBe(false)
    expect(result.has("warp")).toBe(false)
    expect(result.has("tapestry")).toBe(true)
  })

  it("includes custom agents not in disabled list", () => {
    const config: WeaveConfig = {
      custom_agents: {
        "my-agent": { model: "claude-3-haiku" },
        "other-agent": { model: "gpt-4o" },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("my-agent")).toBe(true)
    expect(result.has("other-agent")).toBe(true)
  })

  it("excludes disabled custom agents", () => {
    const config: WeaveConfig = {
      custom_agents: {
        "my-agent": { model: "claude-3-haiku" },
        "other-agent": { model: "gpt-4o" },
      },
      disabled_agents: ["my-agent"],
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("my-agent")).toBe(false)
    expect(result.has("other-agent")).toBe(true)
  })

  it("includes shuttle-{category} when category has patterns and shuttle is enabled", () => {
    const config: WeaveConfig = {
      categories: {
        frontend: { patterns: ["**/*.tsx", "**/*.css"] },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle-frontend")).toBe(true)
  })

  it("includes shuttle-{category} even when category has no patterns", () => {
    const config: WeaveConfig = {
      categories: {
        frontend: { description: "Frontend work" },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle-frontend")).toBe(true)
  })

  it("includes shuttle-{category} even when category has empty patterns array", () => {
    const config: WeaveConfig = {
      categories: {
        frontend: { patterns: [] },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle-frontend")).toBe(true)
  })

  it("excludes shuttle-{category} when base shuttle is disabled", () => {
    const config: WeaveConfig = {
      disabled_agents: ["shuttle"],
      categories: {
        frontend: { patterns: ["**/*.tsx"] },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle")).toBe(false)
    expect(result.has("shuttle-frontend")).toBe(false)
  })

  it("excludes shuttle-{category} when the specific category agent is disabled", () => {
    const config: WeaveConfig = {
      disabled_agents: ["shuttle-frontend"],
      categories: {
        frontend: { patterns: ["**/*.tsx"] },
        backend: { patterns: ["**/*.ts"] },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle-frontend")).toBe(false)
    expect(result.has("shuttle-backend")).toBe(true)
  })

  it("handles multiple categories with mixed patterns", () => {
    const config: WeaveConfig = {
      categories: {
        frontend: { patterns: ["**/*.tsx"] },
        backend: { description: "No patterns here" },
        infra: { patterns: ["**/terraform/**"] },
      },
    }
    const result = buildEnabledAgentKeys(config)
    expect(result.has("shuttle-frontend")).toBe(true)
    expect(result.has("shuttle-backend")).toBe(true)
    expect(result.has("shuttle-infra")).toBe(true)
  })

  it("returns empty categories set when no categories defined", () => {
    const result = buildEnabledAgentKeys({})
    const categoryShuttles = [...result].filter(k => k.startsWith("shuttle-"))
    expect(categoryShuttles).toHaveLength(0)
  })
})
