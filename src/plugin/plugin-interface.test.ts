import { describe, it, expect, mock, beforeEach } from "bun:test"
import * as fs from "fs"
import { createPluginInterface } from "./plugin-interface"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { ToolsRecord } from "./types"
import type { WeaveConfig } from "../config/schema"
import { clearAll } from "../hooks/first-message-variant"
import { getLogFilePath } from "../shared/log"

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
    patternMdOnly: null,
    startWork: null,
    workContinuation: null,
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
  // Clear log file before each test so delegation log assertions are isolated
  const logFile = getLogFilePath()
  if (fs.existsSync(logFile)) fs.writeFileSync(logFile, "")
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

  it("chat.message injects start-work context into existing text part in-place", async () => {
    const hooks = makeHooks({
      startWork: (_promptText: string, _sessionId: string) => ({
        contextInjection: "## Starting Plan: my-plan\n**Progress**: 0/5 tasks completed",
        switchAgent: "tapestry",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const parts = [
      { type: "text", text: "<session-context>Session ID: s1</session-context>" },
    ]
    const message: Record<string, unknown> = { agent: "Loom (Main Orchestrator)" }
    const output = { message: message as never, parts }

    await iface["chat.message"]({ sessionID: "s1" }, output)

    // Context should be appended to the SAME part object (in-place mutation)
    expect(parts[0].text).toContain("## Starting Plan: my-plan")
    expect(parts[0].text).toContain("---")
    // Should NOT have created a new part
    expect(parts.length).toBe(1)
    // Agent should be switched to Tapestry display name
    expect(message.agent).toBe("Tapestry (Execution Orchestrator)")
  })

  it("chat.message does not modify parts when startWork returns null contextInjection", async () => {
    const hooks = makeHooks({
      startWork: (_promptText: string, _sessionId: string) => ({
        contextInjection: null,
        switchAgent: null,
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const originalText = "Hello world"
    const parts = [{ type: "text", text: originalText }]
    const message: Record<string, unknown> = { agent: "Loom (Main Orchestrator)" }
    const output = { message: message as never, parts }

    await iface["chat.message"]({ sessionID: "s1" }, output)

    expect(parts[0].text).toBe(originalText)
    expect(parts.length).toBe(1)
    // Agent should NOT be changed when switchAgent is null
    expect(message.agent).toBe("Loom (Main Orchestrator)")
  })

  it("chat.message substitutes $SESSION_ID and $TIMESTAMP in text parts before passing to startWork", async () => {
    let receivedPromptText = ""
    const hooks = makeHooks({
      startWork: (promptText: string, _sessionId: string) => {
        receivedPromptText = promptText
        return { contextInjection: null, switchAgent: null }
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const parts = [
      { type: "text", text: "<session-context>Session ID: $SESSION_ID  Timestamp: $TIMESTAMP</session-context>" },
    ]
    const message: Record<string, unknown> = {}
    const output = { message: message as never, parts }

    await iface["chat.message"]({ sessionID: "sess_abc123" }, output)

    // $SESSION_ID should be replaced with the actual session ID
    expect(receivedPromptText).toContain("sess_abc123")
    expect(receivedPromptText).not.toContain("$SESSION_ID")
    // $TIMESTAMP should be replaced with an ISO timestamp
    expect(receivedPromptText).not.toContain("$TIMESTAMP")
    // The text part itself should also be mutated
    expect(parts[0].text).toContain("sess_abc123")
    expect(parts[0].text).not.toContain("$SESSION_ID")
  })

  it("chat.message pushes a new text part when context injection has no existing text part to append to", async () => {
    const hooks = makeHooks({
      startWork: (_promptText: string, _sessionId: string) => ({
        contextInjection: "## Starting Plan: test\n**Progress**: 0/3",
        switchAgent: "tapestry",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    // Parts with no text parts (only non-text types)
    const parts: Array<{ type: string; text?: string }> = [
      { type: "image", text: undefined },
    ]
    const message: Record<string, unknown> = {}
    const output = { message: message as never, parts }

    await iface["chat.message"]({ sessionID: "s1" }, output)

    // Should have pushed a new text part
    expect(parts.length).toBe(2)
    expect(parts[1].type).toBe("text")
    expect(parts[1].text).toContain("Starting Plan: test")
  })

  it("event handler calls client.session.promptAsync when workContinuation returns a continuationPrompt", async () => {
    const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []

    const mockClient = {
      session: {
        promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
          promptAsyncCalls.push(opts)
        },
      },
    } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

    const hooks = makeHooks({
      workContinuation: (_sessionId: string) => ({
        continuationPrompt: "Continue working on your plan.",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      client: mockClient,
    })

    const event = { type: "session.idle", properties: { sessionID: "sess-idle-1" } }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(promptAsyncCalls.length).toBe(1)
    expect(promptAsyncCalls[0].path.id).toBe("sess-idle-1")
    expect(promptAsyncCalls[0].body.parts[0].text).toBe("Continue working on your plan.")
  })

  it("event handler does not throw when client is absent and continuationPrompt is set", async () => {
    const hooks = makeHooks({
      workContinuation: (_sessionId: string) => ({
        continuationPrompt: "Continue working on your plan.",
      }),
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      // no client
    })

    const event = { type: "session.idle", properties: { sessionID: "sess-no-client" } }
    // Should not throw
    await expect(iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })).resolves.toBeUndefined()
  })
})

describe("delegation logging via tool hooks", () => {
  const logFile = getLogFilePath()

  it("tool.execute.before logs delegation:start when tool is 'task'", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["tool.execute.before"](
      { tool: "task", sessionID: "s1", callID: "c1" },
      { args: { description: "explore auth module" } },
    )

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:start]")
    expect(content).toContain("agent=explore auth module")
    expect(content).toContain('"sessionId":"s1"')
    expect(content).toContain('"toolCallId":"c1"')
  })

  it("tool.execute.before does not log delegation for non-task tools", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["tool.execute.before"](
      { tool: "read", sessionID: "s1", callID: "c2" },
      { args: { file_path: "/some/file.ts" } },
    )

    const content = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : ""
    expect(content).not.toContain("[delegation:start]")
  })

  it("tool.execute.after logs delegation:complete when tool is 'task'", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["tool.execute.after"](
      { tool: "task", sessionID: "s2", callID: "c3", args: { agent: "thread" } } as Parameters<typeof iface["tool.execute.after"]>[0],
      {},
    )

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:complete]")
    expect(content).toContain("agent=thread")
    expect(content).toContain('"sessionId":"s2"')
  })
})
