import { describe, it, expect } from "bun:test"
import { mergeConfigs } from "./merge"

describe("mergeConfigs", () => {
  it("returns project config when user is empty", () => {
    const result = mergeConfigs(
      {},
      { agents: { loom: { model: "claude-opus-4" } } },
    )
    expect(result.agents?.loom?.model).toBe("claude-opus-4")
  })

  it("project config overrides user config at top level", () => {
    const result = mergeConfigs(
      { tmux: { enabled: false } },
      { tmux: { enabled: true } },
    )
    expect(result.tmux?.enabled).toBe(true)
  })

  it("deep merges agents (project wins per-key, user keys preserved)", () => {
    const result = mergeConfigs(
      { agents: { loom: { model: "claude-opus-3", temperature: 0.5 } } },
      { agents: { loom: { model: "claude-opus-4" } } },
    )
    expect(result.agents?.loom?.model).toBe("claude-opus-4")
    expect(result.agents?.loom?.temperature).toBe(0.5)
  })

  it("merges agents from both user and project (union of keys)", () => {
    const result = mergeConfigs(
      { agents: { loom: { model: "claude-opus-4" } } },
      { agents: { pattern: { model: "claude-sonnet-4" } } },
    )
    expect(result.agents?.loom?.model).toBe("claude-opus-4")
    expect(result.agents?.pattern?.model).toBe("claude-sonnet-4")
  })

  it("unions disabled_hooks (no duplicates)", () => {
    const result = mergeConfigs(
      { disabled_hooks: ["hook-a", "hook-b"] },
      { disabled_hooks: ["hook-b", "hook-c"] },
    )
    expect(result.disabled_hooks).toEqual(["hook-a", "hook-b", "hook-c"])
  })

  it("unions disabled_tools (no duplicates)", () => {
    const result = mergeConfigs(
      { disabled_tools: ["tool-x"] },
      { disabled_tools: ["tool-y", "tool-x"] },
    )
    expect(result.disabled_tools?.length).toBe(2)
    expect(result.disabled_tools).toContain("tool-x")
    expect(result.disabled_tools).toContain("tool-y")
  })

  it("unions disabled_agents (no duplicates)", () => {
    const result = mergeConfigs(
      { disabled_agents: ["spindle"] },
      { disabled_agents: ["thread", "spindle"] },
    )
    expect(result.disabled_agents?.length).toBe(2)
  })

  it("unions disabled_skills (no duplicates)", () => {
    const result = mergeConfigs(
      { disabled_skills: ["playwright"] },
      { disabled_skills: ["git-master"] },
    )
    expect(result.disabled_skills?.length).toBe(2)
  })

  it("returns undefined for disabled arrays when both are absent", () => {
    const result = mergeConfigs({}, {})
    expect(result.disabled_hooks).toBeUndefined()
    expect(result.disabled_tools).toBeUndefined()
  })

  it("project experimental fields override user experimental fields", () => {
    const result = mergeConfigs(
      { experimental: { context_window_warning_threshold: 0.7 } },
      { experimental: { context_window_critical_threshold: 0.95 } },
    )
    expect(result.experimental?.context_window_warning_threshold).toBe(0.7)
    expect(result.experimental?.context_window_critical_threshold).toBe(0.95)
  })

  it("project background replaces user background entirely", () => {
    const result = mergeConfigs(
      { background: { defaultConcurrency: 2 } },
      { background: { defaultConcurrency: 5 } },
    )
    expect(result.background?.defaultConcurrency).toBe(5)
  })

  it("falls back to user background when project has none", () => {
    const result = mergeConfigs({ background: { defaultConcurrency: 3 } }, {})
    expect(result.background?.defaultConcurrency).toBe(3)
  })
})
