import { describe, it, expect } from "bun:test"
import {
  checkContextWindow,
  createContextWindowMonitor,
} from "./context-window-monitor"
import type {
  ContextWindowState,
  ContextWindowThresholds,
} from "./context-window-monitor"

describe("checkContextWindow", () => {
  // ── none action ──────────────────────────────────────────────────────────

  it("returns 'none' when usage is below the warning threshold", () => {
    const state: ContextWindowState = {
      usedTokens: 7000,
      maxTokens: 10000,
      sessionId: "ses-001",
    }

    const result = checkContextWindow(state)

    expect(result.action).toBe("none")
    expect(result.usagePct).toBeCloseTo(0.7)
    expect(result.message).toBeUndefined()
  })

  // ── warn action ──────────────────────────────────────────────────────────

  it("returns 'warn' at exactly 80% usage with a message containing '80%'", () => {
    const state: ContextWindowState = {
      usedTokens: 8000,
      maxTokens: 10000,
      sessionId: "ses-002",
    }

    const result = checkContextWindow(state)

    expect(result.action).toBe("warn")
    expect(result.usagePct).toBeCloseTo(0.8)
    expect(result.message).toBeDefined()
    expect(result.message).toContain("80%")
  })

  // ── recover action ───────────────────────────────────────────────────────

  it("returns 'recover' at 95% usage with a message containing 'IMMEDIATE ACTION'", () => {
    const state: ContextWindowState = {
      usedTokens: 9500,
      maxTokens: 10000,
      sessionId: "ses-003",
    }

    const result = checkContextWindow(state)

    expect(result.action).toBe("recover")
    expect(result.usagePct).toBeCloseTo(0.95)
    expect(result.message).toBeDefined()
    expect(result.message).toContain("IMMEDIATE ACTION")
  })

  it("returns 'recover' at 100% usage with usagePct close to 1.0", () => {
    const state: ContextWindowState = {
      usedTokens: 10000,
      maxTokens: 10000,
      sessionId: "ses-004",
    }

    const result = checkContextWindow(state)

    expect(result.action).toBe("recover")
    expect(result.usagePct).toBeCloseTo(1.0)
    expect(result.message).toBeDefined()
  })

  // ── custom thresholds ────────────────────────────────────────────────────

  it("applies custom thresholds correctly across all three action bands", () => {
    const thresholds: ContextWindowThresholds = {
      warningPct: 0.5,
      criticalPct: 0.75,
    }

    const noneState: ContextWindowState = { usedTokens: 4000, maxTokens: 10000, sessionId: "ses-005" }
    const warnState: ContextWindowState = { usedTokens: 5000, maxTokens: 10000, sessionId: "ses-006" }
    const recoverState: ContextWindowState = { usedTokens: 7500, maxTokens: 10000, sessionId: "ses-007" }

    expect(checkContextWindow(noneState, thresholds).action).toBe("none")
    expect(checkContextWindow(warnState, thresholds).action).toBe("warn")
    expect(checkContextWindow(recoverState, thresholds).action).toBe("recover")
  })

  // ── zero maxTokens edge case ─────────────────────────────────────────────

  it("returns 'none' with usagePct 0 when maxTokens is 0", () => {
    const state: ContextWindowState = {
      usedTokens: 500,
      maxTokens: 0,
      sessionId: "ses-008",
    }

    const result = checkContextWindow(state)

    expect(result.action).toBe("none")
    expect(result.usagePct).toBe(0)
    expect(result.message).toBeUndefined()
  })

  // ── createContextWindowMonitor factory ───────────────────────────────────

  it("createContextWindowMonitor() returns an object with a check function", () => {
    const monitor = createContextWindowMonitor()

    expect(typeof monitor.check).toBe("function")
  })

  it("createContextWindowMonitor with custom thresholds applies them to check()", () => {
    const monitor = createContextWindowMonitor({ warningPct: 0.5, criticalPct: 0.75 })

    const belowWarning: ContextWindowState = { usedTokens: 4000, maxTokens: 10000, sessionId: "ses-009" }
    const atWarning: ContextWindowState = { usedTokens: 5000, maxTokens: 10000, sessionId: "ses-010" }
    const atCritical: ContextWindowState = { usedTokens: 7500, maxTokens: 10000, sessionId: "ses-011" }

    expect(monitor.check(belowWarning).action).toBe("none")
    expect(monitor.check(atWarning).action).toBe("warn")
    expect(monitor.check(atCritical).action).toBe("recover")
  })
})
