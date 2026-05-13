import { describe, expect, it } from "bun:test"
import { createPolicyEngine } from "./policy-engine"
import { createAutoPauseChatPolicy, createCommandChatPolicy, createTodoFinalizationChatPolicy } from "./chat-policy"
import { createHookBackedSessionPolicy } from "./session-policy"
import { createTodoDescriptionToolDefinitionPolicy } from "./tool-definition-policy"
import { TODOWRITE_DESCRIPTION } from "../../hooks/todo-description-override"
import { createHookBackedToolPolicy } from "./tool-policy"
import type { CreatedHooks } from "../../hooks/create-hooks"
import { DEFAULT_CONTINUATION_CONFIG } from "../../config/continuation"
import { writeWorkState, createWorkState } from "../../features/work-state/storage"
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { renderBuiltinCommandEnvelope } from "../../runtime/opencode/protocol"
import { getState as getTokenState, setContextLimit } from "../../hooks"
import { createExecutionLeaseFsStore } from "../../infrastructure/fs/execution-lease-fs-store"
import { createExecutionLeaseState, createSessionRuntimeState } from "../../domain/session/execution-lease"

function makeHooks(overrides?: Partial<CreatedHooks>): CreatedHooks {
  return {
    contextWindowThresholds: null,
    rulesInjectorEnabled: false,
    writeGuard: null,
    firstMessageVariant: null,
    processMessageForKeywords: null,
    patternMdOnlyEnabled: false,
    startWork: null,
    workContinuation: null,
    workflowStart: null,
    workflowContinuation: null,
    workflowCommand: null,
    verificationReminderEnabled: false,
    analyticsEnabled: false,
    todoDescriptionOverrideEnabled: false,
    compactionTodoPreserverEnabled: false,
    todoContinuationEnforcerEnabled: false,
    compactionRecovery: null,
    continuation: DEFAULT_CONTINUATION_CONFIG,
    ...overrides,
  }
}

describe("createPolicyEngine", () => {
  it("routes chat command handling through composed chat policies", async () => {
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy()],
    })

    const hooks = makeHooks({
      startWork: () => ({ contextInjection: "plan context", switchAgent: "tapestry" }),
    })

    const effects = await engine.onChatMessage({
      directory: "",
      sessionId: "sess-1",
      promptText: renderBuiltinCommandEnvelope({ command: "start-work", arguments: "", sessionId: "sess-1" }),
      parsedEnvelope: {
        kind: "builtin-command",
        source: "envelope",
        command: "start-work",
        arguments: "",
        sessionId: "sess-1",
        timestamp: null,
      },
      hooks,
    })

    expect(effects).toEqual([
      { type: "switchAgent", agent: "tapestry" },
      { type: "restoreAgent", sessionId: "sess-1", agent: "tapestry" },
      { type: "appendPromptText", text: "plan context" },
    ])
  })

  it("routes plan auto-pause through the chat policy engine", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weave-policy-engine-"))
    mkdirSync(join(directory, ".weave"), { recursive: true })
    writeWorkState(directory, createWorkState("plan.md", "2026-01-01T00:00:00.000Z"))
    createExecutionLeaseFsStore().writeExecutionLease(directory, createExecutionLeaseState({
      ownerKind: "plan",
      ownerRef: "plan.md",
      status: "running",
      sessionId: "sess-plan",
      executorAgent: "tapestry",
    }))

    try {
      const engine = createPolicyEngine({
        chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
        toolPolicies: [createHookBackedToolPolicy()],
        toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
        sessionPolicies: [createHookBackedSessionPolicy()],
      })

      const effects = await engine.onChatMessage({
        directory,
        sessionId: "sess-plan",
        promptText: "normal user message",
        parsedEnvelope: null,
        hooks: makeHooks(),
      })

      expect(effects).toContainEqual({
        type: "pauseExecution",
        target: "plan",
        reason: "Auto-paused: user message received during active plan",
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("routes tool guard hooks through the policy engine", async () => {
    const tracked: string[] = []
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy()],
    })

    await engine.beforeTool({
      directory: "",
      sessionId: "sess-tool",
      tool: "read",
      callId: "call-1",
      hooks: makeHooks({
        writeGuard: {
          trackRead: (filePath: string) => {
            tracked.push(filePath)
          },
          checkWrite: () => ({ allowed: true }),
        },
      }),
      toolArgs: { file_path: "/tmp/file.ts" },
    })

    expect(tracked).toEqual(["/tmp/file.ts"])
  })

  it("routes assistant context-window checks through the policy engine", async () => {
    setContextLimit("sess-ctx", 100_000)
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy()],
    })

    const effects = await engine.onAssistantMessage({
      directory: "",
      sessionId: "sess-ctx",
      hooks: makeHooks({
        contextWindowThresholds: { warningPct: 0.8, criticalPct: 0.95 },
      }),
      inputTokens: 50_000,
    })

    expect(effects).toEqual([])
    expect(getTokenState("sess-ctx")).toEqual({
      usedTokens: 50_000,
      maxTokens: 100_000,
    })
  })

  it("routes todo finalization re-arm through the chat policy engine", async () => {
    const cleared: string[] = []
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy({
        clearFinalized: (sessionId: string) => {
          cleared.push(sessionId)
        },
      })],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy()],
    })

    await engine.onChatMessage({
      directory: "",
      sessionId: "sess-rearm",
      promptText: "regular user message",
      parsedEnvelope: null,
      hooks: makeHooks(),
    })

    expect(cleared).toEqual(["sess-rearm"])
  })

  it("routes tool definition handling through the policy engine", async () => {
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy()],
    })

    const output = { description: "original" }

    await engine.onToolDefinition({
      toolId: "todowrite",
      hooks: makeHooks({
        todoDescriptionOverrideEnabled: true,
      }),
      output,
    })

    expect(output.description).toBe(TODOWRITE_DESCRIPTION)
  })

  it("routes pre-compaction capture through the policy engine", async () => {
    const captured: string[] = []
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy({
        compactionPreserver: {
          capture: async (sessionId: string) => {
            captured.push(sessionId)
          },
          restore: async () => undefined,
          clearSession: () => undefined,
        },
      })],
    })

    await engine.beforeCompaction({
      directory: "",
      sessionId: "sess-compact",
      hooks: makeHooks(),
    })

    expect(captured).toEqual(["sess-compact"])
  })

  it("keeps idle sequencing stable when work continuation fires", async () => {
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy({
        todoContinuationEnforcer: {
          checkAndFinalize: async (sessionId: string) => {
            finalized.push(sessionId)
          },
          clearSession: () => undefined,
        },
      })],
    })

    const finalized: string[] = []
    const effects = await engine.onSessionIdle({
      directory: "",
      sessionId: "sess-idle",
      hooks: makeHooks({
        continuation: {
          recovery: { compaction: true },
          idle: { enabled: true, work: true, workflow: false, todo_prompt: false },
        },
        workContinuation: () => ({ continuationPrompt: "continue working", switchAgent: null }),
        todoContinuationEnforcerEnabled: true,
      }),
    })

    expect(effects).toEqual([{ type: "injectPromptAsync", sessionId: "sess-idle", text: "continue working", agent: null }])
    expect(finalized).toEqual([])
  })

  it("clears per-session runtime state through session deletion policy", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weave-policy-delete-"))
    const executionLease = createExecutionLeaseFsStore()
    executionLease.writeExecutionLease(directory, createExecutionLeaseState({
      ownerKind: "workflow",
      ownerRef: "wf_1/review",
      status: "running",
      sessionId: "sess-delete",
      executorAgent: "weft",
    }))
    executionLease.writeSessionRuntime(directory, createSessionRuntimeState({
      sessionId: "sess-delete",
      foregroundAgent: "weft",
      mode: "workflow",
      executionRef: "wf_1/review",
      status: "running",
    }))

    try {
      const engine = createPolicyEngine({
        chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
        toolPolicies: [createHookBackedToolPolicy()],
        toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
        sessionPolicies: [createHookBackedSessionPolicy()],
      })

      await engine.onSessionDeleted({
        directory,
        sessionId: "sess-delete",
        hooks: makeHooks(),
      })

      expect(executionLease.readExecutionLease(directory)).toBeNull()
      expect(executionLease.readSessionRuntime(directory, "sess-delete")).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("routes compaction restore and recovery through one session policy path", async () => {
    const calls: string[] = []
    const engine = createPolicyEngine({
      chatPolicies: [createCommandChatPolicy(), createAutoPauseChatPolicy(), createTodoFinalizationChatPolicy()],
      toolPolicies: [createHookBackedToolPolicy()],
      toolDefinitionPolicies: [createTodoDescriptionToolDefinitionPolicy()],
      sessionPolicies: [createHookBackedSessionPolicy({
        compactionPreserver: {
          capture: async () => undefined,
          restore: async (sessionId: string) => {
            calls.push(`restore:${sessionId}`)
          },
          clearSession: () => undefined,
        },
      })],
    })

    const effects = await engine.onCompaction({
      directory: "",
      sessionId: "sess-compact-route",
      hooks: {
        ...makeHooks({
          continuation: {
            recovery: { compaction: true },
            idle: { enabled: true, work: true, workflow: true, todo_prompt: false },
          },
          compactionRecovery: () => {
            calls.push("recover")
            return { continuationPrompt: "resume after compaction", switchAgent: "loom" }
          },
        }),
      },
    })

    expect(calls).toEqual(["restore:sess-compact-route", "recover"])
    expect(effects).toEqual([
      { type: "restoreAgent", sessionId: "sess-compact-route", agent: "loom" },
      { type: "injectPromptAsync", sessionId: "sess-compact-route", text: "resume after compaction", agent: "loom" },
    ])
  })
})
