import type { EvalCaseResult, EvalRunResult } from "./types"
import { isTrajectoryTrace } from "./types"

function formatCaseLine(result: EvalCaseResult): string {
  const status = result.status.toUpperCase()
  return `- ${result.caseId}: ${status} (${result.normalizedScore.toFixed(2)} normalized, ${result.score.toFixed(2)}/${result.maxScore.toFixed(2)} raw)`
}

function formatTrajectoryDetail(result: EvalCaseResult): string | null {
  if (!isTrajectoryTrace(result.artifacts.trace)) return null
  const trace = result.artifacts.trace
  return `    Trajectory: [${trace.delegationSequence.join(" → ")}] (${trace.completedTurns} turns)`
}

export function formatEvalSummary(result: EvalRunResult): string {
  const suiteRole = result.suiteId === "prompt-smoke" ? "PR smoke" : result.suiteId === "prompt-contracts" ? "full deterministic" : "custom"
  const lines = [
    `Suite ${result.suiteId} (${result.phase})${result.model ? ` — Model: ${result.model}` : ""}`,
    `- Suite role: ${suiteRole}`,
    `- Cases: ${result.summary.totalCases}`,
    `- Passed: ${result.summary.passedCases}`,
    `- Failed: ${result.summary.failedCases}`,
    `- Errors: ${result.summary.errorCases}`,
    `- Normalized score: ${result.summary.normalizedScore.toFixed(2)}`,
    `- Score: ${result.summary.totalScore.toFixed(2)}/${result.summary.maxScore.toFixed(2)}`,
  ]

  const worstResults = [...result.caseResults]
    .filter((caseResult) => caseResult.status !== "passed")
    .sort((left, right) => left.normalizedScore - right.normalizedScore)
    .slice(0, 3)

  if (worstResults.length > 0) {
    lines.push("- Worst results:")
    for (const caseResult of worstResults) {
      lines.push(`  ${formatCaseLine(caseResult)}`)
      const trajectoryDetail = formatTrajectoryDetail(caseResult)
      if (trajectoryDetail) {
        lines.push(trajectoryDetail)
      }
      const firstFailure = caseResult.assertionResults.find((assertion) => !assertion.passed)
      if (firstFailure) {
        lines.push(`    ${firstFailure.message}`)
      } else if (caseResult.errors.length > 0) {
        lines.push(`    ${caseResult.errors[0]}`)
      }
    }
  }

  return lines.join("\n")
}

export function formatJobSummaryMarkdown(result: EvalRunResult): string {
  const pct = ((result.summary.passedCases / result.summary.totalCases) * 100).toFixed(1)
  const durationMs = new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()
  const durationSec = (durationMs / 1000).toFixed(1)

  let md = `## 🧪 Eval: ${result.suiteId}\n\n`
  md += `**Phase**: \`${result.phase}\``
  if (result.model) {
    md += ` | **Model**: \`${result.model}\``
  }
  md += ` | **Score**: ${result.summary.passedCases}/${result.summary.totalCases} (${pct}%) | **Duration**: ${durationSec}s\n\n`

  md += `| Case | Result | Score |\n`
  md += `|------|--------|-------|\n`
  for (const caseResult of result.caseResults) {
    const icon = caseResult.status === "passed" ? "✅ Pass" : caseResult.status === "error" ? "💥 Error" : "❌ Fail"
    md += `| ${caseResult.caseId} | ${icon} | ${caseResult.normalizedScore.toFixed(2)} |\n`
  }

  const failed = result.caseResults.filter((c) => c.status !== "passed")
  if (failed.length > 0) {
    md += `\n<details>\n<summary>📋 Failed Case Details</summary>\n\n`
    for (const caseResult of failed) {
      const icon = caseResult.status === "error" ? "💥" : "❌"
      md += `### ${caseResult.caseId} ${icon}\n\n`
      for (const assertion of caseResult.assertionResults.filter((a) => !a.passed)) {
        md += `- ${assertion.message}\n`
      }
      for (const error of caseResult.errors) {
        md += `- Error: ${error}\n`
      }
      md += `\n`
    }
    md += `</details>\n`
  }

  return md
}
