import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { ReviewerPlan } from "../../agents/review-resolver"
import { DEFAULT_CONTINUATION_CONFIG } from "../../config/continuation"
import { createWorkState, readWorkState, writeWorkState } from "../../features/work-state"
import { PLANS_DIR } from "../../features/work-state/constants"
import type { CreatedHooks } from "../../hooks/create-hooks"
import { createHookBackedSessionPolicy } from "./session-policy"
import { createPostExecutionReviewerFanOutSessionPolicy } from "./post-execution-reviewer-fanout-session-policy"

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

function makePlan(baseAgent: "weft" | "warp", kind: ReviewerPlan["kind"] = "fan-out"): ReviewerPlan {
  if (kind === "disabled") {
    return { kind: "disabled", scope: "post-execution", baseAgent, reason: "agent-disabled" }
  }

  if (kind === "primary-only") {
    return {
      kind: "primary-only",
      scope: "post-execution",
      baseAgent,
      primary: { agentName: baseAgent, label: baseAgent === "weft" ? "Weft" : "Warp", model: "primary" },
      reason: "no-variants",
    }
  }

  return {
    kind: "fan-out",
    scope: "post-execution",
    baseAgent,
    primary: { agentName: baseAgent, label: baseAgent === "weft" ? "Weft" : "Warp", model: "primary" },
    variants: [{ baseAgent, key: `${baseAgent}-review-v1`, model: "variant-1", label: `${baseAgent} @ variant-1` }],
    batch: { mode: "parallel", size: 2 },
  }
}

describe("createPostExecutionReviewerFanOutSessionPolicy", () => {
  it("emits one runReviewerFanOut effect per non-disabled base agent", () => {
    const policy = createPostExecutionReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent(baseAgent) {
          return baseAgent === "weft" ? makePlan("weft", "fan-out") : makePlan("warp", "disabled")
        },
      },
    })

    const directory = mkdtempSync(join(tmpdir(), "weave-postexec-reviewers-"))
    const plansDir = join(directory, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "done.md")
    writeFileSync(planPath, "# Plan\n- [x] Done\n", "utf-8")
    writeWorkState(directory, {
      ...createWorkState(planPath, "sess-a", "tapestry", directory),
      session_ids: ["sess-a"],
    })

    try {
      const result = policy.onSessionIdle({
        directory,
        sessionId: "sess-a",
        hooks: makeHooks(),
      })

      expect(result.effects).toHaveLength(1)
      expect(result.effects[0]).toMatchObject({
        type: "runReviewerFanOut",
        sessionId: "sess-a",
      })
      const promptText = (result.effects[0] as { promptText: string }).promptText
      const originalContext = (result.effects[0] as { originalContext: string }).originalContext
      expect(promptText).toContain("Plan: done")
      expect(promptText).toContain("Review scope summary")
      expect(promptText).toContain("Planned files")
      expect(originalContext).toContain("Plan: done")
      expect(originalContext).toContain("Review scope summary")
      const idempotencyKey = (result.effects[0] as { idempotencyKey?: unknown }).idempotencyKey
      expect(typeof idempotencyKey).toBe("string")
      expect(String(idempotencyKey)).toContain("sess-a:")
      expect(String(idempotencyKey)).toContain(":weft")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("is idempotent across repeated onSessionIdle via work state", () => {
    const policy = createPostExecutionReviewerFanOutSessionPolicy({
      reviewerResolver: {
        forBaseAgent(baseAgent) {
          return makePlan(baseAgent, "primary-only")
        },
      },
    })

    const directory = mkdtempSync(join(tmpdir(), "weave-postexec-idempotent-"))
    const plansDir = join(directory, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "done.md")
    writeFileSync(planPath, "# Plan\n- [x] Done\n", "utf-8")
    writeWorkState(directory, {
      ...createWorkState(planPath, "sess-b", "tapestry", directory),
      session_ids: ["sess-b"],
    })

    try {
      const first = policy.onSessionIdle({ directory, sessionId: "sess-b", hooks: makeHooks() })
      const second = policy.onSessionIdle({ directory, sessionId: "sess-b", hooks: makeHooks() })

      expect(first.effects).toHaveLength(2)
      expect(second.effects).toEqual([])
      expect(readWorkState(directory)?.reviewer_fanout_sent).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("coexists with verification reminder and emits fan-out before reminder", async () => {
    const policy = createHookBackedSessionPolicy({
      reviewerResolver: {
        forBaseAgent(baseAgent) {
          return makePlan(baseAgent, "primary-only")
        },
      },
    })

    const directory = mkdtempSync(join(tmpdir(), "weave-postexec-order-"))
    const plansDir = join(directory, PLANS_DIR)
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "done.md")
    writeFileSync(planPath, "# Plan\n- [x] Done\n", "utf-8")
    writeWorkState(directory, {
      ...createWorkState(planPath, "sess-c", "tapestry", directory),
      session_ids: ["sess-c"],
    })

    try {
      const first = await policy.onSessionIdle({
        directory,
        sessionId: "sess-c",
        hooks: makeHooks({ verificationReminderEnabled: true }),
      })
      const second = await policy.onSessionIdle({
        directory,
        sessionId: "sess-c",
        hooks: makeHooks({ verificationReminderEnabled: true }),
      })

      expect(first.effects).toHaveLength(3)
      expect(first.effects[0]).toMatchObject({ type: "runReviewerFanOut" })
      expect(first.effects[1]).toMatchObject({ type: "runReviewerFanOut" })
      expect(first.effects[2]).toMatchObject({ type: "injectPromptAsync", sessionId: "sess-c" })
      expect(second.effects).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
