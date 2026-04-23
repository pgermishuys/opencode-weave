import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { readSessionSummaries } from "../../src/features/analytics"
import * as sharedLog from "../../src/shared/log"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { FakeOpencodeHost } from "../testkit/host/fake-opencode-host"

describe("Integration: runtime delegation evidence", () => {
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-integration-loom-delegation-runtime-")
    fixture.writeProjectConfig({
      analytics: {
        enabled: true,
      },
    })
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it("records runtime hook evidence and session-summary delegations for executed task tools", async () => {
    const spy = spyOn(sharedLog, "logDelegation")
    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    const sessionID = "sess-delegation-runtime"
    const delegatedAgents = [
      {
        agent: "thread",
        callID: "call-thread",
        description: "inspect authentication flow",
        prompt: "Inspect the authentication flow and report concrete findings.",
      },
      {
        agent: "weft",
        callID: "call-weft",
        description: "review proposed code changes",
        prompt: "Review the proposed code changes and flag correctness risks.",
      },
      {
        agent: "warp",
        callID: "call-warp",
        description: "audit security-sensitive paths",
        prompt: "Audit the security-sensitive paths and identify vulnerabilities.",
      },
    ] as const

    for (const delegatedAgent of delegatedAgents) {
      await host.executeTool({
        sessionID,
        tool: "task",
        callID: delegatedAgent.callID,
        args: {
          subagent_type: delegatedAgent.agent,
          description: delegatedAgent.description,
          prompt: delegatedAgent.prompt,
        },
      })
    }

    await host.emitSessionDeleted(sessionID)

    expect(spy.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ phase: "start", agent: "thread", sessionId: sessionID, toolCallId: "call-thread" }),
      expect.objectContaining({ phase: "complete", agent: "thread", sessionId: sessionID, toolCallId: "call-thread" }),
      expect.objectContaining({ phase: "start", agent: "weft", sessionId: sessionID, toolCallId: "call-weft" }),
      expect.objectContaining({ phase: "complete", agent: "weft", sessionId: sessionID, toolCallId: "call-weft" }),
      expect.objectContaining({ phase: "start", agent: "warp", sessionId: sessionID, toolCallId: "call-warp" }),
      expect.objectContaining({ phase: "complete", agent: "warp", sessionId: sessionID, toolCallId: "call-warp" }),
    ])

    const summaries = readSessionSummaries(fixture.directory)
    expect(summaries).toHaveLength(1)

    const summary = summaries[0]
    expect(summary.sessionId).toBe(sessionID)
    expect(summary.totalToolCalls).toBe(3)
    expect(summary.totalDelegations).toBe(3)
    expect(summary.toolUsage).toEqual([{ tool: "task", count: 3 }])
    expect(summary.delegations.map(({ agent, toolCallId }) => ({ agent, toolCallId }))).toEqual([
      { agent: "thread", toolCallId: "call-thread" },
      { agent: "weft", toolCallId: "call-weft" },
      { agent: "warp", toolCallId: "call-warp" },
    ])
    for (const delegation of summary.delegations) {
      expect(delegation.durationMs).toBeDefined()
      expect(delegation.durationMs!).toBeGreaterThanOrEqual(0)
    }

    spy.mockRestore()
  })

  it("does not record delegation evidence when Thread, Weft, and Warp are only mentioned in prose", async () => {
    const spy = spyOn(sharedLog, "logDelegation")
    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    const sessionID = "sess-delegation-prose-only"

    await host.sendUserMessage({
      sessionID,
      text: "Consider asking Thread to inspect, Weft to review, and Warp to audit later, but do not execute any delegation tool.",
    })
    await host.emitMessageUpdated({
      role: "assistant",
      sessionID,
      tokens: {
        input: 12,
        output: 6,
        reasoning: 2,
      },
    })
    await host.emitSessionDeleted(sessionID)

    expect(spy).not.toHaveBeenCalled()

    const summaries = readSessionSummaries(fixture.directory)
    expect(summaries).toHaveLength(1)

    const summary = summaries[0]
    expect(summary.sessionId).toBe(sessionID)
    expect(summary.totalToolCalls).toBe(0)
    expect(summary.totalDelegations).toBe(0)
    expect(summary.toolUsage).toEqual([])
    expect(summary.delegations).toEqual([])

    spy.mockRestore()
  })
})
