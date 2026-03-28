import { describe, expect, it } from "bun:test"
import { formatEvalSummary, formatJobSummaryMarkdown } from "./reporter"
import fixture from "./__fixtures__/phase1-run-result.json"
import type { EvalRunResult, EvalCaseResult } from "./types"

const typedFixture = fixture as unknown as EvalRunResult

describe("formatEvalSummary", () => {
  it("formats a concise suite summary", () => {
    const summary = formatEvalSummary(typedFixture)
    expect(summary).toContain("Suite prompt-contracts")
    expect(summary).toContain("Suite role: full deterministic")
    expect(summary).toContain("Cases: 1")
    expect(summary).toContain("Normalized score: 1.00")
    expect(summary).toContain("Score: 1.00/1.00")
  })

  it("labels pr-smoke runs as PR smoke", () => {
    const summary = formatEvalSummary({
      ...typedFixture,
      suiteId: "prompt-smoke",
    })
    expect(summary).toContain("Suite role: PR smoke")
  })
})

describe("formatJobSummaryMarkdown", () => {
  it("renders a Markdown table with case IDs and result icons for all-passing results", () => {
    const md = formatJobSummaryMarkdown(typedFixture)
    expect(md).toContain("## 🧪 Eval: prompt-contracts")
    expect(md).toContain("**Phase**: `prompt`")
    expect(md).toContain("1/1 (100.0%)")
    expect(md).toContain("| Case | Result | Score |")
    expect(md).toContain("| fixture-case | ✅ Pass | 1.00 |")
    expect(md).not.toContain("Failed Case Details")
  })

  it("renders failed case details when cases fail", () => {
    const failedCase: EvalCaseResult = {
      caseId: "failing-case",
      status: "failed",
      score: 0,
      normalizedScore: 0,
      maxScore: 1,
      durationMs: 50,
      artifacts: { renderedPrompt: "", agentMetadata: { agent: "loom", description: "test", sourceKind: "composer" }, toolPolicy: {}, promptLength: 0 },
      assertionResults: [
        { evaluatorKind: "contains-all", passed: false, score: 0, maxScore: 1, message: "Missing required pattern: shuttle" },
      ],
      errors: [],
    }
    const result: EvalRunResult = {
      ...typedFixture,
      summary: {
        totalCases: 2,
        passedCases: 1,
        failedCases: 1,
        errorCases: 0,
        totalScore: 1,
        normalizedScore: 0.5,
        maxScore: 2,
      },
      caseResults: [...typedFixture.caseResults, failedCase],
    }

    const md = formatJobSummaryMarkdown(result)
    expect(md).toContain("1/2 (50.0%)")
    expect(md).toContain("| failing-case | ❌ Fail | 0.00 |")
    expect(md).toContain("Failed Case Details")
    expect(md).toContain("Missing required pattern: shuttle")
  })

  it("renders error cases with the error icon", () => {
    const errorCase: EvalCaseResult = {
      caseId: "error-case",
      status: "error",
      score: 0,
      normalizedScore: 0,
      maxScore: 1,
      durationMs: 100,
      artifacts: { renderedPrompt: "", agentMetadata: { agent: "loom", description: "test", sourceKind: "composer" }, toolPolicy: {}, promptLength: 0 },
      assertionResults: [],
      errors: ["API timeout after 30s"],
    }
    const result: EvalRunResult = {
      ...typedFixture,
      summary: {
        totalCases: 1,
        passedCases: 0,
        failedCases: 0,
        errorCases: 1,
        totalScore: 0,
        normalizedScore: 0,
        maxScore: 1,
      },
      caseResults: [errorCase],
    }

    const md = formatJobSummaryMarkdown(result)
    expect(md).toContain("| error-case | 💥 Error | 0.00 |")
    expect(md).toContain("error-case 💥")
    expect(md).toContain("Error: API timeout after 30s")
  })
})
