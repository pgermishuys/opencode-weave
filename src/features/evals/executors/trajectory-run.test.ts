import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { detectDelegation, executeTrajectoryRun } from "./trajectory-run"
import type { ExecutionContext, ResolvedTarget, TrajectoryRunExecutor } from "../types"

describe("detectDelegation", () => {
  it("detects [delegates to X] pattern", () => {
    expect(detectDelegation("Let me handle this. [delegates to pattern]")).toBe("pattern")
  })

  it("detects [delegate to X] pattern", () => {
    expect(detectDelegation("[delegate to thread]")).toBe("thread")
  })

  it("detects 'Delegating to X' pattern", () => {
    expect(detectDelegation("Delegating to Pattern for planning...")).toBe("pattern")
  })

  it("detects 'delegate to X' pattern in sentence", () => {
    expect(detectDelegation("I will delegate to warp for security review")).toBe("warp")
  })

  it("detects 'route to X' pattern", () => {
    expect(detectDelegation("Let me route to thread for this exploration")).toBe("thread")
  })

  it("detects 'routing to X' pattern", () => {
    expect(detectDelegation("Routing to warp for security audit")).toBe("warp")
  })

  it("detects plain delegation targets", () => {
    expect(detectDelegation("Delegating to worker for backend work")).toBe("worker")
  })

  it("detects hyphenated delegation targets", () => {
    expect(detectDelegation("Delegating to worker-ui for UI work")).toBe("worker-ui")
  })

  it("is case-insensitive", () => {
    expect(detectDelegation("[DELEGATES TO PATTERN]")).toBe("pattern")
  })

  it("returns null when no delegation found", () => {
    expect(detectDelegation("Here is the answer to your question.")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(detectDelegation("")).toBeNull()
  })
})

describe("executeTrajectoryRun", () => {
  it("records delegation targets separately from acting-agent sequence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weave-trajectory-run-"))

    try {
      const scenariosDir = join(directory, "evals", "scenarios")
      mkdirSync(scenariosDir, { recursive: true })

      writeFileSync(
        join(scenariosDir, "delegation-targets.jsonc"),
        JSON.stringify({
          id: "delegation-targets",
          title: "Delegation targets trace coverage",
          agents: ["loom", "worker", "worker-ui"],
          turns: [
            {
              turn: 1,
              role: "user",
              content: "Please investigate and implement the UI fix.",
            },
            {
              turn: 2,
              role: "assistant",
              agent: "loom",
              content: "Delegating to worker for investigation.",
            },
            {
              turn: 3,
              role: "assistant",
              agent: "worker",
              content: "Routing to worker-ui for the UI update.",
            },
            {
              turn: 4,
              role: "assistant",
              agent: "worker-ui",
              content: "Implemented the requested UI fix.",
            },
          ],
        }),
        "utf-8",
      )

      const resolvedTarget: ResolvedTarget = {
        target: {
          kind: "trajectory-agent",
          agent: "loom",
          scenarioRef: "evals/scenarios/delegation-targets.jsonc",
        },
        artifacts: {},
      }

      const executor: TrajectoryRunExecutor = {
        kind: "trajectory-run",
        scenarioRef: "evals/scenarios/delegation-targets.jsonc",
      }

      const context: ExecutionContext = {
        mode: "local",
        directory,
      }

      const artifacts = await executeTrajectoryRun(resolvedTarget, executor, context)

      expect(artifacts.trace).toEqual({
        scenarioId: "delegation-targets",
        turns: [
          {
            turn: 1,
            agent: "user",
            role: "user",
            response: "Please investigate and implement the UI fix.",
            durationMs: expect.any(Number),
          },
          {
            turn: 2,
            agent: "loom",
            role: "assistant",
            response: "Delegating to worker for investigation.",
            observedDelegation: "worker",
            durationMs: expect.any(Number),
          },
          {
            turn: 3,
            agent: "worker",
            role: "assistant",
            response: "Routing to worker-ui for the UI update.",
            observedDelegation: "worker-ui",
            durationMs: expect.any(Number),
          },
          {
            turn: 4,
            agent: "worker-ui",
            role: "assistant",
            response: "Implemented the requested UI fix.",
            observedDelegation: null,
            durationMs: expect.any(Number),
          },
        ],
        delegationSequence: ["loom", "worker", "worker-ui"],
        delegationTargets: ["worker", "worker-ui"],
        totalTurns: 4,
        completedTurns: 4,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
