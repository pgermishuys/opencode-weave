import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { TAPESTRY_DEFAULTS } from "./default"
import { composeTapestryPrompt } from "./prompt-composer"

export { composeTapestryPrompt } from "./prompt-composer"
export type { TapestryPromptOptions } from "./prompt-composer"

/**
 * Create a Tapestry agent config with optional disabled agents for prompt composition.
 */
export function createTapestryAgentWithOptions(model: string, disabledAgents?: Set<string>): AgentConfig {
  if (!disabledAgents || disabledAgents.size === 0) {
    return { ...TAPESTRY_DEFAULTS, tools: { ...TAPESTRY_DEFAULTS.tools }, model, mode: "primary" }
  }
  return {
    ...TAPESTRY_DEFAULTS,
    tools: { ...TAPESTRY_DEFAULTS.tools },
    prompt: composeTapestryPrompt({ disabledAgents }),
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
