import { randomBytes } from "node:crypto"
import { loadEvalCasesForSuite, loadEvalSuiteManifest } from "./loader"
import { executeModelResponse } from "./executors/model-response"
import { executePromptRender } from "./executors/prompt-renderer"
import { executeTrajectoryRun } from "./executors/trajectory-run"
import { DELAY_BETWEEN_CALLS_MS } from "./executors/github-models-api"
import { runDeterministicEvaluator } from "./evaluators/deterministic"
import { runLlmJudgeEvaluator } from "./evaluators/llm-judge"
import { runTrajectoryAssertionEvaluator } from "./evaluators/trajectory-assertion"
import { formatEvalSummary } from "./reporter"
import { ensureEvalStorageDir, writeEvalRunResult } from "./storage"
import { resolveBuiltinAgentTarget } from "./targets/builtin-agent-target"
import type {
  EvalArtifacts,
  EvalCaseResult,
  EvalRunResult,
  EvalRunSummary,
  ExecutionContext,
  LoadedEvalCase,
  ResolvedTarget,
  RunEvalSuiteOptions,
} from "./types"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createRunId(): string {
  return `eval_${randomBytes(6).toString("hex")}`
}

function matchesFilters(evalCase: LoadedEvalCase, filters: RunEvalSuiteOptions["filters"]): boolean {
  if (!filters) return true

  if (filters.caseIds && filters.caseIds.length > 0 && !filters.caseIds.includes(evalCase.id)) {
    return false
  }

  if (
    filters.agents &&
    filters.agents.length > 0 &&
    (evalCase.target.kind !== "builtin-agent-prompt" || !filters.agents.includes(evalCase.target.agent))
  ) {
    return false
  }

  if (filters.tags && filters.tags.length > 0) {
    const tags = new Set(evalCase.tags ?? [])
    if (!filters.tags.every((tag) => tags.has(tag))) {
      return false
    }
  }

  return true
}

function resolveTarget(evalCase: LoadedEvalCase): ResolvedTarget {
  switch (evalCase.target.kind) {
    case "builtin-agent-prompt":
      return resolveBuiltinAgentTarget(evalCase.target)
    case "trajectory-agent": {
      // Resolve the primary agent's prompt for trajectory evals.
      // The trajectory executor will load the scenario separately.
      const agentTarget = resolveBuiltinAgentTarget({
        kind: "builtin-agent-prompt",
        agent: evalCase.target.agent as Parameters<typeof resolveBuiltinAgentTarget>[0]["agent"],
      })
      return {
        target: evalCase.target,
        artifacts: agentTarget.artifacts,
      }
    }
    case "custom-agent-prompt":
    case "single-turn-agent":
      throw new Error(`Target kind ${evalCase.target.kind} is reserved for a later phase and is not implemented yet`)
  }
}

/**
 * Returns true if the case uses an executor that calls an external API,
 * meaning we should rate-limit between consecutive cases.
 */
function needsApiRateLimit(evalCase: LoadedEvalCase): boolean {
  return evalCase.executor.kind === "model-response"
}

async function executeCase(evalCase: LoadedEvalCase, context: ExecutionContext): Promise<EvalCaseResult> {
  const started = Date.now()

  try {
    const resolvedTarget = resolveTarget(evalCase)
    let artifacts: EvalArtifacts

      switch (evalCase.executor.kind) {
        case "prompt-render":
          artifacts = await executePromptRender(resolvedTarget, evalCase.executor, context)
          break
        case "model-response":
          artifacts = await executeModelResponse(resolvedTarget, evalCase.executor, context)
          break
        case "trajectory-run":
          artifacts = await executeTrajectoryRun(resolvedTarget, evalCase.executor, context)
          break
      }

    const assertionResults = evalCase.evaluators.flatMap((evaluator) => {
      if (evaluator.kind === "llm-judge") {
        return runLlmJudgeEvaluator(evaluator, artifacts)
      }
      if (evaluator.kind === "trajectory-assertion") {
        return runTrajectoryAssertionEvaluator(evaluator, artifacts)
      }
      return runDeterministicEvaluator(evaluator, artifacts)
    })
    const rawScore = assertionResults.reduce((sum, result) => sum + result.score, 0)
    const maxScore = assertionResults.reduce((sum, result) => sum + result.maxScore, 0)
    const normalizedScore = maxScore > 0 ? rawScore / maxScore : 0

    return {
      caseId: evalCase.id,
      description: evalCase.description,
      status: assertionResults.every((result) => result.passed) ? "passed" : "failed",
      score: rawScore,
      normalizedScore,
      maxScore,
      durationMs: Date.now() - started,
      artifacts,
      assertionResults,
      errors: [],
    }
  } catch (error) {
    return {
      caseId: evalCase.id,
      description: evalCase.description,
      status: "error",
      score: 0,
      normalizedScore: 0,
      maxScore: 0,
      durationMs: Date.now() - started,
      artifacts: {},
      assertionResults: [],
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

function buildSummary(caseResults: EvalCaseResult[]): EvalRunSummary {
  const totalScore = caseResults.reduce((sum, result) => sum + result.score, 0)
  const maxScore = caseResults.reduce((sum, result) => sum + result.maxScore, 0)
  return {
    totalCases: caseResults.length,
    passedCases: caseResults.filter((result) => result.status === "passed").length,
    failedCases: caseResults.filter((result) => result.status === "failed").length,
    errorCases: caseResults.filter((result) => result.status === "error").length,
    totalScore,
    normalizedScore: maxScore > 0 ? totalScore / maxScore : 0,
    maxScore,
  }
}

export interface RunEvalSuiteOutput {
  result: EvalRunResult
  artifactPath: string
  consoleSummary: string
}

export async function runEvalSuite(options: RunEvalSuiteOptions): Promise<RunEvalSuiteOutput> {
  ensureEvalStorageDir(options.directory)

  const suite = loadEvalSuiteManifest(options.directory, options.suite)
  const selectedCases = loadEvalCasesForSuite(options.directory, suite).filter((evalCase) =>
    matchesFilters(evalCase, options.filters),
  )

  const context: ExecutionContext = {
    mode: options.mode ?? "local",
    directory: options.directory,
    outputPath: options.outputPath,
    modelOverride: options.modelOverride,
  }

  const runId = createRunId()
  const startedAt = new Date().toISOString()
  const caseResults: EvalCaseResult[] = []
  for (let i = 0; i < selectedCases.length; i++) {
    if (i > 0 && needsApiRateLimit(selectedCases[i])) {
      await sleep(DELAY_BETWEEN_CALLS_MS)
    }
    caseResults.push(await executeCase(selectedCases[i], context))
  }
  const finishedAt = new Date().toISOString()

  // Determine the model used for this run: prefer explicit override, then fall
  // back to the first model-response executor's model in the selected cases.
  const firstModelResponseCase = selectedCases.find((c) => c.executor.kind === "model-response")
  const resolvedModel =
    options.modelOverride ??
    (firstModelResponseCase?.executor.kind === "model-response"
      ? firstModelResponseCase.executor.model
      : undefined)

  const result: EvalRunResult = {
    runId,
    startedAt,
    finishedAt,
    suiteId: suite.id,
    phase: suite.phase,
    ...(resolvedModel !== undefined ? { model: resolvedModel } : {}),
    summary: buildSummary(caseResults),
    caseResults,
  }

  const artifactPath = writeEvalRunResult(options.directory, result, options.outputPath)
  const consoleSummary = formatEvalSummary(result)

  return { result, artifactPath, consoleSummary }
}
