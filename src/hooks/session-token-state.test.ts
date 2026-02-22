import { describe, it, expect, beforeEach } from "bun:test"
import {
  setContextLimit,
  updateUsage,
  getState,
  clearSession,
  clear,
} from "./session-token-state"

describe("session-token-state", () => {
  beforeEach(() => {
    clear()
  })

  it("setContextLimit stores maxTokens for a session", () => {
    setContextLimit("sess-1", 100_000)
    const state = getState("sess-1")
    expect(state?.maxTokens).toBe(100_000)
    expect(state?.usedTokens).toBe(0)
  })

  it("updateUsage stores latest input tokens (not cumulative)", () => {
    setContextLimit("sess-1", 100_000)
    updateUsage("sess-1", 30_000)
    updateUsage("sess-1", 50_000) // replaces, not adds
    const state = getState("sess-1")
    expect(state?.usedTokens).toBe(50_000)
  })

  it("getState returns undefined for unknown session", () => {
    expect(getState("unknown-session")).toBeUndefined()
  })

  it("clearSession removes a session", () => {
    setContextLimit("sess-1", 100_000)
    updateUsage("sess-1", 50_000)
    clearSession("sess-1")
    expect(getState("sess-1")).toBeUndefined()
  })

  it("multiple sessions tracked independently", () => {
    setContextLimit("sess-a", 100_000)
    setContextLimit("sess-b", 200_000)
    updateUsage("sess-a", 40_000)
    updateUsage("sess-b", 80_000)

    expect(getState("sess-a")).toEqual({ maxTokens: 100_000, usedTokens: 40_000 })
    expect(getState("sess-b")).toEqual({ maxTokens: 200_000, usedTokens: 80_000 })

    clearSession("sess-a")
    expect(getState("sess-a")).toBeUndefined()
    expect(getState("sess-b")).toEqual({ maxTokens: 200_000, usedTokens: 80_000 })
  })

  it("updateUsage does not overwrite maxTokens", () => {
    setContextLimit("sess-1", 100_000)
    updateUsage("sess-1", 60_000)
    const state = getState("sess-1")
    expect(state?.maxTokens).toBe(100_000)
    expect(state?.usedTokens).toBe(60_000)
  })

  it("setContextLimit does not overwrite existing usedTokens", () => {
    setContextLimit("sess-1", 100_000)
    updateUsage("sess-1", 50_000)
    setContextLimit("sess-1", 120_000) // update limit (e.g., model switched)
    const state = getState("sess-1")
    expect(state?.maxTokens).toBe(120_000)
    expect(state?.usedTokens).toBe(50_000)
  })

  it("updateUsage ignores zero and negative token counts", () => {
    setContextLimit("sess-1", 100_000)
    updateUsage("sess-1", 0)
    updateUsage("sess-1", -1)
    const state = getState("sess-1")
    expect(state?.usedTokens).toBe(0)
  })

  it("updateUsage creates entry if setContextLimit was never called", () => {
    // Edge case: message.updated fires before chat.params
    updateUsage("sess-orphan", 20_000)
    const state = getState("sess-orphan")
    expect(state?.usedTokens).toBe(20_000)
    expect(state?.maxTokens).toBe(0)
  })
})
