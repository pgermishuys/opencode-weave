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

  it("parses categories config", () => {
    const result = WeaveConfigSchema.safeParse({
      categories: { deep: { model: "claude-opus-4", temperature: 0.5 } },
    })
    expect(result.success).toBe(true)
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
})
