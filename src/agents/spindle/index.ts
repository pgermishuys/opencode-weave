import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { SPINDLE_DEFAULTS } from "./default"

export const createSpindleAgent: AgentFactory = (model: string): AgentConfig => ({
  ...SPINDLE_DEFAULTS,
  tools: { ...SPINDLE_DEFAULTS.tools },
  model,
})
createSpindleAgent.mode = "subagent"
