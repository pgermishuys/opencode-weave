import { describe, it, expect } from "bun:test"
import {
  AGENT_DISPLAY_NAMES,
  getAgentDisplayName,
  getAgentConfigKey,
} from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for known config keys", () => {
    expect(getAgentDisplayName("loom")).toBe("Loom (Main Orchestrator)")
    expect(getAgentDisplayName("tapestry")).toBe("Tapestry (Execution Orchestrator)")
    expect(getAgentDisplayName("shuttle")).toBe("Shuttle (Domain Specialist)")
    expect(getAgentDisplayName("pattern")).toBe("Pattern (Strategic Planner)")
    expect(getAgentDisplayName("thread")).toBe("Thread (Codebase Explorer)")
    expect(getAgentDisplayName("spindle")).toBe("Spindle (External Researcher)")
  })

  it("returns original key for unknown agents", () => {
    expect(getAgentDisplayName("custom-agent")).toBe("custom-agent")
    expect(getAgentDisplayName("unknown")).toBe("unknown")
  })

  it("performs case-insensitive lookup", () => {
    expect(getAgentDisplayName("LOOM")).toBe("Loom (Main Orchestrator)")
    expect(getAgentDisplayName("Loom")).toBe("Loom (Main Orchestrator)")
    expect(getAgentDisplayName("Thread")).toBe("Thread (Codebase Explorer)")
  })
})

describe("getAgentConfigKey", () => {
  it("resolves display names back to config keys", () => {
    expect(getAgentConfigKey("Loom (Main Orchestrator)")).toBe("loom")
    expect(getAgentConfigKey("Thread (Codebase Explorer)")).toBe("thread")
    expect(getAgentConfigKey("Pattern (Strategic Planner)")).toBe("pattern")
    expect(getAgentConfigKey("Shuttle (Domain Specialist)")).toBe("shuttle")
    expect(getAgentConfigKey("Spindle (External Researcher)")).toBe("spindle")
    expect(getAgentConfigKey("Tapestry (Execution Orchestrator)")).toBe("tapestry")
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
  it("has entries for all 6 built-in agents", () => {
    const expectedKeys = ["loom", "tapestry", "shuttle", "pattern", "thread", "spindle"]
    for (const key of expectedKeys) {
      expect(AGENT_DISPLAY_NAMES[key]).toBeDefined()
    }
    expect(Object.keys(AGENT_DISPLAY_NAMES)).toHaveLength(6)
  })
})
