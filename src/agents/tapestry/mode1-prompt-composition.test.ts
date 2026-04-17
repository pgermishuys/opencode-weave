/**
 * Mode 1 prompt composition tests — deterministic assertions against the
 * composed Tapestry prompt for uncategorized (no categories) delegation.
 *
 * These tests verify the prompt *says the right things* without calling an LLM.
 */

import { describe, it, expect } from "bun:test"
import {
  composeTapestryPrompt,
  buildTapestryParallelismSection,
  buildTapestryDelegationSection,
  buildTapestryVerificationSection,
  buildTapestryErrorHandlingSection,
} from "./prompt-composer"

describe("Mode 1 prompt composition — parallelism", () => {
  it("parallelism section instructs grouping by file disjointness", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("disjoint")
    expect(section).toContain("Files")
  })

  it("parallelism section instructs sequential execution for overlapping files", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("share any file path")
    expect(section).toContain("SEQUENTIAL")
  })

  it("parallelism section specifies max concurrency of 3", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("Maximum 3 concurrent")
  })

  it("parallelism section instructs multiple Task tool calls in a single response for parallel batches", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("multiple Task tool calls in a single response")
  })

  it("parallelism section defaults to sequential when in doubt", () => {
    const section = buildTapestryParallelismSection()
    expect(section).toContain("When in doubt, run sequentially")
  })
})

describe("Mode 1 prompt composition — delegation context", () => {
  it("delegation section instructs including What field in Task tool prompt", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("What")
  })

  it("delegation section instructs including Files field in Task tool prompt", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("Files")
  })

  it("delegation section instructs including Acceptance field in Task tool prompt", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("Acceptance")
  })

  it("delegation section instructs including task number in delegation prompt", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain("N/M")
  })

  it("delegation section instructs reading learnings file before delegating", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain(".weave/learnings/")
  })

  it("delegation section uses subagent_type shuttle", () => {
    const section = buildTapestryDelegationSection()
    expect(section).toContain('subagent_type="shuttle"')
  })
})

describe("Mode 1 prompt composition — verification", () => {
  it("verification section instructs re-reading files Shuttle modified", () => {
    const section = buildTapestryVerificationSection()
    expect(section).toContain("Re-read every file Shuttle claimed to modify")
  })

  it("verification section instructs checking acceptance criteria before marking complete", () => {
    const section = buildTapestryVerificationSection()
    expect(section).toContain("acceptance criteria")
    expect(section).toContain("BEFORE marking")
  })

  it("verification section references ErrorHandling for failures", () => {
    const section = buildTapestryVerificationSection()
    expect(section).toContain("ErrorHandling")
  })
})

describe("Mode 1 prompt composition — error handling and retry", () => {
  it("error handling section instructs retry with error context appended", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("error output appended")
  })

  it("error handling section instructs marking task blocked after retry failure", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("Mark the task blocked")
  })

  it("error handling section instructs escalating to user after 3 consecutive failures", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("Three or more consecutive failures")
    expect(section).toContain("report to the user")
  })

  it("error handling section forbids silently skipping failed tasks", () => {
    const section = buildTapestryErrorHandlingSection()
    expect(section).toContain("NEVER silently skip")
  })
})

describe("Mode 1 prompt composition — full composed prompt", () => {
  it("composed prompt contains Delegation section before PlanExecution", () => {
    const prompt = composeTapestryPrompt()
    const delegationIdx = prompt.indexOf("<Delegation>")
    const planExecIdx = prompt.indexOf("<PlanExecution>")
    expect(delegationIdx).toBeGreaterThan(-1)
    expect(planExecIdx).toBeGreaterThan(-1)
    expect(delegationIdx).toBeLessThan(planExecIdx)
  })

  it("composed prompt contains Parallelism section before PlanExecution", () => {
    const prompt = composeTapestryPrompt()
    const parallelismIdx = prompt.indexOf("<Parallelism>")
    const planExecIdx = prompt.indexOf("<PlanExecution>")
    expect(parallelismIdx).toBeGreaterThan(-1)
    expect(parallelismIdx).toBeLessThan(planExecIdx)
  })

  it("composed prompt contains ErrorHandling section after Verification", () => {
    const prompt = composeTapestryPrompt()
    const verificationIdx = prompt.indexOf("<Verification>")
    const errorHandlingIdx = prompt.indexOf("<ErrorHandling>")
    expect(errorHandlingIdx).toBeGreaterThan(-1)
    expect(errorHandlingIdx).toBeGreaterThan(verificationIdx)
  })

  it("composed prompt does not say 'you work directly'", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt).not.toContain("you work directly")
  })

  it("composed prompt references delegation to Shuttle", () => {
    const prompt = composeTapestryPrompt()
    expect(prompt).toContain("delegate")
    expect(prompt).toContain("Shuttle")
    expect(prompt).toContain("subagent_type")
  })
})
