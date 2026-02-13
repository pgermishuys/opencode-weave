import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "../types"
import { WEFT_DEFAULTS } from "./default"

export const createWeftAgent: AgentFactory = (model: string): AgentConfig => ({
  ...WEFT_DEFAULTS,
  tools: { ...WEFT_DEFAULTS.tools },
  model,
  mode: "subagent",
})
createWeftAgent.mode = "subagent"
