import { callGitHubModels } from "./github-models-api"
import { callAnthropic } from "./anthropic-api"
import type { EvalArtifacts, ExecutionContext, ModelResponseExecutor, ResolvedTarget } from "../types"

function redactProvider(value: string): string {
  return value.length <= 3 ? "***" : `${value.slice(0, 1)}***${value.slice(-1)}`
}

/**
 * Determines whether a model name refers to an Anthropic/Claude model.
 */
function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-")
}

/**
 * Resolves the provider for a given executor and model.
 *
 * When a model override is active (e.g. --model claude-sonnet-4-20250514), the
 * executor's `provider` field still says "github-models" from the JSONC case file.
 * We infer the actual provider from the model name in that scenario.
 */
function resolveProvider(executor: ModelResponseExecutor, model: string): "anthropic" | "github-models" {
  if (isAnthropicModel(model)) return "anthropic"
  return executor.provider === "anthropic" ? "anthropic" : "github-models"
}

/**
 * Executes a model-response eval case by calling the appropriate LLM API.
 *
 * Routes to Anthropic Messages API for claude-* models, otherwise uses
 * GitHub Models API. Requires ANTHROPIC_API_KEY or GITHUB_TOKEN env var
 * depending on the resolved provider.
 */
export async function executeModelResponse(
  resolvedTarget: ResolvedTarget,
  executor: ModelResponseExecutor,
  context: ExecutionContext,
): Promise<EvalArtifacts> {
  const model = context.modelOverride ?? executor.model
  const provider = resolveProvider(executor, model)
  const systemPrompt = resolvedTarget.artifacts.renderedPrompt ?? ""

  let content: string
  let durationMs: number

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "Model-response executor requires ANTHROPIC_API_KEY environment variable for Anthropic API access.",
      )
    }
    ;({ content, durationMs } = await callAnthropic(systemPrompt, executor.input, model, apiKey))
  } else {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      throw new Error(
        "Model-response executor requires GITHUB_TOKEN environment variable for GitHub Models API access.",
      )
    }
    ;({ content, durationMs } = await callGitHubModels(systemPrompt, executor.input, model, token))
  }

  return {
    ...resolvedTarget.artifacts,
    modelOutput: content,
    judgeOutput: undefined,
    baselineDelta: {
      provider: redactProvider(provider),
      model,
      durationMs,
    },
  }
}
