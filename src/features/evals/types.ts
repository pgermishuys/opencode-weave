import type { WeaveAgentName } from "../../agents/types"

export const EVAL_PHASES = ["prompt", "routing", "trajectory", "experimental"] as const
export type EvalPhase = (typeof EVAL_PHASES)[number]

export const EVAL_TARGET_KINDS = [
  "builtin-agent-prompt",
  "custom-agent-prompt",
  "single-turn-agent",
  "trajectory-agent",
] as const
export type EvalTargetKind = (typeof EVAL_TARGET_KINDS)[number]

export const EXECUTOR_KINDS = ["prompt-render", "model-response", "trajectory-run"] as const
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number]

export const EVALUATOR_KINDS = [
  "contains-all",
  "contains-any",
  "excludes-all",
  "section-contains-all",
  "ordered-contains",
  "xml-sections-present",
  "tool-policy",
  "min-length",
  "llm-judge",
  "baseline-diff",
  "trajectory-assertion",
] as const
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number]

export type BuiltinEvalAgentName = WeaveAgentName

export interface BuiltinAgentPromptVariant {
  disabledAgents?: string[]
}

export interface BuiltinAgentPromptTarget {
  kind: "builtin-agent-prompt"
  agent: BuiltinEvalAgentName
  variant?: BuiltinAgentPromptVariant
}

export interface CustomAgentPromptTarget {
  kind: "custom-agent-prompt"
  agentId: string
}

export interface SingleTurnAgentTarget {
  kind: "single-turn-agent"
  agent: string
  input?: string
}

export interface TrajectoryAgentTarget {
  kind: "trajectory-agent"
  agent: string
  scenarioRef?: string
}

export type EvalTarget =
  | BuiltinAgentPromptTarget
  | CustomAgentPromptTarget
  | SingleTurnAgentTarget
  | TrajectoryAgentTarget

export interface PromptRenderExecutor {
  kind: "prompt-render"
}

export interface ModelResponseExecutor {
  kind: "model-response"
  provider: string
  model: string
  input: string
}

export interface TrajectoryRunExecutor {
  kind: "trajectory-run"
  scenarioRef: string
}

export type ExecutorSpec = PromptRenderExecutor | ModelResponseExecutor | TrajectoryRunExecutor

export interface WeightedEvaluatorSpec {
  weight?: number
}

export interface ContainsAllEvaluator extends WeightedEvaluatorSpec {
  kind: "contains-all"
  patterns: string[]
}

export interface ContainsAnyEvaluator extends WeightedEvaluatorSpec {
  kind: "contains-any"
  patterns: string[]
}

export interface ExcludesAllEvaluator extends WeightedEvaluatorSpec {
  kind: "excludes-all"
  patterns: string[]
}

export interface SectionContainsAllEvaluator extends WeightedEvaluatorSpec {
  kind: "section-contains-all"
  section: string
  patterns: string[]
}

export interface OrderedContainsEvaluator extends WeightedEvaluatorSpec {
  kind: "ordered-contains"
  patterns: string[]
}

export interface XmlSectionsPresentEvaluator extends WeightedEvaluatorSpec {
  kind: "xml-sections-present"
  sections: string[]
}

export interface ToolPolicyEvaluator extends WeightedEvaluatorSpec {
  kind: "tool-policy"
  expectations: Record<string, boolean>
}

export interface MinLengthEvaluator extends WeightedEvaluatorSpec {
  kind: "min-length"
  min: number
}

export interface LlmJudgeEvaluator extends WeightedEvaluatorSpec {
  kind: "llm-judge"
  rubricRef?: string
  expectedContains?: string[]
  forbiddenContains?: string[]
}

export interface BaselineDiffEvaluator extends WeightedEvaluatorSpec {
  kind: "baseline-diff"
  baselineRef?: string
}

export interface TrajectoryAssertionEvaluator extends WeightedEvaluatorSpec {
  kind: "trajectory-assertion"
  assertionRef?: string
  expectedSequence?: string[]
  requiredAgents?: string[]
  forbiddenAgents?: string[]
  minTurns?: number
  maxTurns?: number
}

export type EvaluatorSpec =
  | ContainsAllEvaluator
  | ContainsAnyEvaluator
  | ExcludesAllEvaluator
  | SectionContainsAllEvaluator
  | OrderedContainsEvaluator
  | XmlSectionsPresentEvaluator
  | ToolPolicyEvaluator
  | MinLengthEvaluator
  | LlmJudgeEvaluator
  | BaselineDiffEvaluator
  | TrajectoryAssertionEvaluator

export interface EvalSuiteManifest {
  id: string
  title: string
  phase: EvalPhase
  caseFiles: string[]
  tags?: string[]
}

export interface EvalCase {
  id: string
  title: string
  description?: string
  phase: EvalPhase
  target: EvalTarget
  executor: ExecutorSpec
  evaluators: EvaluatorSpec[]
  tags?: string[]
  notes?: string
}

export interface LoadedEvalSuiteManifest extends EvalSuiteManifest {
  filePath: string
}

export interface LoadedEvalCase extends EvalCase {
  filePath: string
}

export interface AgentPromptMetadataArtifact {
  agent: string
  description?: string
  sourceKind: "composer" | "default"
}

export interface EvalArtifacts {
  renderedPrompt?: string
  agentMetadata?: AgentPromptMetadataArtifact
  toolPolicy?: Record<string, boolean>
  promptLength?: number
  modelOutput?: string
  judgeOutput?: string
  trace?: unknown
  tokens?: number
  cost?: number
  baselineDelta?: unknown
}

export interface AssertionResult {
  evaluatorKind: EvaluatorKind
  passed: boolean
  score: number
  maxScore: number
  message: string
}

export interface EvalCaseResult {
  caseId: string
  description?: string
  status: "passed" | "failed" | "error"
  score: number
  normalizedScore: number
  maxScore: number
  durationMs: number
  artifacts: EvalArtifacts
  assertionResults: AssertionResult[]
  errors: string[]
}

export interface EvalRunSummary {
  totalCases: number
  passedCases: number
  failedCases: number
  errorCases: number
  totalScore: number
  normalizedScore: number
  maxScore: number
}

export interface EvalRunResult {
  runId: string
  startedAt: string
  finishedAt: string
  suiteId: string
  phase: EvalPhase
  model?: string
  summary: EvalRunSummary
  caseResults: EvalCaseResult[]
}

export interface ResolvedTarget {
  target: EvalTarget
  artifacts: EvalArtifacts
}

export interface ExecutionContext {
  mode: "local" | "ci" | "hosted"
  directory: string
  outputPath?: string
  modelOverride?: string
}

export interface RunnerFilters {
  caseIds?: string[]
  agents?: string[]
  tags?: string[]
}

export interface RunEvalSuiteOptions {
  directory: string
  suite: string
  filters?: RunnerFilters
  outputPath?: string
  mode?: ExecutionContext["mode"]
  modelOverride?: string
}

export interface EvalLoadErrorContext {
  filePath: string
  detail: string
}

export interface DeterministicBaselineCase {
  caseId: string
  status: EvalCaseResult["status"]
  normalizedScore: number
  assertionPassed: number
  assertionFailed: number
  errorCount: number
}

export interface DeterministicBaseline {
  version: 1
  suiteId: string
  phase: EvalPhase
  generatedAt: string
  normalizedScore: number
  cases: DeterministicBaselineCase[]
}

export interface BaselineComparisonOptions {
  scoreDropTolerance?: number
}

export interface BaselineComparison {
  outcome: "no-regression" | "informational-diff" | "regression"
  regressions: string[]
  informational: string[]
}

// --- Trajectory types (Phase 3) ---

export interface TrajectoryTurn {
  turn: number
  role: "user" | "assistant"
  agent?: string
  content: string
  mockResponse?: string
  expectedDelegation?: string
}

export interface TrajectoryScenario {
  id: string
  title: string
  description?: string
  agents: string[]
  turns: TrajectoryTurn[]
}

export interface TrajectoryTurnResult {
  turn: number
  agent: string
  role: "user" | "assistant"
  response: string
  expectedDelegation?: string
  observedDelegation?: string | null
  durationMs: number
}

export interface TrajectoryTrace {
  scenarioId: string
  turns: TrajectoryTurnResult[]
  delegationSequence: string[]
  totalTurns: number
  completedTurns: number
}

export function isTrajectoryTrace(trace: unknown): trace is TrajectoryTrace {
  if (!trace || typeof trace !== "object") return false
  const t = trace as Record<string, unknown>
  return (
    typeof t.scenarioId === "string" &&
    Array.isArray(t.turns) &&
    Array.isArray(t.delegationSequence) &&
    typeof t.totalTurns === "number" &&
    typeof t.completedTurns === "number"
  )
}
