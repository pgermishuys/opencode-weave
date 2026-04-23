import { describe, it, expect, spyOn } from "bun:test"
import { buildEnabledAgentKeys, buildEffectiveAdditionalReviewerKeys } from "./enabled-agent-keys"
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

describe("buildEffectiveAdditionalReviewerKeys", () => {
  it("returns only valid enabled custom reviewers", () => {
    const config: WeaveConfig = {
      custom_agents: {
        "security-reviewer": { model: "gpt-4o", display_name: "Security Reviewer" },
        "perf-reviewer": { model: "gpt-4o" },
        "disabled-reviewer": { model: "gpt-4o" },
      },
      disabled_agents: ["disabled-reviewer"],
      review: {
        additional_agents: [
          "security-reviewer",
          "perf-reviewer",
          "security-reviewer",
          "disabled-reviewer",
          "missing-reviewer",
          "weft",
          "warp",
        ],
      },
    }

    const metadata = [
      {
        name: "security-reviewer",
        description: "Security checks",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
      {
        name: "perf-reviewer",
        description: "Performance checks",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
    ]

    const result = buildEffectiveAdditionalReviewerKeys(config, metadata)
    expect(result.has("security-reviewer")).toBe(true)
    expect(result.has("perf-reviewer")).toBe(true)
    expect(result.has("disabled-reviewer")).toBe(false)
    expect(result.has("missing-reviewer")).toBe(false)
    expect(result.has("weft")).toBe(false)
    expect(result.has("warp")).toBe(false)
    expect(result.size).toBe(2)
  })

  it("emits actionable warnings for ignored entries", () => {
    const warnSpy = spyOn(console, "error").mockImplementation(() => {})
    const config: WeaveConfig = {
      custom_agents: {
        reviewer: { model: "gpt-4o" },
      },
      review: {
        additional_agents: ["reviewer", "reviewer", "missing", "weft"],
      },
    }

    const metadata = [
      {
        name: "reviewer",
        description: "Reviewer",
        metadata: { category: "advisor", cost: "EXPENSIVE", triggers: [] },
      },
    ]

    buildEffectiveAdditionalReviewerKeys(config, metadata)

    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("duplicate reviewer"))).toBe(true)
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("custom agent not found"))).toBe(true)
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("managed by built-in review flow"))).toBe(true)
    warnSpy.mockRestore()
  })
})
