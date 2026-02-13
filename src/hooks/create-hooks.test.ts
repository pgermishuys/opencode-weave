import { describe, it, expect, beforeEach } from "bun:test"
import { createHooks } from "./create-hooks"
import { clearAll } from "./first-message-variant"
import type { WeaveConfig } from "../config/schema"

const baseConfig: WeaveConfig = {}

function allEnabled(_hookName: string): boolean {
  return true
}

function noneEnabled(_hookName: string): boolean {
  return false
}

function disableHook(disabled: string) {
  return (hookName: string) => hookName !== disabled
}

beforeEach(() => {
  clearAll()
})

describe("createHooks", () => {
  it("returns all hook keys when all enabled", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: allEnabled })

    expect(hooks).toHaveProperty("checkContextWindow")
    expect(hooks).toHaveProperty("writeGuard")
    expect(hooks).toHaveProperty("shouldInjectRules")
    expect(hooks).toHaveProperty("getRulesForFile")
    expect(hooks).toHaveProperty("firstMessageVariant")
    expect(hooks).toHaveProperty("processMessageForKeywords")
    expect(hooks).toHaveProperty("verificationReminder")
  })

  it("disabled hooks return null for context-window-monitor", () => {
    const hooks = createHooks({
      pluginConfig: baseConfig,
      isHookEnabled: disableHook("context-window-monitor"),
    })

    expect(hooks.checkContextWindow).toBeNull()
  })

  it("disabled hooks return null for rules-injector", () => {
    const hooks = createHooks({
      pluginConfig: baseConfig,
      isHookEnabled: disableHook("rules-injector"),
    })

    expect(hooks.shouldInjectRules).toBeNull()
    expect(hooks.getRulesForFile).toBeNull()
  })

  it("enabled hooks return non-null values", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: allEnabled })

    expect(hooks.checkContextWindow).not.toBeNull()
    expect(hooks.writeGuard).not.toBeNull()
    expect(hooks.shouldInjectRules).not.toBeNull()
    expect(hooks.getRulesForFile).not.toBeNull()
    expect(hooks.firstMessageVariant).not.toBeNull()
    expect(hooks.processMessageForKeywords).not.toBeNull()
  })

  it("writeGuard is null when write-existing-file-guard disabled", () => {
    const hooks = createHooks({
      pluginConfig: baseConfig,
      isHookEnabled: disableHook("write-existing-file-guard"),
    })

    expect(hooks.writeGuard).toBeNull()
  })

  it("all hooks null when none enabled", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: noneEnabled })

    expect(hooks.checkContextWindow).toBeNull()
    expect(hooks.writeGuard).toBeNull()
    expect(hooks.shouldInjectRules).toBeNull()
    expect(hooks.getRulesForFile).toBeNull()
    expect(hooks.firstMessageVariant).toBeNull()
    expect(hooks.processMessageForKeywords).toBeNull()
  })

  it("firstMessageVariant is null when first-message-variant disabled", () => {
    const hooks = createHooks({
      pluginConfig: baseConfig,
      isHookEnabled: disableHook("first-message-variant"),
    })

    expect(hooks.firstMessageVariant).toBeNull()
  })

  it("checkContextWindow calls through correctly when enabled", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: allEnabled })

    const result = hooks.checkContextWindow!({
      sessionId: "test-session",
      usedTokens: 100,
      maxTokens: 1000,
    })

    expect(result.action).toBe("none")
    expect(result.usagePct).toBeCloseTo(0.1)
  })

  it("verificationReminder exists in returned hooks when all enabled", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: allEnabled })
    expect(hooks).toHaveProperty("verificationReminder")
  })

  it("verificationReminder is null when verification-reminder hook disabled", () => {
    const hooks = createHooks({
      pluginConfig: baseConfig,
      isHookEnabled: disableHook("verification-reminder"),
    })
    expect(hooks.verificationReminder).toBeNull()
  })

  it("verificationReminder is non-null when enabled", () => {
    const hooks = createHooks({ pluginConfig: baseConfig, isHookEnabled: allEnabled })
    expect(hooks.verificationReminder).not.toBeNull()
  })
})
