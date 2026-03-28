import type { AssertionResult, EvalArtifacts, LlmJudgeEvaluator } from "../types"

function getWeight(spec: LlmJudgeEvaluator): number {
  return spec.weight ?? 1
}

export function runLlmJudgeEvaluator(spec: LlmJudgeEvaluator, artifacts: EvalArtifacts): AssertionResult[] {
  const output = artifacts.modelOutput ?? ""
  const expected = spec.expectedContains ?? []
  const forbidden = spec.forbiddenContains ?? []
  const totalChecks = expected.length + forbidden.length
  const perItem = totalChecks > 0 ? getWeight(spec) / totalChecks : getWeight(spec)
  const results: AssertionResult[] = []

  const outputLower = output.toLowerCase()

  for (const pattern of expected) {
    const passed = outputLower.includes(pattern.toLowerCase())
    results.push({
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Judge check passed: output contains '${pattern}'`
        : `Judge check failed: output missing '${pattern}'`,
    })
  }

  for (const pattern of forbidden) {
    const passed = !outputLower.includes(pattern.toLowerCase())
    results.push({
      evaluatorKind: spec.kind,
      passed,
      score: passed ? perItem : 0,
      maxScore: perItem,
      message: passed
        ? `Judge check passed: output excludes '${pattern}'`
        : `Judge check failed: output contains forbidden '${pattern}'`,
    })
  }

  if (results.length === 0) {
    results.push({
      evaluatorKind: spec.kind,
      passed: output.length > 0,
      score: output.length > 0 ? getWeight(spec) : 0,
      maxScore: getWeight(spec),
      message: output.length > 0 ? "Judge check passed: model output present" : "Judge check failed: empty model output",
    })
  }

  return results
}
