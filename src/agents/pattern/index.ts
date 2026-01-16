import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { PATTERN_DEFAULTS } from "./default"

export const createPatternAgent: AgentFactory = (model: string): AgentConfig => ({
  ...PATTERN_DEFAULTS,
  model,
})
createPatternAgent.mode = "subagent"
