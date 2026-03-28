import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { cpSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { runEvalSuite } from "./runner"
import { isTrajectoryTrace } from "./types"

describe("runEvalSuite", () => {
  it("runs the committed prompt-contracts suite from copied eval assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-"))
    try {
      cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })
      const output = await runEvalSuite({ directory: dir, suite: "prompt-contracts" })
      expect(output.result.suiteId).toBe("prompt-contracts")
      expect(output.result.summary.totalCases).toBeGreaterThan(0)
      expect(output.result.summary.normalizedScore).toBeGreaterThan(0)
      expect(output.result.summary.normalizedScore).toBeLessThanOrEqual(1)
      expect(output.result.caseResults.some((result) => result.status === "passed")).toBe(true)
      for (const result of output.result.caseResults) {
        expect(result.normalizedScore).toBeGreaterThanOrEqual(0)
        expect(result.normalizedScore).toBeLessThanOrEqual(1)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("agent-routing errors without GITHUB_TOKEN (live-only)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-routing-"))
    const savedToken = process.env.GITHUB_TOKEN
    try {
      delete process.env.GITHUB_TOKEN
      cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })

      const output = await runEvalSuite({
        directory: dir,
        suite: "agent-routing",
        filters: { caseIds: ["route-to-thread-exploration"] },
      })

      // Should produce an error case, not crash
      expect(output.result.summary.totalCases).toBe(1)
      expect(output.result.summary.errorCases).toBe(1)
      expect(output.result.caseResults[0].errors[0]).toContain("GITHUB_TOKEN")
    } finally {
      if (savedToken !== undefined) {
        process.env.GITHUB_TOKEN = savedToken
      } else {
        delete process.env.GITHUB_TOKEN
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe("trajectory eval", () => {
    it("runs the agent-trajectory suite end-to-end", async () => {
      const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-trajectory-"))
      try {
        cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })
        const output = await runEvalSuite({ directory: dir, suite: "agent-trajectory" })

        expect(output.result.suiteId).toBe("agent-trajectory")
        expect(output.result.phase).toBe("trajectory")
        expect(output.result.summary.totalCases).toBe(7)
        expect(output.result.summary.passedCases).toBe(7)
        expect(output.result.summary.failedCases).toBe(0)
        expect(output.result.summary.errorCases).toBe(0)
        expect(output.result.summary.normalizedScore).toBe(1)

        // Verify trajectory artifacts are present
        for (const result of output.result.caseResults) {
          expect(isTrajectoryTrace(result.artifacts.trace)).toBe(true)
          expect(result.artifacts.modelOutput).toBeDefined()
          expect(typeof result.artifacts.modelOutput).toBe("string")
          expect(result.artifacts.modelOutput!.length).toBeGreaterThan(0)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("produces correct delegation sequence for pattern delegation case", async () => {
      const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-trajectory-detail-"))
      try {
        cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })
        const output = await runEvalSuite({
          directory: dir,
          suite: "agent-trajectory",
          filters: { caseIds: ["trajectory-loom-delegates-to-pattern"] },
        })

        expect(output.result.summary.totalCases).toBe(1)
        expect(output.result.summary.passedCases).toBe(1)

        const caseResult = output.result.caseResults[0]
        expect(isTrajectoryTrace(caseResult.artifacts.trace)).toBe(true)

        const trace = caseResult.artifacts.trace as {
          scenarioId: string
          delegationSequence: string[]
          completedTurns: number
        }
        expect(trace.scenarioId).toBe("loom-delegates-to-pattern")
        expect(trace.delegationSequence).toEqual(["loom", "pattern", "loom"])
        expect(trace.completedTurns).toBe(4)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("produces correct delegation sequence for self-handle case", async () => {
      const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-trajectory-self-"))
      try {
        cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })
        const output = await runEvalSuite({
          directory: dir,
          suite: "agent-trajectory",
          filters: { caseIds: ["trajectory-loom-self-handle-simple"] },
        })

        expect(output.result.summary.totalCases).toBe(1)
        expect(output.result.summary.passedCases).toBe(1)

        const caseResult = output.result.caseResults[0]
        const trace = caseResult.artifacts.trace as {
          scenarioId: string
          delegationSequence: string[]
          completedTurns: number
        }
        expect(trace.scenarioId).toBe("loom-self-handle-simple")
        expect(trace.delegationSequence).toEqual(["loom"])
        expect(trace.completedTurns).toBe(2)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("does not break prompt-contracts when trajectory suite also runs", async () => {
      const dir = mkdtempSync(join(tmpdir(), "weave-evals-runner-phase1-after-trajectory-"))
      try {
        cpSync(join(process.cwd(), "evals"), join(dir, "evals"), { recursive: true })

        // Run both suites in the same directory
        const trajectoryOutput = await runEvalSuite({ directory: dir, suite: "agent-trajectory" })
        const promptOutput = await runEvalSuite({ directory: dir, suite: "prompt-contracts" })

        expect(trajectoryOutput.result.summary.passedCases).toBe(7)
        expect(promptOutput.result.summary.normalizedScore).toBeGreaterThan(0)
        expect(promptOutput.result.summary.errorCases).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
