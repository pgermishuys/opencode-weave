import { describe, it, expect, mock, beforeEach } from "bun:test"
import { createPluginInterface } from "./plugin-interface"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { ToolsRecord } from "./types"
import type { WeaveConfig } from "../config/schema"
import { clearAll } from "../hooks/first-message-variant"

const baseConfig: WeaveConfig = {}

const emptyTools: ToolsRecord = {}

function makeHooks(overrides?: Partial<CreatedHooks>): CreatedHooks {
  return {
    checkContextWindow: null,
    writeGuard: null,
    shouldInjectRules: null,
    getRulesForFile: null,
    firstMessageVariant: null,
    processMessageForKeywords: null,
    ...overrides,
  }
}

function makeMockConfigHandler(): ConfigHandler & { callCount: number } {
  let callCount = 0
  const handler = {
    get callCount() {
      return callCount
    },
    handle: async () => {
      callCount++
      return { agents: {}, tools: [], mcps: {}, commands: {} }
    },
  } as unknown as ConfigHandler & { callCount: number }
  return handler
}

beforeEach(() => {
  clearAll()
})

describe("createPluginInterface", () => {
  it("returns object with all 8 required handler keys", () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const keys = Object.keys(iface)
    expect(keys).toContain("tool")
    expect(keys).toContain("config")
    expect(keys).toContain("chat.message")
    expect(keys).toContain("chat.params")
    expect(keys).toContain("chat.headers")
    expect(keys).toContain("event")
    expect(keys).toContain("tool.execute.before")
    expect(keys).toContain("tool.execute.after")
  })

  it("tool is the tools record passed in", () => {
    const myTools: ToolsRecord = {
      myTool: {
        description: "A test tool",
        parameters: {},
        execute: async () => ({ output: "" }),
      },
    }

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: myTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    expect(iface.tool).toBe(myTools)
  })

  it("each handler (except tool) is a function", () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    expect(typeof iface.config).toBe("function")
    expect(typeof iface["chat.message"]).toBe("function")
    expect(typeof iface["chat.params"]).toBe("function")
    expect(typeof iface["chat.headers"]).toBe("function")
    expect(typeof iface.event).toBe("function")
    expect(typeof iface["tool.execute.before"]).toBe("function")
    expect(typeof iface["tool.execute.after"]).toBe("function")
    expect(typeof iface.tool).toBe("object")
  })

  it("configHandler.handle is called when config handler is invoked", async () => {
    const mockHandler = makeMockConfigHandler()

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: mockHandler,
      agents: {},
    })

    // config receives a Config input — pass an empty object (type-cast for test)
    await iface.config({} as Parameters<typeof iface.config>[0])

    expect(mockHandler.callCount).toBe(1)
  })

  it("config hook sets config.command from configHandler result", async () => {
    const fakeCommands = {
      "start-work": { name: "start-work", description: "test", agent: "tapestry", template: "t" },
    }
    const handler = {
      handle: async () => ({
        agents: {},
        tools: [],
        mcps: {},
        commands: fakeCommands,
      }),
    } as unknown as ConfigHandler
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: handler,
      agents: {},
    })
    const config: Record<string, unknown> = {}
    await iface.config(config as Parameters<typeof iface.config>[0])
    expect(config.command).toEqual(fakeCommands)
  })

  it("chat.message calls firstMessageVariant.markApplied when shouldApplyVariant is true", async () => {
    let markAppliedCalled = false
    let shouldApplyReturn = true

    const hooks = makeHooks({
      firstMessageVariant: {
        shouldApplyVariant: (_sessionID: string) => shouldApplyReturn,
        markApplied: (_sessionID: string) => {
          markAppliedCalled = true
        },
        markSessionCreated: (_sessionID: string) => {},
        clearSession: (_sessionID: string) => {},
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["chat.message"](
      { sessionID: "s1" },
      { message: {} as never, parts: [] },
    )

    expect(markAppliedCalled).toBe(true)
  })

  it("chat.message does not call markApplied when shouldApplyVariant is false", async () => {
    let markAppliedCalled = false

    const hooks = makeHooks({
      firstMessageVariant: {
        shouldApplyVariant: (_sessionID: string) => false,
        markApplied: (_sessionID: string) => {
          markAppliedCalled = true
        },
        markSessionCreated: (_sessionID: string) => {},
        clearSession: (_sessionID: string) => {},
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["chat.message"](
      { sessionID: "s1" },
      { message: {} as never, parts: [] },
    )

    expect(markAppliedCalled).toBe(false)
  })

  it("event handler calls markSessionCreated on session.created event", async () => {
    let createdSessionID = ""

    const hooks = makeHooks({
      firstMessageVariant: {
        shouldApplyVariant: (_sessionID: string) => false,
        markApplied: (_sessionID: string) => {},
        markSessionCreated: (sessionID: string) => {
          createdSessionID = sessionID
        },
        clearSession: (_sessionID: string) => {},
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const event = {
      type: "session.created" as const,
      properties: { info: { id: "sess-abc", projectID: "p1", directory: "/", title: "t", version: "1", time: { created: 0, updated: 0 } } },
    }

    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(createdSessionID).toBe("sess-abc")
  })

  it("tool.execute.before tracks file reads via writeGuard", async () => {
    const tracked: string[] = []

    const hooks = makeHooks({
      writeGuard: {
        trackRead: (filePath: string) => { tracked.push(filePath) },
        checkWrite: (_filePath: string) => ({ allowed: true }),
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["tool.execute.before"](
      { tool: "read", sessionID: "s1", callID: "c1" },
      { args: { file_path: "/some/file.ts" } },
    )

    expect(tracked).toEqual(["/some/file.ts"])
  })
})
