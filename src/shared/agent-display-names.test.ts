import { describe, it, expect, afterEach } from "bun:test"
import {
  AGENT_DISPLAY_NAMES,
  getAgentDisplayName,
  getAgentConfigKey,
  registerAgentDisplayName,
} from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for known config keys", () => {
    expect(getAgentDisplayName("loom")).toBe("Loom (Main Orchestrator)")
    expect(getAgentDisplayName("tapestry")).toBe("Tapestry (Execution Orchestrator)")
    // Subagents use simple lowercase keys as display names so OpenCode's Task tool can find them
    expect(getAgentDisplayName("shuttle")).toBe("shuttle")
    expect(getAgentDisplayName("pattern")).toBe("pattern")
    expect(getAgentDisplayName("thread")).toBe("thread")
    expect(getAgentDisplayName("spindle")).toBe("spindle")
  })

  it("returns original key for unknown agents", () => {
    expect(getAgentDisplayName("custom-agent")).toBe("custom-agent")
    expect(getAgentDisplayName("unknown")).toBe("unknown")
  })

  it("performs case-insensitive lookup", () => {
    expect(getAgentDisplayName("LOOM")).toBe("Loom (Main Orchestrator)")
    expect(getAgentDisplayName("Loom")).toBe("Loom (Main Orchestrator)")
    // Subagents map to simple lowercase keys
    expect(getAgentDisplayName("Thread")).toBe("thread")
  })
})

describe("getAgentConfigKey", () => {
  it("resolves display names back to config keys", () => {
    expect(getAgentConfigKey("Loom (Main Orchestrator)")).toBe("loom")
    expect(getAgentConfigKey("Tapestry (Execution Orchestrator)")).toBe("tapestry")
    // Subagent display names are already their config keys
    expect(getAgentConfigKey("thread")).toBe("thread")
    expect(getAgentConfigKey("pattern")).toBe("pattern")
    expect(getAgentConfigKey("shuttle")).toBe("shuttle")
    expect(getAgentConfigKey("spindle")).toBe("spindle")
  })

  it("passes through config keys unchanged", () => {
    expect(getAgentConfigKey("loom")).toBe("loom")
    expect(getAgentConfigKey("thread")).toBe("thread")
  })

  it("returns lowercase for unknown agents", () => {
    expect(getAgentConfigKey("UnknownAgent")).toBe("unknownagent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("has entries for all 8 built-in agents with display names", () => {
    const expectedKeys = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "warp", "weft"]
    for (const key of expectedKeys) {
      expect(AGENT_DISPLAY_NAMES[key]).toBeDefined()
    }
    // At least the 8 built-in agents (may be more if custom agents registered in other tests)
    expect(Object.keys(AGENT_DISPLAY_NAMES).length).toBeGreaterThanOrEqual(8)
  })
})

describe("registerAgentDisplayName", () => {
  afterEach(() => {
    // Clean up registered custom agents
    delete AGENT_DISPLAY_NAMES["custom-test-agent"]
    delete AGENT_DISPLAY_NAMES["another-custom"]
  })

  it("registers a new display name", () => {
    registerAgentDisplayName("custom-test-agent", "Custom Test Agent")
    expect(getAgentDisplayName("custom-test-agent")).toBe("Custom Test Agent")
  })

  it("registered agent is resolvable via getAgentConfigKey", () => {
    registerAgentDisplayName("custom-test-agent", "Custom Test Agent")
    expect(getAgentConfigKey("Custom Test Agent")).toBe("custom-test-agent")
  })

  it("overwrites existing display name for same custom agent", () => {
    registerAgentDisplayName("custom-test-agent", "First Name")
    registerAgentDisplayName("custom-test-agent", "Second Name")
    expect(getAgentDisplayName("custom-test-agent")).toBe("Second Name")
  })

  it("multiple custom agents can be registered", () => {
    registerAgentDisplayName("custom-test-agent", "Agent A")
    registerAgentDisplayName("another-custom", "Agent B")
    expect(getAgentDisplayName("custom-test-agent")).toBe("Agent A")
    expect(getAgentDisplayName("another-custom")).toBe("Agent B")
  })

  it("throws when trying to register a builtin config key", () => {
    expect(() => registerAgentDisplayName("loom", "My Loom")).toThrow(
      /built-in agent name/,
    )
    expect(() => registerAgentDisplayName("warp", "My Warp")).toThrow(
      /built-in agent name/,
    )
  })

  it("throws when display name collides with a builtin agent's display name", () => {
    expect(() =>
      registerAgentDisplayName("custom-test-agent", "Loom (Main Orchestrator)"),
    ).toThrow(/reserved for built-in agent/)
  })

  it("throws on case-insensitive collision with builtin display name", () => {
    expect(() =>
      registerAgentDisplayName("custom-test-agent", "loom (main orchestrator)"),
    ).toThrow(/reserved for built-in agent/)
  })

  it("allows display names that don't collide with builtins", () => {
    expect(() =>
      registerAgentDisplayName("custom-test-agent", "My Custom Reviewer"),
    ).not.toThrow()
  })
})
