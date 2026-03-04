import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import type { ProjectFingerprint } from "../../features/analytics/types"
import { LOOM_DEFAULTS } from "./default"
import { composeLoomPrompt } from "./prompt-composer"

export { composeLoomPrompt } from "./prompt-composer"
export type { LoomPromptOptions } from "./prompt-composer"

/**
 * Create a Loom agent config with optional disabled agents and fingerprint for prompt composition.
 */
export function createLoomAgentWithOptions(
  model: string,
  disabledAgents?: Set<string>,
  fingerprint?: ProjectFingerprint | null,
): AgentConfig {
  if ((!disabledAgents || disabledAgents.size === 0) && !fingerprint) {
    return { ...LOOM_DEFAULTS, model, mode: "primary" }
  }
  return {
    ...LOOM_DEFAULTS,
    prompt: composeLoomPrompt({ disabledAgents, fingerprint }),
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
