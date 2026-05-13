import type { AgentConfig } from "@opencode-ai/sdk"
import type { ResolvedContinuationConfig } from "../../config/continuation"
import type { CategoriesConfig } from "../../config/schema"
import type { AgentFactory } from "../types"
import type { ReviewModelVariant } from "../review-model-variants"
import { TAPESTRY_DEFAULTS } from "./default"
import { composeTapestryPrompt } from "./prompt-composer"

export { composeTapestryPrompt } from "./prompt-composer"
export type { TapestryPromptOptions } from "./prompt-composer"

/**
 * Create a Tapestry agent config with optional disabled agents for prompt composition.
 */
export function createTapestryAgentWithOptions(
  model: string,
  disabledAgents?: Set<string>,
  continuation?: ResolvedContinuationConfig,
  categories?: CategoriesConfig,
  reviewModelVariants?: ReviewModelVariant[],
): AgentConfig {
  return {
    ...TAPESTRY_DEFAULTS,
    tools: { ...TAPESTRY_DEFAULTS.tools },
    prompt: composeTapestryPrompt({ disabledAgents, continuation, categories, reviewModelVariants }),
    model,
    mode: "primary",
  }
}

export const createTapestryAgent: AgentFactory = (model: string): AgentConfig => ({
  ...TAPESTRY_DEFAULTS,
  tools: { ...TAPESTRY_DEFAULTS.tools },
  model,
  mode: "primary",
})
createTapestryAgent.mode = "primary"
