import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { FakeOpencodeHost } from "../testkit/host/fake-opencode-host"
import { createWorkState, readWorkState, writeWorkState } from "../../src/features/work-state"
import { CONTINUATION_MARKER } from "../../src/hooks/work-continuation"
import { createExecutionLeaseFsStore } from "../../src/infrastructure/fs/execution-lease-fs-store"
import { getActiveWorkflowInstance, WORKFLOWS_DIR_PROJECT } from "../../src/features/workflow"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

describe("E2E: execution ownership", () => {
  const executionLeaseRepository = createExecutionLeaseFsStore()
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-e2e-execution-ownership-")
    fixture.writeProjectConfig({
      continuation: {
        idle: {
          enabled: true,
          work: true,
        },
      },
    })
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it("restarting the same plan from another session reassigns idle ownership to that session", async () => {
    fixture.writePlan(
      "collision-plan",
      [
        "# Plan",
        "",
        "## TL;DR",
        "> **Summary**: Verify second explicit /start-work behavior.",
        "> **Estimated Effort**: Quick",
        "",
        "## TODOs",
        "- [ ] 1. First task",
        "  **What**: Do the first thing",
        "  **Files**: src/collision.ts (new)",
        "  **Acceptance**: It works",
        "",
        "## Verification",
        "- [ ] All done",
      ].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })

    const firstStart = await host.sendStartWork({
      sessionID: "sess-owner-1",
      planName: "collision-plan",
      timestamp: "2026-01-01T00:00:00.000Z",
    })

    expect(firstStart.parts[0].text).toContain("Starting Plan: collision-plan")

    host.client.clearEffects()

    const secondStart = await host.sendStartWork({
      sessionID: "sess-owner-2",
      planName: "collision-plan",
      timestamp: "2026-01-01T00:01:00.000Z",
    })

    expect(secondStart.parts[0].text).toContain("Starting Plan: collision-plan")

    const state = readWorkState(fixture.directory)
    expect(state).not.toBeNull()
    expect(state!.plan_name).toBe("collision-plan")
    expect(state!.session_ids).toEqual(["sess-owner-2"])

    host.client.clearEffects()
    await host.emitSessionIdle("sess-owner-1")
    expect(host.client.promptAsyncCalls).toHaveLength(0)

    await host.emitSessionIdle("sess-owner-2")
    expect(host.client.promptAsyncCalls).toHaveLength(1)
    expect(host.client.lastPromptAsyncCall?.path.id).toBe("sess-owner-2")
    expect(host.client.lastPromptAsyncCall?.body.parts[0].text).toContain(CONTINUATION_MARKER)
    expect(host.client.lastPromptAsyncCall?.body.parts[0].text).toContain("collision-plan")
  })

  it("resumes the active plan across sessions when /start-work has no plan argument", async () => {
    fixture.writePlan(
      "resume-plan",
      [
        "# Plan",
        "",
        "## TL;DR",
        "> **Summary**: Verify cross-session resume behavior.",
        "> **Estimated Effort**: Quick",
        "",
        "## TODOs",
        "- [x] 1. Finished task",
        "  **What**: Already done",
        "  **Files**: src/resume.ts",
        "  **Acceptance**: It works",
        "- [ ] 2. Remaining task",
        "  **What**: Continue the plan",
        "  **Files**: src/resume.ts",
        "  **Acceptance**: It still works",
        "",
        "## Verification",
        "- [ ] All done",
      ].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })

    await host.sendStartWork({
      sessionID: "sess-resume-1",
      planName: "resume-plan",
      timestamp: "2026-01-01T00:00:00.000Z",
    })

    const resumed = await host.sendStartWork({
      sessionID: "sess-resume-2",
      timestamp: "2026-01-01T00:05:00.000Z",
    })

    expect(resumed.parts[0].text).toContain("Resuming Plan: resume-plan")
    expect(resumed.parts[0].text).toContain("Status**: RESUMING")
    expect(resumed.parts[0].text).toContain("1/3 tasks completed")
    expect(resumed.parts[0].text).toContain("SIDEBAR TODOS")

    const state = readWorkState(fixture.directory)
    expect(state).not.toBeNull()
    expect(state!.plan_name).toBe("resume-plan")
    expect(state!.paused).toBe(false)
    expect(state!.session_ids).toEqual(["sess-resume-1", "sess-resume-2"])

    host.client.clearEffects()

    await host.emitSessionIdle("sess-resume-1")
    expect(host.client.promptAsyncCalls).toHaveLength(0)

    await host.emitSessionIdle("sess-resume-2")

    expect(host.client.promptAsyncCalls).toHaveLength(1)
    expect(host.client.promptAsyncCalls[0].path.id).toBe("sess-resume-2")
    expect(host.client.promptAsyncCalls[0].body.parts[0].text).toContain(CONTINUATION_MARKER)
  })

  it("keeps state consistent and shows a user-visible warning when a second start-work selects a different missing plan", async () => {
    fixture.writePlan(
      "active-plan",
      [
        "# Plan",
        "",
        "## TL;DR",
        "> **Summary**: Verify explicit-plan collision messaging.",
        "> **Estimated Effort**: Quick",
        "",
        "## TODOs",
        "- [ ] 1. Active task",
        "  **What**: Stay active",
        "  **Files**: src/active.ts (new)",
        "  **Acceptance**: It works",
        "",
        "## Verification",
        "- [ ] All done",
      ].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })

    await host.sendStartWork({
      sessionID: "sess-active-1",
      planName: "active-plan",
      timestamp: "2026-01-01T00:00:00.000Z",
    })

    const missingPlanAttempt = await host.sendStartWork({
      sessionID: "sess-active-2",
      planName: "missing-plan",
      timestamp: "2026-01-01T00:01:00.000Z",
    })

    expect(missingPlanAttempt.parts[0].text).toContain("Plan Not Found")
    expect(missingPlanAttempt.parts[0].text).toContain("missing-plan")
    expect(missingPlanAttempt.parts[0].text).toContain("active-plan")

    const state = readWorkState(fixture.directory)
    expect(state).not.toBeNull()
    expect(state!.plan_name).toBe("active-plan")
    expect(state!.session_ids).toEqual(["sess-active-1"])

    host.client.clearEffects()

    await host.emitSessionIdle("sess-active-2")
    expect(host.client.promptAsyncCalls).toHaveLength(0)

    await host.emitSessionIdle("sess-active-1")
    expect(host.client.promptAsyncCalls).toHaveLength(1)
    expect(host.client.lastPromptAsyncCall?.path.id).toBe("sess-active-1")
  })

  it("transitions Loom ad-hoc to Tapestry plan ownership on /start-work", async () => {
    fixture.writePlan(
      "ownership-plan",
      ["# Plan", "", "## TODOs", "- [ ] 1. Own work", "", "## Verification", "- [ ] done"].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    await host.sendChatParams({ sessionID: "sess-own-plan", agent: "Loom (Main Orchestrator)" })

    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toBeNull()
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-own-plan")?.foreground_agent).toBe("loom")

    await host.sendStartWork({ sessionID: "sess-own-plan", planName: "ownership-plan" })

    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toMatchObject({
      owner_kind: "plan",
      session_id: "sess-own-plan",
      executor_agent: "tapestry",
    })
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-own-plan")).toMatchObject({
      foreground_agent: "tapestry",
      mode: "plan",
      status: "running",
    })
  })

  it("transitions Loom ad-hoc to workflow ownership when a workflow starts", async () => {
    const workflowDir = join(fixture.directory, WORKFLOWS_DIR_PROJECT)
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(
      join(workflowDir, "review.json"),
      JSON.stringify({
        name: "review",
        version: 1,
        steps: [
          { id: "audit", name: "Audit", type: "interactive", agent: "weft", prompt: "Audit {{instance.goal}}", completion: { method: "user_confirm" } },
        ],
      }),
      "utf-8",
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    await host.sendChatParams({ sessionID: "sess-own-workflow", agent: "Loom (Main Orchestrator)" })
    await host.sendRunWorkflow({ sessionID: "sess-own-workflow", workflowArgs: 'review "Check auth"' })

    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toMatchObject({
      owner_kind: "workflow",
      session_id: "sess-own-workflow",
      executor_agent: "weft",
    })
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-own-workflow")).toMatchObject({
      foreground_agent: "weft",
      mode: "workflow",
      status: "running",
    })
  })

  it("preserves paused workflow ownership and restores running ownership on resume", async () => {
    const workflowDir = join(fixture.directory, WORKFLOWS_DIR_PROJECT)
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(
      join(workflowDir, "resume.json"),
      JSON.stringify({
        name: "resume",
        version: 1,
        steps: [
          { id: "audit", name: "Audit", type: "interactive", agent: "weft", prompt: "Audit {{instance.goal}}", completion: { method: "user_confirm" } },
        ],
      }),
      "utf-8",
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    await host.sendRunWorkflow({ sessionID: "sess-pause-resume", workflowArgs: 'resume "Check auth"' })
    await host.sendUserMessage({ sessionID: "sess-pause-resume", text: "workflow pause" })

    expect(getActiveWorkflowInstance(fixture.directory)?.status).toBe("paused")
    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toMatchObject({ status: "paused", owner_kind: "workflow" })
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-pause-resume")).toMatchObject({ status: "paused", mode: "workflow" })

    await host.sendRunWorkflow({ sessionID: "sess-pause-resume" })

    expect(getActiveWorkflowInstance(fixture.directory)?.status).toBe("running")
    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toMatchObject({ status: "running", owner_kind: "workflow" })
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-pause-resume")).toMatchObject({ status: "running", mode: "workflow" })
  })

  it("interrupt only pauses the owner execution kind", async () => {
    fixture.writePlan(
      "mixed-plan",
      ["# Plan", "", "## TODOs", "- [ ] 1. Keep plan active", "", "## Verification", "- [ ] done"].join("\n"),
    )

    const workflowDir = join(fixture.directory, WORKFLOWS_DIR_PROJECT)
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(
      join(workflowDir, "mixed.json"),
      JSON.stringify({
        name: "mixed",
        version: 1,
        steps: [
          { id: "review", name: "Review", type: "interactive", agent: "weft", prompt: "Review {{instance.goal}}", completion: { method: "user_confirm" } },
        ],
      }),
      "utf-8",
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    const planPath = join(fixture.directory, ".weave", "plans", "mixed-plan.md")
    writeWorkState(fixture.directory, createWorkState(planPath, "sess-plan-owner"))
    await host.sendRunWorkflow({ sessionID: "sess-wf-owner", workflowArgs: 'mixed "Audit auth"' })

    await host.emitCommandExecute("session.interrupt", "sess-wf-owner")

    expect(getActiveWorkflowInstance(fixture.directory)?.status).toBe("paused")
    expect(readWorkState(fixture.directory)?.paused).not.toBe(true)
  })

  it("clears plan owner when plan completion is observed on session.idle", async () => {
    const planPath = fixture.writePlan(
      "complete-plan",
      ["# Plan", "", "## TODOs", "- [ ] 1. Finish task", "", "## Verification", "- [ ] done"].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    await host.sendStartWork({ sessionID: "sess-plan-complete", planName: "complete-plan" })

    fixture.writePlan(
      "complete-plan",
      ["# Plan", "", "## TODOs", "- [x] 1. Finish task", "", "## Verification", "- [x] done"].join("\n"),
    )

    host.client.clearEffects()
    await host.emitSessionIdle("sess-plan-complete")

    expect(host.client.promptAsyncCalls).toHaveLength(1)
    expect(host.client.promptAsyncCalls[0]?.body.parts[0]?.text).toContain("## Verification Required")
    expect(executionLeaseRepository.readExecutionLease(fixture.directory)).toBeNull()
    expect(executionLeaseRepository.readSessionRuntime(fixture.directory, "sess-plan-complete")).toMatchObject({
      foreground_agent: "tapestry",
      mode: "ad_hoc",
      status: "idle",
      execution_ref: planPath,
    })
  })
})
