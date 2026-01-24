import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { SHUTTLE_DEFAULTS } from "./default"

export const createShuttleAgent: AgentFactory = (model: string): AgentConfig => ({
  ...SHUTTLE_DEFAULTS,
  model,
  mode: "all",
})
createShuttleAgent.mode = "all"
