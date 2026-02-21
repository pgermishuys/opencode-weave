import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { WARP_DEFAULTS } from "./default"

export const createWarpAgent: AgentFactory = (model: string): AgentConfig => ({
  ...WARP_DEFAULTS,
  tools: { ...WARP_DEFAULTS.tools },
  model,
  mode: "subagent",
})
createWarpAgent.mode = "subagent"
