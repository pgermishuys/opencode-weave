import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { LOOM_DEFAULTS } from "./default"

export const createLoomAgent: AgentFactory = (model: string): AgentConfig => ({
  ...LOOM_DEFAULTS,
  model,
})
createLoomAgent.mode = "primary"
