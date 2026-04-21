import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import type { AvailableAgent } from "../dynamic-prompt-builder"
import type { ProjectFingerprint } from "../../features/analytics/types"
import type { CategoriesConfig } from "../../config/schema"
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
): AgentConfig {
  if ((!disabledAgents || disabledAgents.size === 0) && !fingerprint && (!customAgents || customAgents.length === 0) && !categories) {
    return { ...LOOM_DEFAULTS, model, mode: "primary" }
  }
  return {
    ...LOOM_DEFAULTS,
    prompt: composeLoomPrompt({ disabledAgents, fingerprint, customAgents, categories }),
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
