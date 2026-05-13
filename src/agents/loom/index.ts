import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import type { AvailableAgent } from "../dynamic-prompt-builder"
import type { ProjectFingerprint } from "../../features/analytics/types"
import type { CategoriesConfig } from "../../config/schema"
import type { ReviewModelVariant } from "../review-model-variants"
import { LOOM_DEFAULTS } from "./default"
import { composeLoomPrompt } from "./prompt-composer"

export { composeLoomPrompt } from "./prompt-composer"
export type { LoomPromptOptions } from "./prompt-composer"

/**
 * Create a Loom agent config with optional disabled agents, fingerprint, custom agents, and categories for prompt composition.
 */
export function createLoomAgentWithOptions(
  model: string,
  disabledAgents?: Set<string>,
  fingerprint?: ProjectFingerprint | null,
  customAgents?: AvailableAgent[],
  categories?: CategoriesConfig,
  reviewModelVariants?: ReviewModelVariant[],
): AgentConfig {
  return {
    ...LOOM_DEFAULTS,
    prompt: composeLoomPrompt({ disabledAgents, fingerprint, customAgents, categories, reviewModelVariants }),
    model,
    mode: "primary",
  }
}

export const createLoomAgent: AgentFactory = (model: string): AgentConfig => ({
  ...LOOM_DEFAULTS,
  model,
  mode: "primary",
})
createLoomAgent.mode = "primary"
