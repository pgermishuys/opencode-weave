import { describe, it, expect, beforeEach } from "bun:test"
import {
  markSessionCreated,
  markApplied,
  shouldApplyVariant,
  clearAll,
  clearSession,
} from "./first-message-variant"
import {
  detectKeywords,
  buildKeywordInjection,
  processMessageForKeywords,
} from "./keyword-detector"

describe("firstMessageVariant", () => {
  beforeEach(() => {
    clearAll()
  })

  it("shouldApplyVariant returns false for unknown session", () => {
    expect(shouldApplyVariant("unknown-session")).toBe(false)
  })

  it("shouldApplyVariant returns true for newly created, unapplied session", () => {
    markSessionCreated("sess-1")
    expect(shouldApplyVariant("sess-1")).toBe(true)
  })

  it("shouldApplyVariant returns false after markApplied", () => {
    markSessionCreated("sess-1")
    markApplied("sess-1")
    expect(shouldApplyVariant("sess-1")).toBe(false)
  })

  it("subsequent calls after markApplied are false (no re-injection)", () => {
    markSessionCreated("sess-2")
    expect(shouldApplyVariant("sess-2")).toBe(true)
    markApplied("sess-2")
    expect(shouldApplyVariant("sess-2")).toBe(false)
    expect(shouldApplyVariant("sess-2")).toBe(false)
  })

  it("clearSession removes session from tracking", () => {
    markSessionCreated("sess-3")
    clearSession("sess-3")
    expect(shouldApplyVariant("sess-3")).toBe(false)
  })

  it("clearAll clears all sessions", () => {
    markSessionCreated("sess-a")
    markSessionCreated("sess-b")
    clearAll()
    expect(shouldApplyVariant("sess-a")).toBe(false)
    expect(shouldApplyVariant("sess-b")).toBe(false)
  })
})

describe("keywordDetector", () => {
  it("detects 'ultrawork' keyword case-insensitively", () => {
    expect(detectKeywords("please ULTRAWORK on this")).toHaveLength(1)
    expect(detectKeywords("ultrawork mode").length).toBeGreaterThan(0)
  })

  it("detects 'ulw' shorthand", () => {
    expect(detectKeywords("ulw on this task")).toHaveLength(1)
  })

  it("returns empty array when no keywords found", () => {
    expect(detectKeywords("just a normal message")).toHaveLength(0)
  })

  it("buildKeywordInjection returns undefined for empty detected list", () => {
    expect(buildKeywordInjection([])).toBeUndefined()
  })

  it("buildKeywordInjection returns injection text for detected keywords", () => {
    const detected = detectKeywords("ultrawork on this")
    const injection = buildKeywordInjection(detected)
    expect(injection).toContain("ULTRAWORK MODE")
  })

  it("processMessageForKeywords returns undefined for normal messages", () => {
    expect(processMessageForKeywords("hello world", "sess-1")).toBeUndefined()
  })

  it("processMessageForKeywords returns injection for keyword messages", () => {
    const result = processMessageForKeywords("ultrawork on the feature", "sess-1")
    expect(result).toContain("ULTRAWORK MODE")
  })

  it("custom actions override defaults", () => {
    const custom = [{ keyword: "custom-kw", injection: "CUSTOM INJECTION" }]
    const detected = detectKeywords("custom-kw here", custom)
    expect(detected).toHaveLength(1)
    expect(detected[0].keyword).toBe("custom-kw")
  })
})
