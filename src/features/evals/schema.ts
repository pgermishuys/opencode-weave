import { z } from "zod"
import {
  EVAL_PHASES,
  EVAL_TARGET_KINDS,
  EXECUTOR_KINDS,
  EVALUATOR_KINDS,
} from "./types"

const NonEmptyString = z.string().trim().min(1)

export const EvalPhaseSchema = z.enum(EVAL_PHASES)

export const BuiltinAgentPromptVariantSchema = z.object({
  disabledAgents: z.array(NonEmptyString).optional(),
})

export const BuiltinAgentPromptTargetSchema = z.object({
  kind: z.literal("builtin-agent-prompt"),
  agent: z.enum(["loom", "tapestry", "shuttle", "pattern", "thread", "spindle", "weft", "warp"]),
  variant: BuiltinAgentPromptVariantSchema.optional(),
})

export const CustomAgentPromptTargetSchema = z.object({
  kind: z.literal("custom-agent-prompt"),
  agentId: NonEmptyString,
})

export const SingleTurnAgentTargetSchema = z.object({
  kind: z.literal("single-turn-agent"),
  agent: NonEmptyString,
  input: z.string().optional(),
})

export const TrajectoryAgentTargetSchema = z.object({
  kind: z.literal("trajectory-agent"),
  agent: NonEmptyString,
  scenarioRef: NonEmptyString.optional(),
})

export const EvalTargetSchema = z.discriminatedUnion("kind", [
  BuiltinAgentPromptTargetSchema,
  CustomAgentPromptTargetSchema,
  SingleTurnAgentTargetSchema,
  TrajectoryAgentTargetSchema,
])

export const PromptRenderExecutorSchema = z.object({
  kind: z.literal("prompt-render"),
})

export const ModelResponseExecutorSchema = z.object({
  kind: z.literal("model-response"),
  provider: NonEmptyString,
  model: NonEmptyString,
  input: z.string(),
})

export const TrajectoryRunExecutorSchema = z.object({
  kind: z.literal("trajectory-run"),
  scenarioRef: NonEmptyString,
})

export const ExecutorSpecSchema = z.discriminatedUnion("kind", [
  PromptRenderExecutorSchema,
  ModelResponseExecutorSchema,
  TrajectoryRunExecutorSchema,
])

const WeightedEvaluatorSchema = z.object({
  weight: z.number().positive().optional(),
})

export const ContainsAllEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("contains-all"),
  patterns: z.array(NonEmptyString).min(1),
})

export const ContainsAnyEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("contains-any"),
  patterns: z.array(NonEmptyString).min(1),
})

export const ExcludesAllEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("excludes-all"),
  patterns: z.array(NonEmptyString).min(1),
})

export const SectionContainsAllEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("section-contains-all"),
  section: NonEmptyString,
  patterns: z.array(NonEmptyString).min(1),
})

export const OrderedContainsEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("ordered-contains"),
  patterns: z.array(NonEmptyString).min(1),
})

export const XmlSectionsPresentEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("xml-sections-present"),
  sections: z.array(NonEmptyString).min(1),
})

export const ToolPolicyEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("tool-policy"),
  expectations: z.record(z.string(), z.boolean()),
})

export const MinLengthEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("min-length"),
  min: z.number().int().nonnegative(),
})

export const LlmJudgeEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("llm-judge"),
  rubricRef: NonEmptyString.optional(),
  expectedContains: z.array(NonEmptyString).optional(),
  forbiddenContains: z.array(NonEmptyString).optional(),
})

export const BaselineDiffEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("baseline-diff"),
  baselineRef: NonEmptyString.optional(),
})

export const TrajectoryAssertionEvaluatorSchema = WeightedEvaluatorSchema.extend({
  kind: z.literal("trajectory-assertion"),
  assertionRef: NonEmptyString.optional(),
  expectedSequence: z.array(NonEmptyString).optional(),
  requiredAgents: z.array(NonEmptyString).optional(),
  forbiddenAgents: z.array(NonEmptyString).optional(),
  minTurns: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
})

export const TrajectoryTurnSchema = z.object({
  turn: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  agent: NonEmptyString.optional(),
  content: z.string(),
  mockResponse: z.string().optional(),
  expectedDelegation: NonEmptyString.optional(),
})

export const TrajectoryScenarioSchema = z.object({
  id: NonEmptyString,
  title: NonEmptyString,
  description: z.string().optional(),
  agents: z.array(NonEmptyString).min(1),
  turns: z.array(TrajectoryTurnSchema).min(2),
})

export const EvaluatorSpecSchema = z.discriminatedUnion("kind", [
  ContainsAllEvaluatorSchema,
  ContainsAnyEvaluatorSchema,
  ExcludesAllEvaluatorSchema,
  SectionContainsAllEvaluatorSchema,
  OrderedContainsEvaluatorSchema,
  XmlSectionsPresentEvaluatorSchema,
  ToolPolicyEvaluatorSchema,
  MinLengthEvaluatorSchema,
  LlmJudgeEvaluatorSchema,
  BaselineDiffEvaluatorSchema,
  TrajectoryAssertionEvaluatorSchema,
])

export const EvalCaseSchema = z.object({
  id: NonEmptyString,
  title: NonEmptyString,
  description: z.string().optional(),
  phase: EvalPhaseSchema,
  target: EvalTargetSchema,
  executor: ExecutorSpecSchema,
  evaluators: z.array(EvaluatorSpecSchema).min(1),
  tags: z.array(NonEmptyString).optional(),
  notes: z.string().optional(),
})

export const EvalSuiteManifestSchema = z.object({
  id: NonEmptyString,
  title: NonEmptyString,
  phase: EvalPhaseSchema,
  caseFiles: z.array(NonEmptyString).min(1),
  tags: z.array(NonEmptyString).optional(),
})

export const AssertionResultSchema = z.object({
  evaluatorKind: z.enum(EVALUATOR_KINDS),
  passed: z.boolean(),
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  message: z.string(),
})

export const EvalArtifactsSchema = z.object({
  renderedPrompt: z.string().optional(),
  agentMetadata: z
    .object({
      agent: z.string(),
      description: z.string().optional(),
      sourceKind: z.enum(["composer", "default"]),
    })
    .optional(),
  toolPolicy: z.record(z.string(), z.boolean()).optional(),
  promptLength: z.number().int().nonnegative().optional(),
  modelOutput: z.string().optional(),
  judgeOutput: z.string().optional(),
  trace: z.unknown().optional(),
  tokens: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  baselineDelta: z.unknown().optional(),
})

export const EvalCaseResultSchema = z.object({
  caseId: z.string(),
  description: z.string().optional(),
  status: z.enum(["passed", "failed", "error"]),
  score: z.number().nonnegative(),
  normalizedScore: z.number().min(0).max(1),
  maxScore: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  artifacts: EvalArtifactsSchema,
  assertionResults: z.array(AssertionResultSchema),
  errors: z.array(z.string()),
})

export const EvalRunSummarySchema = z.object({
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  errorCases: z.number().int().nonnegative(),
  totalScore: z.number().nonnegative(),
  normalizedScore: z.number().min(0).max(1),
  maxScore: z.number().nonnegative(),
})

export const EvalRunResultSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  suiteId: z.string(),
  phase: EvalPhaseSchema,
  summary: EvalRunSummarySchema,
  caseResults: z.array(EvalCaseResultSchema),
})

export function formatSchemaIssues(filePath: string, issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "<root>"
      return `${filePath}:${fieldPath} ${issue.message}`
    })
    .join("\n")
}

export const AllowedEvalTargetKinds = [...EVAL_TARGET_KINDS]
export const AllowedExecutorKinds = [...EXECUTOR_KINDS]
export const AllowedEvaluatorKinds = [...EVALUATOR_KINDS]
