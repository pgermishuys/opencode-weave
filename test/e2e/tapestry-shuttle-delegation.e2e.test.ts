import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readSessionSummaries } from "../../src/features/analytics"
import { getAgentDisplayName } from "../../src/shared/agent-display-names"
import { createProjectFixture, type ProjectFixture } from "../testkit/fixtures/project-fixture"
import { FakeOpencodeHost } from "../testkit/host/fake-opencode-host"

describe("E2E: Tapestry categorized Shuttle delegation", () => {
  let fixture: ProjectFixture

  beforeEach(() => {
    fixture = createProjectFixture("weave-e2e-tapestry-shuttle-delegation-")
    fixture.writeProjectConfig({
      analytics: {
        enabled: true,
      },
      categories: {
        frontend: {
          patterns: ["src/frontend/**"],
          model: "gpt-4o",
          prompt_append: "Focus on UI implementation details.",
        },
      },
    })
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it("preserves generic and categorized Shuttle subagent_type values through a /start-work flow", async () => {
    fixture.writePlan(
      "categorized-delegation",
      [
        "# Plan",
        "",
        "## TL;DR",
        "> **Summary**: Verify start-work preserves exact Shuttle delegation targets end-to-end.",
        "> **Estimated Effort**: Quick",
        "",
        "## TODOs",
        "- [ ] 1. Shared task",
        "  **What**: Handle non-categorized shared work",
        "  **Files**: src/shared/util.ts (new)",
        "  **Acceptance**: Shared task works",
        "- [ ] 2. Frontend task",
        "  **What**: Handle categorized frontend work",
        "  **Files**: src/frontend/App.tsx (new)",
        "  **Acceptance**: Frontend task works",
        "",
        "## Verification",
        "- [ ] All done",
      ].join("\n"),
    )

    const host = await FakeOpencodeHost.boot({ directory: fixture.directory })
    const sessionID = "sess-start-work-shuttle-categorized"
    const output = await host.sendStartWork({
      sessionID,
      planName: "categorized-delegation",
      timestamp: "2026-01-01T00:00:00.000Z",
    })

    expect(host.getCurrentAgent(sessionID)).toBe(getAgentDisplayName("tapestry"))
    expect(output.parts[0].text).toContain("Starting Plan: categorized-delegation")
    expect(output.parts[0].text).toContain("SIDEBAR TODOS")

    await host.executeTool({
      sessionID,
      tool: "task",
      callID: "call-shuttle-generic",
      args: {
        subagent_type: "shuttle",
        description: "Handle the shared task",
        prompt: "Handle the shared src/shared/util.ts task and report concrete findings.",
      },
    })
    await host.executeTool({
      sessionID,
      tool: "task",
      callID: "call-shuttle-frontend",
      args: {
        subagent_type: "shuttle-frontend",
        description: "Handle the frontend task",
        prompt: "Handle the frontend src/frontend/App.tsx task and report concrete findings.",
      },
    })

    expect(host.getDelegatedToolCalls(sessionID).map(call => call.args.subagent_type)).toEqual([
      "shuttle",
      "shuttle-frontend",
    ])
    expect(host.getDelegatedToolCalls(sessionID).at(-1)?.args.subagent_type).toBe("shuttle-frontend")
    expect(host.getDelegatedToolCalls(sessionID).filter(call => call.args.subagent_type === "shuttle")).toHaveLength(1)

    await host.emitSessionDeleted(sessionID)

    const summaries = readSessionSummaries(fixture.directory)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual(
      expect.objectContaining({
        sessionId: sessionID,
        totalToolCalls: 2,
        totalDelegations: 2,
        toolUsage: [{ tool: "task", count: 2 }],
      }),
    )
    expect(summaries[0]?.delegations.map(({ agent, toolCallId }) => ({ agent, toolCallId }))).toEqual([
      { agent: "shuttle", toolCallId: "call-shuttle-generic" },
      { agent: "shuttle-frontend", toolCallId: "call-shuttle-frontend" },
    ])
    expect(summaries[0]?.delegations.map(({ agent }) => agent)).not.toEqual(["shuttle", "shuttle"])
  })
})
