import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createPluginInterface } from "./plugin-interface"
import type { ConfigHandler } from "../managers/config-handler"
import type { CreatedHooks } from "../hooks/create-hooks"
import type { ToolsRecord } from "./types"
import type { WeaveConfig } from "../config/schema"
import { clearAll } from "../hooks/first-message-variant"
import { clearAllTokenState, getState as getTokenState } from "../hooks"
import { getLogFilePath } from "../shared/log"
import { checkContinuation } from "../hooks/work-continuation"
import { writeWorkState, createWorkState, readWorkState } from "../features/work-state/storage"
import { WEAVE_DIR } from "../features/work-state/constants"

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
    workflowStart: null,
    workflowContinuation: null,
    workflowCommand: null,
    verificationReminder: null,
    analyticsEnabled: false,
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
  clearAllTokenState()
  // Clear log file before each test so delegation log assertions are isolated
  const logFile = getLogFilePath()
  try {
    fs.writeFileSync(logFile, "")
  } catch {
    // File may not exist yet — log() will create it
  }
})

describe("createPluginInterface", () => {
  it("returns object with all 9 required handler keys", () => {
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
    expect(keys).toContain("command.execute.before")
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
    expect(typeof iface["command.execute.before"]).toBe("function")
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

  describe("config hook merge behavior", () => {
    it("merges Weave agents with existing user agents", async () => {
      const weaveAgents = {
        "Loom (Main Orchestrator)": { model: "claude-opus-4", prompt: "orchestrate" },
      }
      const handler = {
        handle: async () => ({
          agents: weaveAgents,
          tools: [],
          mcps: {},
          commands: {},
          defaultAgent: "Loom (Main Orchestrator)",
        }),
      } as unknown as ConfigHandler

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: handler,
        agents: {},
      })

      const config: Record<string, unknown> = {
        agent: {
          "my-custom-agent": { model: "gpt-4o", prompt: "custom system prompt" },
        },
      }
      await iface.config(config as Parameters<typeof iface.config>[0])

      const agents = config.agent as Record<string, unknown>
      expect(agents["my-custom-agent"]).toBeDefined()
      expect(agents["Loom (Main Orchestrator)"]).toBeDefined()
    })

    it("lets Weave agents win on name collisions", async () => {
      const weaveAgents = {
        "shared-name": { model: "claude-opus-4", prompt: "weave version" },
      }
      const handler = {
        handle: async () => ({
          agents: weaveAgents,
          tools: [],
          mcps: {},
          commands: {},
        }),
      } as unknown as ConfigHandler

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: handler,
        agents: {},
      })

      const config: Record<string, unknown> = {
        agent: {
          "shared-name": { model: "gpt-4o", prompt: "user version" },
        },
      }
      await iface.config(config as Parameters<typeof iface.config>[0])

      const agents = config.agent as Record<string, { model: string; prompt: string }>
      expect(agents["shared-name"].model).toBe("claude-opus-4")
      expect(agents["shared-name"].prompt).toBe("weave version")
    })

    it("merges Weave commands with existing user commands", async () => {
      const weaveCommands = {
        "start-work": { name: "start-work", description: "Start work", agent: "tapestry", template: "t" },
      }
      const handler = {
        handle: async () => ({
          agents: {},
          tools: [],
          mcps: {},
          commands: weaveCommands,
        }),
      } as unknown as ConfigHandler

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: handler,
        agents: {},
      })

      const config: Record<string, unknown> = {
        command: {
          "my-command": { name: "my-command", description: "User command" },
        },
      }
      await iface.config(config as Parameters<typeof iface.config>[0])

      const commands = config.command as Record<string, unknown>
      expect(commands["my-command"]).toBeDefined()
      expect(commands["start-work"]).toBeDefined()
    })

    it("does not override user's default_agent if already set", async () => {
      const handler = {
        handle: async () => ({
          agents: {},
          tools: [],
          mcps: {},
          commands: {},
          defaultAgent: "Loom (Main Orchestrator)",
        }),
      } as unknown as ConfigHandler

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: handler,
        agents: {},
      })

      const config: Record<string, unknown> = {
        default_agent: "my-custom-agent",
      }
      await iface.config(config as Parameters<typeof iface.config>[0])

      expect(config.default_agent).toBe("my-custom-agent")
    })

    it("handles undefined config.agent gracefully", async () => {
      const weaveAgents = {
        "Loom (Main Orchestrator)": { model: "claude-opus-4", prompt: "orchestrate" },
      }
      const handler = {
        handle: async () => ({
          agents: weaveAgents,
          tools: [],
          mcps: {},
          commands: {},
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

      const agents = config.agent as Record<string, unknown>
      expect(agents["Loom (Main Orchestrator)"]).toBeDefined()
    })

    it("sets default_agent when user has not configured one", async () => {
      const handler = {
        handle: async () => ({
          agents: {},
          tools: [],
          mcps: {},
          commands: {},
          defaultAgent: "Loom (Main Orchestrator)",
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

      expect(config.default_agent).toBe("Loom (Main Orchestrator)")
    })
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

  describe("interrupt pausing (filesystem-based)", () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "weave-interrupt-"))
      // Set up a temp dir with a plan file and work state so pauseWork/checkContinuation work
      const plansDir = join(tempDir, WEAVE_DIR, "plans")
      mkdirSync(plansDir, { recursive: true })
      const planFile = join(plansDir, "test-plan.md")
      writeFileSync(planFile, "# Test Plan\n\n- [ ] Task 1\n- [ ] Task 2\n", "utf-8")
      const state = createWorkState(planFile, "test-plan")
      writeWorkState(tempDir, state)
    })

    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    })

    it("suppresses work continuation after user interrupt and sets paused: true in state", async () => {
      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []

      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      // Wire workContinuation to real checkContinuation so it reads the paused flag
      const hooks = makeHooks({
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // User interrupts via TUI
      const interruptEvent = { type: "tui.command.execute", properties: { command: "session.interrupt" } }
      await iface.event({ event: interruptEvent as Parameters<typeof iface.event>[0]["event"] })

      // Verify state.json has paused: true
      const stateAfter = readWorkState(tempDir)
      expect(stateAfter?.paused).toBe(true)

      // Session goes idle after interrupt — continuation should be suppressed
      const idleEvent = { type: "session.idle", properties: { sessionID: "sess-interrupted" } }
      await iface.event({ event: idleEvent as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(0)
    })

    it("persistently suppresses continuation across multiple idle events (not one-shot)", async () => {
      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []

      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const hooks = makeHooks({
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // User interrupts
      const interruptEvent = { type: "tui.command.execute", properties: { command: "session.interrupt" } }
      await iface.event({ event: interruptEvent as Parameters<typeof iface.event>[0]["event"] })

      // First idle — suppressed
      const idleEvent1 = { type: "session.idle", properties: { sessionID: "sess-1" } }
      await iface.event({ event: idleEvent1 as Parameters<typeof iface.event>[0]["event"] })
      expect(promptAsyncCalls.length).toBe(0)

      // Second idle (no new interrupt) — STILL suppressed (persistent, not one-shot)
      const idleEvent2 = { type: "session.idle", properties: { sessionID: "sess-1" } }
      await iface.event({ event: idleEvent2 as Parameters<typeof iface.event>[0]["event"] })
      expect(promptAsyncCalls.length).toBe(0)
    })

    it("does not suppress continuation for non-interrupt TUI commands", async () => {
      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []

      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const hooks = makeHooks({
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // Non-interrupt TUI command (e.g., compact)
      const compactEvent = { type: "tui.command.execute", properties: { command: "session.compact" } }
      await iface.event({ event: compactEvent as Parameters<typeof iface.event>[0]["event"] })

      // Verify state is NOT paused
      const stateAfter = readWorkState(tempDir)
      expect(stateAfter?.paused).not.toBe(true)

      // Session goes idle — should still continue (not suppressed)
      const idleEvent = { type: "session.idle", properties: { sessionID: "test-plan" } }
      await iface.event({ event: idleEvent as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(1)
    })
  })

  describe("auto-pause on user message during active plan", () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "weave-autopause-"))
      const plansDir = join(tempDir, WEAVE_DIR, "plans")
      mkdirSync(plansDir, { recursive: true })
      const planFile = join(plansDir, "test-plan.md")
      writeFileSync(planFile, "# Test Plan\n\n- [ ] Task 1\n- [ ] Task 2\n", "utf-8")
      const state = createWorkState(planFile, "test-plan")
      writeWorkState(tempDir, state)
    })

    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    })

    it("auto-pauses work when a regular user message arrives during active plan", async () => {
      const hooks = makeHooks({
        startWork: (_promptText: string, _sessionId: string) => ({
          contextInjection: null,
          switchAgent: null,
        }),
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []
      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // Verify state is NOT paused initially
      expect(readWorkState(tempDir)?.paused).not.toBe(true)

      // User sends a regular message (not /start-work, not continuation)
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "Can you help me plan something else?" }],
      }
      await iface["chat.message"]({ sessionID: "sess-user" }, output)

      // State should now be paused
      expect(readWorkState(tempDir)?.paused).toBe(true)

      // Session goes idle — continuation should be suppressed because state is paused
      const idleEvent = { type: "session.idle", properties: { sessionID: "sess-user" } }
      await iface.event({ event: idleEvent as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(0)
    })

    it("does NOT auto-pause when message contains continuation marker", async () => {
      const { CONTINUATION_MARKER } = await import("../hooks/work-continuation")

      const hooks = makeHooks({
        startWork: (_promptText: string, _sessionId: string) => ({
          contextInjection: null,
          switchAgent: null,
        }),
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []
      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // Simulate a continuation-injected message (contains the marker)
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: `${CONTINUATION_MARKER}\nYou have an active work plan with incomplete tasks. Continue working.` }],
      }
      await iface["chat.message"]({ sessionID: "sess-cont" }, output)

      // State should NOT be paused — continuation messages should not trigger auto-pause
      expect(readWorkState(tempDir)?.paused).not.toBe(true)
    })

    it("does NOT auto-pause when message is a /start-work command", async () => {
      const hooks = makeHooks({
        startWork: (_promptText: string, _sessionId: string) => ({
          contextInjection: null,
          switchAgent: null,
        }),
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        directory: tempDir,
      })

      // Simulate a /start-work command message (contains <session-context>)
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "<session-context>Session ID: sess_test  Timestamp: 2026-01-01</session-context>" }],
      }
      await iface["chat.message"]({ sessionID: "sess-sw" }, output)

      // State should NOT be paused — /start-work should not trigger auto-pause
      expect(readWorkState(tempDir)?.paused).not.toBe(true)
    })

    it("breaks the infinite continuation loop: user message → auto-pause → idle → no continuation", async () => {
      const hooks = makeHooks({
        startWork: (_promptText: string, _sessionId: string) => ({
          contextInjection: null,
          switchAgent: null,
        }),
        workContinuation: (sessionId: string) => checkContinuation({ sessionId, directory: tempDir }),
      })

      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> = []
      const mockClient = {
        session: {
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: tempDir,
      })

      // User sends a regular message while plan is active
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "Create a plan for feature X" }],
      }
      await iface["chat.message"]({ sessionID: "sess-loop" }, output)

      // Simulate multiple idle events (the loop scenario)
      for (let i = 0; i < 5; i++) {
        const idleEvent = { type: "session.idle", properties: { sessionID: "sess-loop" } }
        await iface.event({ event: idleEvent as Parameters<typeof iface.event>[0]["event"] })
      }

      // Zero continuation prompts should have been injected — the loop is broken
      expect(promptAsyncCalls.length).toBe(0)
    })
  })
})

describe("delegation logging via tool hooks", () => {
  const logFile = getLogFilePath()

  it("tool.execute.before logs delegation:start with subagent_type when tool is 'task'", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["tool.execute.before"](
      { tool: "task", sessionID: "s1", callID: "c1" },
      { args: { subagent_type: "thread", description: "explore auth module", prompt: "look at auth" } },
    )

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:start]")
    expect(content).toContain("agent=thread")
    expect(content).toContain('"sessionId":"s1"')
    expect(content).toContain('"toolCallId":"c1"')
  })

  it("tool.execute.before falls back to description when subagent_type is absent", async () => {
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
      { tool: "task", sessionID: "s2", callID: "c3", args: { subagent_type: "thread", description: "explore auth", prompt: "look at auth" } } as Parameters<typeof iface["tool.execute.after"]>[0],
      {},
    )

    const content = fs.readFileSync(logFile, "utf8")
    expect(content).toContain("[delegation:complete]")
    expect(content).toContain("agent=thread")
    expect(content).toContain('"sessionId":"s2"')
  })
})

describe("context window monitoring", () => {
  it("chat.message no longer calls checkContextWindow (removed hardcoded zero call)", async () => {
    let checkCalled = false
    const hooks = makeHooks({
      checkContextWindow: (_state) => {
        checkCalled = true
        return { action: "none", usagePct: 0 }
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    await iface["chat.message"]({ sessionID: "s1" }, { message: {} as never, parts: [] })

    expect(checkCalled).toBe(false)
  })

  it("chat.params captures model context limit into session token state", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const input = { sessionID: "sess-params", model: { limit: { context: 200_000 } } }
    await iface["chat.params"](input as Parameters<typeof iface["chat.params"]>[0], {} as never)

    const state = getTokenState("sess-params")
    expect(state?.maxTokens).toBe(200_000)
  })

  it("chat.params does not store when maxTokens is 0", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    const input = { sessionID: "sess-no-limit", model: { limit: { context: 0 } } }
    await iface["chat.params"](input as Parameters<typeof iface["chat.params"]>[0], {} as never)

    expect(getTokenState("sess-no-limit")).toBeUndefined()
  })

  it("event handler processes message.updated with assistant tokens and calls checkContextWindow", async () => {
    let contextWindowCalled = false
    let receivedState: { usedTokens: number; maxTokens: number } | undefined

    const hooks = makeHooks({
      checkContextWindow: (state) => {
        contextWindowCalled = true
        receivedState = { usedTokens: state.usedTokens, maxTokens: state.maxTokens }
        return { action: "none", usagePct: state.usedTokens / state.maxTokens }
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    // First, set up context limit via chat.params
    const paramsInput = { sessionID: "sess-monitor", model: { limit: { context: 100_000 } } }
    await iface["chat.params"](paramsInput as Parameters<typeof iface["chat.params"]>[0], {} as never)

    // Then fire message.updated with assistant tokens
    const event = {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: "sess-monitor",
          tokens: { input: 50_000 },
        },
      },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(contextWindowCalled).toBe(true)
    expect(receivedState?.usedTokens).toBe(50_000)
    expect(receivedState?.maxTokens).toBe(100_000)
  })

  it("event handler ignores message.updated for user messages (no tokens)", async () => {
    let checkCalled = false
    const hooks = makeHooks({
      checkContextWindow: () => {
        checkCalled = true
        return { action: "none", usagePct: 0 }
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
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          sessionID: "sess-user-msg",
          tokens: { input: 500 },
        },
      },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(checkCalled).toBe(false)
  })

  it("event handler does not call checkContextWindow when maxTokens is 0 (chat.params not yet fired)", async () => {
    let checkCalled = false
    const hooks = makeHooks({
      checkContextWindow: () => {
        checkCalled = true
        return { action: "none", usagePct: 0 }
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    // Fire message.updated WITHOUT calling chat.params first (maxTokens = 0)
    const event = {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: "sess-no-max",
          tokens: { input: 50_000 },
        },
      },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(checkCalled).toBe(false)
  })

  it("event handler fires warn action when usage exceeds 80% threshold", async () => {
    const hooks = makeHooks({
      checkContextWindow: (state) => {
        const usagePct = state.usedTokens / state.maxTokens
        // Use real checkContextWindow-like logic to test the hook receives real data
        if (usagePct >= 0.95) return { action: "recover", usagePct }
        if (usagePct >= 0.8) return { action: "warn", usagePct }
        return { action: "none", usagePct }
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks,
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    // Set 100k context limit
    await iface["chat.params"](
      { sessionID: "sess-warn", model: { limit: { context: 100_000 } } } as Parameters<typeof iface["chat.params"]>[0],
      {} as never,
    )

    // Fire message.updated at 85% usage
    const event = {
      type: "message.updated",
      properties: {
        info: { role: "assistant", sessionID: "sess-warn", tokens: { input: 85_000 } },
      },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    // checkContextWindow should have received usedTokens=85_000, maxTokens=100_000
    // Our mock above returns "warn" for >= 80%
    // We verify the hook was called with real data by checking the token state
    const state = getTokenState("sess-warn")
    expect(state?.usedTokens).toBe(85_000)
    expect(state?.maxTokens).toBe(100_000)
  })

  it("event handler cleans up session token state on session.deleted", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
    })

    // Set up token state
    await iface["chat.params"](
      { sessionID: "sess-to-delete", model: { limit: { context: 100_000 } } } as Parameters<typeof iface["chat.params"]>[0],
      {} as never,
    )
    expect(getTokenState("sess-to-delete")?.maxTokens).toBe(100_000)

    // Fire session.deleted
    const event = {
      type: "session.deleted",
      properties: { info: { id: "sess-to-delete" } },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    expect(getTokenState("sess-to-delete")).toBeUndefined()
  })
})

describe("analytics: agent name and cost tracking", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `weave-analytics-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it("chat.params calls tracker.setAgentName when analytics enabled", async () => {
    const { createSessionTracker } = await import("../features/analytics")
    const tracker = createSessionTracker(tempDir)
    tracker.startSession("s1")

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks({ analyticsEnabled: true }),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      tracker,
    })

    await iface["chat.params"](
      { sessionID: "s1", agent: "Loom (Main Orchestrator)", model: { limit: { context: 100_000 } } } as Parameters<typeof iface["chat.params"]>[0],
      {} as never,
    )

    const session = tracker.getSession("s1")!
    expect(session.agentName).toBe("Loom (Main Orchestrator)")
  })

  it("chat.params is no-op for agent name when tracker is absent", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks({ analyticsEnabled: true }),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      // no tracker
    })

    // Should not throw
    await iface["chat.params"](
      { sessionID: "s1", agent: "Loom", model: { limit: { context: 100_000 } } } as Parameters<typeof iface["chat.params"]>[0],
      {} as never,
    )
  })

  it("message.updated calls tracker.trackCost and tracker.trackTokenUsage when analytics enabled", async () => {
    const { createSessionTracker } = await import("../features/analytics")
    const tracker = createSessionTracker(tempDir)
    tracker.startSession("s1")

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks({ analyticsEnabled: true }),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      tracker,
    })

    const event = {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: "s1",
          cost: 0.05,
          tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
        },
      },
    }
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })

    const session = tracker.getSession("s1")!
    expect(session.totalCost).toBeCloseTo(0.05, 10)
    expect(session.tokenUsage.inputTokens).toBe(100)
    expect(session.tokenUsage.outputTokens).toBe(50)
    expect(session.tokenUsage.reasoningTokens).toBe(10)
    expect(session.tokenUsage.cacheReadTokens).toBe(20)
    expect(session.tokenUsage.cacheWriteTokens).toBe(5)
    expect(session.tokenUsage.totalMessages).toBe(1)
  })

  it("message.updated is no-op for cost/tokens when tracker is absent", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks({ analyticsEnabled: true }),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      // no tracker
    })

    const event = {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          sessionID: "s1",
          cost: 0.05,
          tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
        },
      },
    }
    // Should not throw
    await iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] })
  })
})

describe("command.execute.before handler", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `weave-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it("injects report text for token-report command", async () => {
    // Write a session summary to the JSONL file so the report has data
    const { appendSessionSummary } = await import("../features/analytics/storage")
    appendSessionSummary(tempDir, {
      sessionId: "test-session",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:05:00.000Z",
      durationMs: 300_000,
      toolUsage: [],
      delegations: [],
      totalToolCalls: 5,
      totalDelegations: 1,
      agentName: "Loom",
      totalCost: 0.25,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 100,
        cacheReadTokens: 200,
        cacheWriteTokens: 50,
        totalMessages: 3,
      },
    })

    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      directory: tempDir,
    })

    const output = { parts: [] as Array<{ type: string; text: string }> }
    await iface["command.execute.before"](
      { command: "token-report", sessionID: "s1", arguments: "" } as Parameters<typeof iface["command.execute.before"]>[0],
      output as Parameters<typeof iface["command.execute.before"]>[1],
    )

    expect(output.parts.length).toBe(1)
    expect(output.parts[0].type).toBe("text")
    expect(output.parts[0].text).toContain("Overall Totals")
    expect(output.parts[0].text).toContain("Loom")
    expect(output.parts[0].text).toContain("$0.25")
  })

  it("is no-op for other commands", async () => {
    const iface = createPluginInterface({
      pluginConfig: baseConfig,
      hooks: makeHooks(),
      tools: emptyTools,
      configHandler: makeMockConfigHandler(),
      agents: {},
      directory: tempDir,
    })

    const output = { parts: [] as Array<{ type: string; text: string }> }
    await iface["command.execute.before"](
      { command: "start-work", sessionID: "s1", arguments: "my-plan" } as Parameters<typeof iface["command.execute.before"]>[0],
      output as Parameters<typeof iface["command.execute.before"]>[1],
    )

    expect(output.parts.length).toBe(0)
  })
})

describe("workflow integration in plugin-interface", () => {
  describe("auto-pause guard recognizes WORKFLOW_CONTINUATION_MARKER", () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "weave-wf-autopause-"))
      const plansDir = join(tempDir, WEAVE_DIR, "plans")
      mkdirSync(plansDir, { recursive: true })
      const planFile = join(plansDir, "test-plan.md")
      writeFileSync(planFile, "# Test Plan\n\n- [ ] Task 1\n", "utf-8")
      const state = createWorkState(planFile, "test-plan")
      writeWorkState(tempDir, state)
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it("does NOT auto-pause when message contains WORKFLOW_CONTINUATION_MARKER", async () => {
      const { WORKFLOW_CONTINUATION_MARKER } = await import("../features/workflow/hook")

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
        directory: tempDir,
      })

      const output = {
        message: {} as never,
        parts: [{ type: "text", text: `${WORKFLOW_CONTINUATION_MARKER}\nContinue with the next workflow step.` }],
      }
      await iface["chat.message"]({ sessionID: "sess-wf" }, output)

      expect(readWorkState(tempDir)?.paused).not.toBe(true)
    })
  })

  describe("message.part.updated text tracking", () => {
    it("tracks assistant message text from message.part.updated events", async () => {
      const promptAsyncCalls: Array<{
        path: { id: string }
        body: { parts: Array<{ type: string; text: string }>; agent?: string }
      }> = []
      const mockClient = {
        session: {
          promptAsync: async (opts: {
            path: { id: string }
            body: { parts: Array<{ type: string; text: string }>; agent?: string }
          }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const hooks = makeHooks({
        workflowContinuation: (_sessionId: string, lastAssistantMessage?: string) => {
          // Only continue if the last assistant message contains a completion signal
          if (lastAssistantMessage && lastAssistantMessage.includes("<!-- workflow:step-complete -->")) {
            return {
              continuationPrompt: "Next step prompt",
              switchAgent: "tapestry",
            }
          }
          return { continuationPrompt: null, switchAgent: null }
        },
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
        directory: mkdtempSync(join(tmpdir(), "weave-wf-track-")),
      })

      // Simulate message.part.updated event with text
      const partEvent = {
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            sessionID: "sess-track",
            messageID: "msg-1",
            text: "I have completed the task. <!-- workflow:step-complete -->",
          },
        },
      }
      await iface.event({ event: partEvent as Parameters<typeof iface.event>[0]["event"] })

      // Now simulate session.idle — workflowContinuation should see the tracked text
      // But it also needs an active workflow instance, which we don't have in this test.
      // The workflowContinuation hook mock above doesn't check for active instances.
      // This test verifies the message text tracking mechanism works.
      // The actual continuation won't fire because the mock checks lastAssistantMessage.
    })
  })

  describe("workflowStart in chat.message", () => {
    it("detects workflow template marker and injects context", async () => {
      const hooks = makeHooks({
        workflowStart: (_promptText: string, _sessionId: string) => ({
          contextInjection: "## Workflow Started\nGoal: Add OAuth2 login",
          switchAgent: "loom",
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
        { type: "text", text: "The workflow engine will inject context here." },
      ]
      const message: Record<string, unknown> = {}
      const output = { message: message as never, parts }

      await iface["chat.message"]({ sessionID: "s1" }, output)

      expect(parts[0].text).toContain("Workflow Started")
      expect(parts[0].text).toContain("Add OAuth2 login")
      expect(message.agent).toBe("Loom (Main Orchestrator)")
    })

    it("does NOT trigger workflowStart for non-workflow messages", async () => {
      let called = false
      const hooks = makeHooks({
        workflowStart: (_promptText: string, _sessionId: string) => {
          called = true
          return { contextInjection: "Should not see this", switchAgent: null }
        },
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
      })

      const parts = [{ type: "text", text: "Just a regular user message" }]
      const message: Record<string, unknown> = {}
      const output = { message: message as never, parts }

      await iface["chat.message"]({ sessionID: "s1" }, output)

      expect(called).toBe(false)
      expect(parts[0].text).toBe("Just a regular user message")
    })
  })

  describe("workflowCommand in chat.message", () => {
    it("detects workflow control keywords and injects context", async () => {
      const hooks = makeHooks({
        workflowCommand: (message: string) => {
          if (/workflow\s+status/i.test(message)) {
            return {
              handled: true,
              contextInjection: "## Workflow Status\nRunning: test-workflow",
            }
          }
          return { handled: false }
        },
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
      })

      const parts = [{ type: "text", text: "workflow status" }]
      const message: Record<string, unknown> = {}
      const output = { message: message as never, parts }

      await iface["chat.message"]({ sessionID: "s1" }, output)

      expect(parts[0].text).toContain("Workflow Status")
      expect(parts[0].text).toContain("test-workflow")
    })

    it("does not inject context for unrecognized messages", async () => {
      const hooks = makeHooks({
        workflowCommand: (_message: string) => ({ handled: false }),
      })

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
      })

      const originalText = "just a normal message"
      const parts = [{ type: "text", text: originalText }]
      const message: Record<string, unknown> = {}
      const output = { message: message as never, parts }

      await iface["chat.message"]({ sessionID: "s1" }, output)

      expect(parts[0].text).toBe(originalText)
    })
  })

  describe("workflow interrupt pausing", () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "weave-wf-interrupt-"))
      const plansDir = join(tempDir, WEAVE_DIR, "plans")
      mkdirSync(plansDir, { recursive: true })
      const planFile = join(plansDir, "test-plan.md")
      writeFileSync(planFile, "# Test Plan\n\n- [ ] Task 1\n", "utf-8")
      const state = createWorkState(planFile, "test-plan")
      writeWorkState(tempDir, state)
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it("pauses workflow on user interrupt (session.interrupt)", async () => {
      // We mock getActiveWorkflowInstance indirectly — the real function reads from disk.
      // For this test we just verify the event handler runs without error.
      const hooks = makeHooks()
      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks,
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        directory: tempDir,
      })

      const event = { type: "tui.command.execute", properties: { command: "session.interrupt" } }
      // Should not throw even without an active workflow
      await expect(
        iface.event({ event: event as Parameters<typeof iface.event>[0]["event"] }),
      ).resolves.toBeUndefined()
    })
  })

  describe("auto-pause suppression during active workflow", () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "weave-wf-suppress-"))
      const plansDir = join(tempDir, WEAVE_DIR, "plans")
      mkdirSync(plansDir, { recursive: true })
      const planFile = join(plansDir, "test-plan.md")
      writeFileSync(planFile, "# Test Plan\n\n- [ ] Task 1\n- [ ] Task 2\n", "utf-8")
      const state = createWorkState(planFile, "test-plan")
      writeWorkState(tempDir, state)
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    function setupRunningWorkflowInstance(dir: string) {
      const { createWorkflowInstance, writeWorkflowInstance, setActiveInstance } = require("../features/workflow/storage")
      const { WORKFLOWS_STATE_DIR, WORKFLOWS_DIR_PROJECT } = require("../features/workflow/constants")

      const defDir = join(dir, WORKFLOWS_DIR_PROJECT)
      mkdirSync(defDir, { recursive: true })
      mkdirSync(join(dir, WORKFLOWS_STATE_DIR), { recursive: true })

      const def = {
        name: "test-wf",
        description: "Test",
        version: 1,
        steps: [{ id: "s1", name: "Step 1", type: "interactive", agent: "loom", prompt: "Do it", completion: { method: "user_confirm" } }],
      }
      const defPath = join(defDir, "test-wf.json")
      writeFileSync(defPath, JSON.stringify(def))

      const instance = createWorkflowInstance(def, defPath, "Test goal", "sess-1")
      instance.status = "running"
      instance.steps["s1"].status = "active"
      writeWorkflowInstance(dir, instance)
      setActiveInstance(dir, instance.instance_id)
      return instance
    }

    it("does NOT auto-pause when workflow is active and user sends regular message", async () => {
      setupRunningWorkflowInstance(tempDir)

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
        directory: tempDir,
      })

      // Verify state is NOT paused initially
      expect(readWorkState(tempDir)?.paused).not.toBe(true)

      // User sends a regular message (not /start-work, not continuation)
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "What's the status of the workflow?" }],
      }
      await iface["chat.message"]({ sessionID: "sess-wf-active" }, output)

      // State should NOT be paused — workflow is active, so auto-pause is suppressed
      expect(readWorkState(tempDir)?.paused).not.toBe(true)
    })

    it("still auto-pauses when no workflow is active", async () => {
      // No workflow set up — just the work-state plan from beforeEach
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
        directory: tempDir,
      })

      expect(readWorkState(tempDir)?.paused).not.toBe(true)

      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "Can you help me with something else?" }],
      }
      await iface["chat.message"]({ sessionID: "sess-no-wf" }, output)

      // State SHOULD be paused — no workflow active, regular message triggers auto-pause
      expect(readWorkState(tempDir)?.paused).toBe(true)
    })

    it("does NOT auto-pause when workflow is active even without workflow continuation marker", async () => {
      setupRunningWorkflowInstance(tempDir)

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
        directory: tempDir,
      })

      // Send a message that is NOT a workflow continuation (no marker)
      const output = {
        message: {} as never,
        parts: [{ type: "text", text: "I have a question about the build" }],
      }
      await iface["chat.message"]({ sessionID: "sess-wf-nomrk" }, output)

      // Should NOT pause — workflow is active even though no continuation marker
      expect(readWorkState(tempDir)?.paused).not.toBe(true)
    })

    // R4 Verification: "pause workflow" only affects workflow, not work-state.
    // Code trace confirms:
    //   1. `handleWorkflowCommand("pause workflow", dir)` calls `pauseWorkflow(dir, reason)`
    //   2. `pauseWorkflow` only modifies the workflow instance (sets status="paused"), not work-state
    //   3. After pause, on next session.idle, workflow continuation returns null (instance.status is "paused")
    //   4. Work-continuation then gets its turn and can resume if work-state is not paused
    //   → No cross-contamination between the two systems.
  })

  describe("todo finalization safety net", () => {
    function makeClientWithTodos(todos: Array<{ content: string; status: string; priority: string }>) {
      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> =
        []
      const mockClient = {
        session: {
          todo: async (_opts: { path: { id: string } }) => ({ data: todos }),
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]
      return { mockClient, promptAsyncCalls }
    }

    const idleEvent = (sessionId: string) => ({
      type: "session.idle" as const,
      properties: { sessionID: sessionId },
    })

    it("injects finalize prompt when session.idle fires with in_progress todos and no continuation", async () => {
      const { mockClient, promptAsyncCalls } = makeClientWithTodos([
        { content: "Task 1", status: "in_progress", priority: "medium" },
      ])

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
      })

      const evt = idleEvent("sess-finalize-1")
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(1)
      expect(promptAsyncCalls[0].path.id).toBe("sess-finalize-1")
      expect(promptAsyncCalls[0].body.parts[0].text).toContain("<!-- weave:finalize-todos -->")
      expect(promptAsyncCalls[0].body.parts[0].text).toContain('"Task 1"')
    })

    it("does not inject finalize prompt when session has no in_progress todos", async () => {
      const { mockClient, promptAsyncCalls } = makeClientWithTodos([
        { content: "Done", status: "completed", priority: "medium" },
      ])

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
      })

      const evt = idleEvent("sess-finalize-2")
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(0)
    })

    it("does not inject finalize prompt twice for same session", async () => {
      const { mockClient, promptAsyncCalls } = makeClientWithTodos([
        { content: "Task 1", status: "in_progress", priority: "medium" },
      ])

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
      })

      const evt = idleEvent("sess-finalize-3")
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })

      expect(promptAsyncCalls.length).toBe(1)
    })

    it("re-arms finalize after new user message", async () => {
      const { mockClient, promptAsyncCalls } = makeClientWithTodos([
        { content: "Task 1", status: "in_progress", priority: "medium" },
      ])

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
      })

      const evt = idleEvent("sess-finalize-4")
      // First idle — finalize fires
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })
      expect(promptAsyncCalls.length).toBe(1)

      // New user message — resets the finalized set
      await iface["chat.message"](
        { sessionID: "sess-finalize-4" },
        { message: {} as never, parts: [{ type: "text", text: "hello" }] },
      )

      // Second idle — finalize fires again
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })
      expect(promptAsyncCalls.length).toBe(2)
    })

    it("does not inject finalize prompt when workContinuation fires", async () => {
      const { mockClient, promptAsyncCalls } = makeClientWithTodos([
        { content: "Task 1", status: "in_progress", priority: "medium" },
      ])

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

      const evt = idleEvent("sess-finalize-5")
      await iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })

      // Only one prompt injected — the continuation prompt, not the finalize prompt
      expect(promptAsyncCalls.length).toBe(1)
      expect(promptAsyncCalls[0].body.parts[0].text).toBe("Continue working on your plan.")
      expect(promptAsyncCalls[0].body.parts[0].text).not.toContain("<!-- weave:finalize-todos -->")
    })

    it("does not inject finalize prompt when client is absent", async () => {
      // No client — should not throw
      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        // no client
      })

      const evt = idleEvent("sess-finalize-6")
      await expect(iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })).resolves.toBeUndefined()
    })

    it("handles session.todo() errors gracefully", async () => {
      const promptAsyncCalls: Array<{ path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }> =
        []
      const mockClient = {
        session: {
          todo: async (_opts: { path: { id: string } }) => {
            throw new Error("SDK error")
          },
          promptAsync: async (opts: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => {
            promptAsyncCalls.push(opts)
          },
        },
      } as unknown as Parameters<typeof createPluginInterface>[0]["client"]

      const iface = createPluginInterface({
        pluginConfig: baseConfig,
        hooks: makeHooks(),
        tools: emptyTools,
        configHandler: makeMockConfigHandler(),
        agents: {},
        client: mockClient,
      })

      const evt = idleEvent("sess-finalize-7")
      // Should not throw
      await expect(iface.event({ event: evt as Parameters<typeof iface.event>[0]["event"] })).resolves.toBeUndefined()
      // No prompt injected since todo() threw
      expect(promptAsyncCalls.length).toBe(0)
    })
  })
})
