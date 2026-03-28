/**
 * Phase 1 eval harness for deterministic prompt-contract coverage.
 *
 * Extension points are intentionally registry-based:
 * - add new target `kind` values in `types.ts` + `schema.ts`
 * - add new executor handlers in `runner.ts`
 * - add new evaluator handlers in `evaluators/`
 * - keep `EvalRunResult` top-level keys stable for future baselines
 *
 * Promptfoo, if adopted later, should plug in behind executor/judge adapters.
 */

export type {
  EvalPhase,
  EvalTarget,
  ExecutorSpec,
  EvaluatorSpec,
  EvalSuiteManifest,
  EvalCase,
  LoadedEvalCase,
  LoadedEvalSuiteManifest,
  EvalArtifacts,
  AssertionResult,
  EvalCaseResult,
  EvalRunResult,
  EvalRunSummary,
  RunEvalSuiteOptions,
  RunnerFilters,
  TrajectoryScenario,
  TrajectoryTurn,
  TrajectoryTrace,
  TrajectoryTurnResult,
  TrajectoryAssertionEvaluator,
} from "./types"

export { isTrajectoryTrace } from "./types"

export {
  EvalCaseSchema,
  EvalSuiteManifestSchema,
  EvalRunResultSchema,
  TrajectoryScenarioSchema,
  TrajectoryTurnSchema,
  TrajectoryAssertionEvaluatorSchema,
} from "./schema"
export {
  EvalConfigError,
  loadEvalSuiteManifest,
  loadEvalCasesForSuite,
  resolveSuitePath,
  loadTrajectoryScenario,
} from "./loader"
export { resolveBuiltinAgentTarget } from "./targets/builtin-agent-target"
export { executePromptRender } from "./executors/prompt-renderer"
export { executeModelResponse } from "./executors/model-response"
export { executeTrajectoryRun, detectDelegation } from "./executors/trajectory-run"
export { runDeterministicEvaluator } from "./evaluators/deterministic"
export { runLlmJudgeEvaluator } from "./evaluators/llm-judge"
export { runTrajectoryAssertionEvaluator } from "./evaluators/trajectory-assertion"
export { deriveDeterministicBaseline, readDeterministicBaseline, compareDeterministicBaseline } from "./baseline"
export { ensureEvalStorageDir, getDefaultEvalRunPath, writeEvalRunResult, getDefaultJsonlPath, appendEvalRunJsonl } from "./storage"
export { formatEvalSummary, formatJobSummaryMarkdown } from "./reporter"
export type { RunEvalSuiteOutput } from "./runner"
export { runEvalSuite } from "./runner"
