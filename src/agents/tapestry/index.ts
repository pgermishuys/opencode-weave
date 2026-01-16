import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { TAPESTRY_DEFAULTS } from "./default"

export const createTapestryAgent: AgentFactory = (model: string): AgentConfig => ({
  ...TAPESTRY_DEFAULTS,
  tools: { ...TAPESTRY_DEFAULTS.tools },
  model,
})
createTapestryAgent.mode = "primary"
