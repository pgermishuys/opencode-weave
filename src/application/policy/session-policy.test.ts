import { describe, expect, it } from "bun:test"
import { createHookBackedSessionPolicy } from "./session-policy"
import type { CreatedHooks } from "../../hooks/create-hooks"
import { DEFAULT_CONTINUATION_CONFIG } from "../../config/continuation"
import { getState as getTokenState, setContextLimit } from "../../hooks"
import { createWorkState, writeWorkState } from "../../features/work-state"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { PLANS_DIR } from "../../features/work-state/constants"
import { createExecutionLeaseFsStore } from "../../infrastructure/fs/execution-lease-fs-store"
import { createExecutionLeaseState } from "../../domain/session/execution-lease"
import {
  runTodoFinalizationIdleStep,
  runWorkIdleStep,
} from "../orchestration/idle-cycle-service"

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

describe("createHookBackedSessionPolicy", () => {
  it("routes assistant context-window checks through a named policy unit", async () => {
    setContextLimit("sess-ctx", 100_000)
    const policy = createHookBackedSessionPolicy()

    const result = await policy.onAssistantMessage({
      directory: "",
      sessionId: "sess-ctx",
      hooks: makeHooks({
        contextWindowThresholds: { warningPct: 0.8, criticalPct: 0.95 },
      }),
      inputTokens: 50_000,
    })

    expect(result.effects).toEqual([])
    expect(getTokenState("sess-ctx")).toEqual({
      usedTokens: 50_000,
      maxTokens: 100_000,
    })
  })

  it("clears todo session state through a named policy unit", () => {
    let cleared = ""
    const policy = createHookBackedSessionPolicy({
      todoContinuationEnforcer: {
        checkAndFinalize: async () => undefined,
        clearSession: (sessionId: string) => {
          cleared = sessionId
        },
      },
    })

    policy.onSessionDeleted({
      directory: "",
      sessionId: "sess-del",
      hooks: makeHooks(),
    })

    expect(cleared).toBe("sess-del")
  })

  it("runs work continuation before todo finalization", async () => {
    const ordering: string[] = []

    const todoContinuationEnforcer = {
      checkAndFinalize: async () => {
        ordering.push("todos")
      },
      clearSession: () => undefined,
    }

    const input = {
      sessionId: "sess-idle",
      directory: "",
      hooks: makeHooks({
        continuation: {
          recovery: { compaction: true },
          idle: { enabled: true, work: true, workflow: false, todo_prompt: false },
        },
        workContinuation: () => {
          ordering.push("work")
          return { continuationPrompt: null, switchAgent: null }
        },
        todoContinuationEnforcerEnabled: true,
      }),
      lastAssistantMessage: undefined,
      lastUserMessage: undefined,
      todoContinuationEnforcer,
    }

    const workStep = runWorkIdleStep(input)
    await runTodoFinalizationIdleStep(input, workStep.continuationFired)

    expect(ordering).toEqual(["work", "todos"])
  })

  it("skips todo finalization when work continuation fires", async () => {
    const ordering: string[] = []

    const todoContinuationEnforcer = {
      checkAndFinalize: async () => {
        ordering.push("todos")
      },
      clearSession: () => undefined,
    }

    const input = {
      sessionId: "sess-idle",
      directory: "",
      hooks: makeHooks({
        continuation: {
          recovery: { compaction: true },
          idle: { enabled: true, work: true, workflow: false, todo_prompt: false },
        },
        workContinuation: () => ({ continuationPrompt: "continue", switchAgent: null }),
        todoContinuationEnforcerEnabled: true,
      }),
      lastAssistantMessage: undefined,
      lastUserMessage: undefined,
      todoContinuationEnforcer,
    }

    const workStep = runWorkIdleStep(input)
    await runTodoFinalizationIdleStep(input, workStep.continuationFired)

    expect(workStep.continuationFired).toBe(true)
    expect(ordering).toEqual([])
  })

  it("clears compaction snapshots through the session policy", () => {
    const cleared: string[] = []
    const policy = createHookBackedSessionPolicy({
      compactionPreserver: {
        capture: async () => undefined,
        restore: async () => undefined,
        clearSession: (sessionId: string) => {
          cleared.push(sessionId)
        },
      },
    })

    policy.onSessionDeleted({
      directory: "",
      sessionId: "sess-compact-delete",
      hooks: makeHooks(),
    })

    expect(cleared).toEqual(["sess-compact-delete"])
  })

  it("restores compaction snapshots before recovery continuation", async () => {
    const calls: string[] = []
    const policy = createHookBackedSessionPolicy({
      compactionPreserver: {
        capture: async () => undefined,
        restore: async (sessionId: string) => {
          calls.push(`restore:${sessionId}`)
        },
        clearSession: () => undefined,
      },
    })

    const result = await policy.onCompaction({
      directory: "",
      sessionId: "sess-compact",
      hooks: {
        ...makeHooks({
          continuation: {
            recovery: { compaction: true },
            idle: { enabled: true, work: true, workflow: true, todo_prompt: false },
          },
          compactionRecovery: () => {
            calls.push("recover")
            return { continuationPrompt: "resume", switchAgent: null }
          },
        }),
      },
    })

    expect(calls).toEqual(["restore:sess-compact", "recover"])
    expect(result.effects).toEqual([
      { type: "injectPromptAsync", sessionId: "sess-compact", text: "resume", agent: null },
    ])
  })

  it("injects a verification reminder once when a plan completes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weave-verify-policy-"))
    const plansDir = join(directory, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "verify-plan.md")
    writeFileSync(planPath, "# Plan\n- [x] Task\n- [x] Verify\n", "utf-8")
    writeWorkState(directory, {
      ...createWorkState(planPath, "sess-verify", "tapestry", directory),
      session_ids: ["sess-verify"],
    })
    createExecutionLeaseFsStore().writeExecutionLease(directory, createExecutionLeaseState({
      ownerKind: "plan",
      ownerRef: planPath,
      status: "running",
      sessionId: "sess-verify",
      executorAgent: "tapestry",
    }))

    try {
      const policy = createHookBackedSessionPolicy()

      const first = await policy.onSessionIdle({
        directory,
        sessionId: "sess-verify",
        hooks: makeHooks({
          verificationReminderEnabled: true,
        }),
      })
      const second = await policy.onSessionIdle({
        directory,
        sessionId: "sess-verify",
        hooks: makeHooks({
          verificationReminderEnabled: true,
        }),
      })

      expect(first.effects).toHaveLength(1)
      expect(first.effects[0]).toMatchObject({
        type: "injectPromptAsync",
        sessionId: "sess-verify",
      })
      expect((first.effects[0] as { text: string }).text).toContain("## Verification Required")
      expect(second.effects).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
