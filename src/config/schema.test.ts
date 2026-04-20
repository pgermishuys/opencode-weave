import { describe, it, expect } from "bun:test"
import { WeaveConfigSchema } from "./schema"

describe("WeaveConfigSchema", () => {
  it("parses empty object with no errors", () => {
    const result = WeaveConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("parses partial agent override config", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: { loom: { model: "claude-opus-4", temperature: 1.0 } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.loom?.model).toBe("claude-opus-4")
    }
  })

  it("parses agent override modelOptions passthrough", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: {
        loom: {
          modelOptions: {
            reasoningEffort: "medium",
            reasoning: { effort: "high" },
          },
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.loom?.modelOptions).toEqual({
        reasoningEffort: "medium",
        reasoning: { effort: "high" },
      })
    }
  })

  it("rejects invalid temperature value (>2)", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: { loom: { temperature: 5.0 } },
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid top_p value (>1)", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: { loom: { top_p: 1.5 } },
    })
    expect(result.success).toBe(false)
  })

  it("parses disabled_hooks array", () => {
    const result = WeaveConfigSchema.safeParse({
      disabled_hooks: ["context-window-monitor"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_hooks).toContain("context-window-monitor")
    }
  })

  it("parses categories config shape", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: {
        deep: {
          model: "claude-opus-4",
          prompt_append: "Investigate deeply",
          temperature: 0.5,
          patterns: ["src/**/*.ts", "tests/**/*.ts"],
          tools: {
            bash: true,
            webfetch: false,
          },
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.categories?.deep).toEqual({
        model: "claude-opus-4",
        prompt_append: "Investigate deeply",
        temperature: 0.5,
        patterns: ["src/**/*.ts", "tests/**/*.ts"],
        tools: {
          bash: true,
          webfetch: false,
        },
      })
    }
  })

  it("parses categories config with patterns field", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: {
        frontend: {
          model: "claude-sonnet-4",
          prompt_append: "React specialist",
          patterns: ["src/components/**", "*.tsx", "*.css"],
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.categories?.frontend?.patterns).toEqual([
        "src/components/**",
        "*.tsx",
        "*.css",
      ])
    }
  })

  it("parses categories config with empty patterns array", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: {
        unscoped: {
          patterns: [],
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.categories?.unscoped?.patterns).toEqual([])
    }
  })

  it("rejects categories config with non-string-array patterns", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: {
        frontend: {
          patterns: [123, true],
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("parses categories config without patterns (backward compatibility)", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: {
        backend: { model: "claude-opus-4", temperature: 0.3 },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.categories?.backend?.patterns).toBeUndefined()
    }
  })

  it("parses custom agent modelOptions passthrough", () => {
    const result = WeaveConfigSchema.safeParse({
      custom_agents: {
        reviewer: {
          prompt: "Review code.",
          model: "claude-opus-4",
          modelOptions: {
            reasoningEffort: "low",
            reasoning: { budgetTokens: 2048 },
          },
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.custom_agents?.reviewer?.modelOptions).toEqual({
        reasoningEffort: "low",
        reasoning: { budgetTokens: 2048 },
      })
    }
  })

  it("parses background config with concurrency limits", () => {
    const result = WeaveConfigSchema.safeParse({
      background: {
        defaultConcurrency: 3,
        providerConcurrency: { anthropic: 2 },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.background?.defaultConcurrency).toBe(3)
    }
  })

  it("parses tmux config", () => {
    const result = WeaveConfigSchema.safeParse({
      tmux: { enabled: true, layout: "main-horizontal" },
    })
    expect(result.success).toBe(true)
  })

  it("rejects invalid tmux layout", () => {
    const result = WeaveConfigSchema.safeParse({
      tmux: { layout: "invalid-layout" },
    })
    expect(result.success).toBe(false)
  })

  it("parses agent mode field", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: { shuttle: { mode: "all" } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.shuttle?.mode).toBe("all")
    }
  })

  it("rejects invalid agent mode", () => {
    const result = WeaveConfigSchema.safeParse({
      agents: { loom: { mode: "invalid-mode" } },
    })
    expect(result.success).toBe(false)
  })

  it("parses analytics config with enabled only", () => {
    const result = WeaveConfigSchema.safeParse({
      analytics: { enabled: true },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.analytics?.enabled).toBe(true)
      expect(result.data.analytics?.use_fingerprint).toBeUndefined()
    }
  })

  it("parses analytics config with use_fingerprint enabled", () => {
    const result = WeaveConfigSchema.safeParse({
      analytics: { enabled: true, use_fingerprint: true },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.analytics?.use_fingerprint).toBe(true)
    }
  })

  it("parses analytics config with use_fingerprint disabled", () => {
    const result = WeaveConfigSchema.safeParse({
      analytics: { enabled: true, use_fingerprint: false },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.analytics?.use_fingerprint).toBe(false)
    }
  })

  it("parses continuation config with recovery and idle overrides", () => {
    const result = WeaveConfigSchema.safeParse({
      continuation: {
        recovery: { compaction: false },
        idle: { enabled: true, workflow: false },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.continuation?.recovery?.compaction).toBe(false)
      expect(result.data.continuation?.idle?.enabled).toBe(true)
      expect(result.data.continuation?.idle?.workflow).toBe(false)
    }
  })

  it("parses experimental config", () => {
    const result = WeaveConfigSchema.safeParse({
      experimental: {
        context_window_warning_threshold: 0.8,
        context_window_critical_threshold: 0.95,
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects experimental threshold out of range", () => {
    const result = WeaveConfigSchema.safeParse({
      experimental: { context_window_warning_threshold: 1.5 },
    })
    expect(result.success).toBe(false)
  })

  it("parses workflows.directories array", () => {
    const result = WeaveConfigSchema.safeParse({
      workflows: { directories: ["examples/config/github-speckit/config"] },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workflows?.directories).toEqual([
        "examples/config/github-speckit/config",
      ])
    }
  })

  it("parses skill_directories array", () => {
    const result = WeaveConfigSchema.safeParse({
      skill_directories: ["examples/config/github-speckit/skills"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.skill_directories).toEqual([
        "examples/config/github-speckit/skills",
      ])
    }
  })

  it("parses both workflows.directories and skill_directories together", () => {
    const result = WeaveConfigSchema.safeParse({
      workflows: { directories: ["custom/workflows"] },
      skill_directories: ["custom/skills"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workflows?.directories).toEqual(["custom/workflows"])
      expect(result.data.skill_directories).toEqual(["custom/skills"])
    }
  })

  it("parses empty object — workflows.directories and skill_directories are optional", () => {
    const result = WeaveConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.workflows?.directories).toBeUndefined()
      expect(result.data.skill_directories).toBeUndefined()
    }
  })

  it("rejects absolute paths in workflows.directories", () => {
    const result = WeaveConfigSchema.safeParse({
      workflows: { directories: ["/etc/shadow"] },
    })
    expect(result.success).toBe(false)
  })

  it("rejects paths with .. traversal in workflows.directories", () => {
    const result = WeaveConfigSchema.safeParse({
      workflows: { directories: ["../../outside"] },
    })
    expect(result.success).toBe(false)
  })

  it("rejects absolute paths in skill_directories", () => {
    const result = WeaveConfigSchema.safeParse({
      skill_directories: ["/usr/local/malicious"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects leading backslash paths in skill_directories", () => {
    const result = WeaveConfigSchema.safeParse({
      skill_directories: ["\\\\server\\share"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects drive-rooted paths in skill_directories on every platform", () => {
    const result = WeaveConfigSchema.safeParse({
      skill_directories: ["C:\\Windows\\System32"],
    })
    expect(result.success).toBe(false)
  })

  it("rejects paths with .. traversal in skill_directories", () => {
    const result = WeaveConfigSchema.safeParse({
      skill_directories: ["subdir/../../outside"],
    })
    expect(result.success).toBe(false)
  })

  it("accepts valid relative paths in directories config", () => {
    const result = WeaveConfigSchema.safeParse({
      workflows: { directories: ["examples/config/speckit/workflows"] },
      skill_directories: ["examples/config/speckit/skills"],
    })
    expect(result.success).toBe(true)
  })

  it("parses log_level DEBUG", () => {
    const result = WeaveConfigSchema.safeParse({ log_level: "DEBUG" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.log_level).toBe("DEBUG")
    }
  })

  it("parses log_level INFO", () => {
    const result = WeaveConfigSchema.safeParse({ log_level: "INFO" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.log_level).toBe("INFO")
    }
  })

  it("rejects invalid log_level TRACE", () => {
    const result = WeaveConfigSchema.safeParse({ log_level: "TRACE" })
    expect(result.success).toBe(false)
  })

  it("parses empty object — log_level is optional and undefined", () => {
    const result = WeaveConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.log_level).toBeUndefined()
    }
  })
})
